import {currentUser,database,failure,serverError} from '../../library/shared';
import {activeShare,sharedBooks,jobView} from '../shared';
export const runtime='edge';
export async function GET(_request:Request,context:{params:Promise<{token:string}>}){
  const user=await currentUser();if(!user)return failure('ログインして共有内容を確認してください。',401);
  try{
    const {token}=await context.params,share=await activeShare(token);if(!share)return failure('共有リンクは無効、期限切れ、または停止されています。',404);
    const books=await sharedBooks(share),count=await database().prepare('SELECT COUNT(*) AS n FROM share_books WHERE share_id=?').bind(share.id).first<{n:number}>();
    const active=await database().prepare("SELECT id FROM import_jobs WHERE user_id=? AND share_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(user,share.id).first<{id:string}>();
    const {results:added}=await database().prepare("SELECT i.source_id AS sourceId,i.target_id AS targetId FROM import_items i JOIN import_jobs j ON j.id=i.job_id JOIN books b ON b.id=i.target_id AND b.user_id=j.user_id WHERE j.user_id=? AND j.share_id=? AND i.status='done'").bind(user,share.id).all();
    return Response.json({name:share.name,kind:share.kind,expiresAt:share.expires_at,unavailable:(count?.n??0)-books.length,books:books.map(b=>({id:b.id,title:b.title,fileSize:b.file_size,tags:b.tags})),added,activeImport:active?await jobView(active.id,user):null},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return serverError(error);}
}
