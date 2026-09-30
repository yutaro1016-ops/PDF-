import {ACTIVE_ACCOUNT_SQL} from '../account/policy';
import {currentUser,database,failure,sameOrigin,serverError} from '../library/shared';
import {tokenHash,jobView} from './shared';
export const runtime='edge';
export async function GET(){
  const user=await currentUser();if(!user)return failure('ログインが必要です。',401);
  try{const {results}=await database().prepare('SELECT s.id,s.name,s.kind,s.created_at AS createdAt,s.expires_at AS expiresAt,s.revoked_at AS revokedAt,(SELECT COUNT(*) FROM share_books WHERE share_id=s.id) AS count FROM shares s WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user).all();const {results:pending}=await database().prepare("SELECT j.id,s.name FROM import_jobs j JOIN shares s ON s.id=j.share_id WHERE j.user_id=? AND j.status='pending' ORDER BY j.created_at DESC LIMIT 100").bind(user).all<{id:string,name:string}>();const imports=[];for(const entry of pending)imports.push({name:entry.name,job:await jobView(entry.id,user)});return Response.json({shares:results,imports},{headers:{'Cache-Control':'private, no-store'}});}catch(error){return serverError(error);}
}
export async function POST(request:Request){
  const user=await currentUser();if(!user)return failure('ログインが必要です。',401);
  if(!sameOrigin(request))return failure('許可されていません。',403);
  try{
    const payload=await request.json() as {kind?:string,shelfId?:string|null,ids?:string[],expiryDays?:number};
    const db=database();let ids:string[]=[],shelf:Record<string,any>|null=null,name='共有した本';
    if(payload.kind==='shelf'){
      if(payload.shelfId){shelf=await db.prepare('SELECT * FROM shelves WHERE id=? AND user_id=?').bind(payload.shelfId,user).first();if(!shelf)return failure('本棚が見つかりません。',404);}
      name=shelf?.name||'未分類';
      const {results}=await db.prepare("SELECT id FROM books WHERE user_id=? AND shelf_id IS ? ORDER BY book_order,created_at LIMIT 1001").bind(user,payload.shelfId??null).all<{id:string}>();ids=results.map(x=>x.id);
    }else if(payload.kind==='books' && Array.isArray(payload.ids)){ids=[...new Set(payload.ids)];}
    else return failure('共有する本を選択してください。');
    if(ids.length>1000||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)))return failure('1回に共有できるのは1000冊までです。');
    const {results}=await db.prepare("SELECT id,title FROM books WHERE user_id=? AND status='ready' AND id IN (SELECT value FROM json_each(?))").bind(user,JSON.stringify(ids)).all<{id:string,title:string}>();
    if(results.length!==ids.length)return failure('保存未完了または共有できないPDFがあります。保存完了後にお試しください。');
    if(payload.kind==='books')name=results.length===1?results[0].title:`共有した${results.length}冊`;
    const days=payload.expiryDays??7;if(![0,1,7,30].includes(days))return failure('有効期限が不正です。');
    const token=(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-',''),id=crypto.randomUUID(),now=new Date().toISOString(),expires=days?new Date(Date.now()+days*86400000).toISOString():null;
    await db.batch([
      db.prepare(`INSERT INTO shares(id,user_id,token_hash,name,kind,shelf_json,created_at,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE ${ACTIVE_ACCOUNT_SQL}` ).bind(id,user,await tokenHash(token),name,payload.kind,shelf?JSON.stringify(shelf):null,now,expires,user),
      db.prepare('INSERT INTO share_books(share_id,book_id,position) SELECT ?,value,CAST(key AS INTEGER) FROM json_each(?) WHERE EXISTS(SELECT 1 FROM shares WHERE id=? AND user_id=?)').bind(id,JSON.stringify(ids),id,user)
    ]);
    if(!await db.prepare('SELECT id FROM shares WHERE id=? AND user_id=?').bind(id,user).first())return failure('退会処理中です。',409);
    return Response.json({id,url:`${new URL(request.url).origin}/shelf.html?share=${token}`,count:ids.length,expiresAt:expires},{status:201,headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return serverError(error);}
}
export async function DELETE(request:Request){
  const user=await currentUser();if(!user)return failure('ログインが必要です。',401);if(!sameOrigin(request))return failure('許可されていません。',403);
  try{const {id}=await request.json() as {id:string};const result=await database().prepare('UPDATE shares SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL').bind(new Date().toISOString(),id,user).run();if(!result.meta.changes)return failure('共有が見つかりません。',404);return Response.json({ok:true});}catch(error){return serverError(error);}
}
