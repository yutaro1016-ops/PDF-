import {currentUser,database,failure,sameOrigin,serverError} from '../../../library/shared';
import {advanceItem,cancelJob,jobView,Row} from '../../shared';
export const runtime='edge';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){const user=await currentUser();if(!user)return failure('ログインが必要です。',401);try{const {id}=await context.params,job=await jobView(id,user);return job?Response.json({job},{headers:{'Cache-Control':'private, no-store'}}):failure('取り込みが見つかりません。',404);}catch(error){return serverError(error);}}
async function operate(request:Request,context:Context,cancel:boolean){
  const user=await currentUser();if(!user)return failure('ログインが必要です。',401);if(!sameOrigin(request))return failure('許可されていません。',403);
  const {id}=await context.params,db=database(),lease=crypto.randomUUID();let locked=false;
  try{
    const job=await db.prepare('SELECT * FROM import_jobs WHERE id=? AND user_id=?').bind(id,user).first<Row>();if(!job)return failure('取り込みが見つかりません。',404);
    if(job.status!=='pending')return Response.json({job:await jobView(id,user)});
    const lock=await db.prepare("UPDATE import_jobs SET lease_token=?,lease_until=? WHERE id=? AND user_id=? AND status='pending' AND lease_until<?").bind(lease,Date.now()+120000,id,user,Date.now()).run();
    if(!lock.meta.changes)return failure('取り込み処理中です。少し待って再開してください。',409);locked=true;
    if(cancel){await cancelJob(job);return Response.json({job:await jobView(id,user)});}
    if(job.shelf_id&&!await db.prepare('SELECT id FROM shelves WHERE id=? AND user_id=?').bind(job.shelf_id,user).first()){
      await db.prepare('UPDATE import_jobs SET shelf_id=NULL WHERE id=?').bind(id).run();job.shelf_id=null;
    }
    const share=await db.prepare('SELECT * FROM shares WHERE id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)').bind(job.share_id,new Date().toISOString()).first<Row>();
    if(!share)return failure('共有リンクが停止または期限切れになりました。取り込みを中止してください。',410);
    const item=await db.prepare("SELECT * FROM import_items WHERE job_id=? AND status!='done' ORDER BY position LIMIT 1").bind(id).first<Row>();
    if(item){
      const source=await db.prepare("SELECT b.id FROM books b JOIN share_books sb ON sb.book_id=b.id WHERE sb.share_id=? AND b.id=? AND b.user_id=? AND b.status='ready'").bind(share.id,item.source_id,share.user_id).first();
      if(!source)return failure('共有元で本が削除されました。取り込みを中止するか、共有者に確認してください。',410);
      try{await advanceItem(job,item,share.user_id);}catch(error){console.error('Import failed',error);return failure(error instanceof Error?error.message:'追加できませんでした。再開してください。',503);}
    }
    const remaining=await db.prepare("SELECT COUNT(*) AS n FROM import_items WHERE job_id=? AND status!='done'").bind(id).first<{n:number}>();
    await db.prepare('UPDATE import_jobs SET status=?,updated_at=? WHERE id=?').bind(remaining?.n?'pending':'done',new Date().toISOString(),id).run();
    return Response.json({job:await jobView(id,user)});
  }catch(error){return serverError(error);}finally{if(locked)await db.prepare('UPDATE import_jobs SET lease_until=0,lease_token=NULL WHERE id=? AND lease_token=?').bind(id,lease).run();}
}
export async function POST(request:Request,context:Context){return operate(request,context,false);}
export async function DELETE(request:Request,context:Context){return operate(request,context,true);}
