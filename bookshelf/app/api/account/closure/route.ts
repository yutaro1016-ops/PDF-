import {abortKnownMultipart,beginStorageOperation,endStorageOperation,storageError} from "../storage-operation";
import {authenticatedUser,bucket,database,failure,fileKey,readLimitedBody,sameOrigin,serverError} from '../../library/shared';
import {closureEnabled} from '../policy';
import {cancelJob} from '../../shares/shared';
export const runtime='edge';
const headers={'Cache-Control':'private, no-store'};
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
async function view(user:string){const db=database();const counts=await db.prepare('SELECT COUNT(*) AS books,COALESCE(SUM(file_size),0) AS bytes FROM books WHERE user_id=?').bind(user).first();const state=await db.prepare('SELECT status,job_id AS jobId FROM account_lifecycle WHERE user_id=?').bind(user).first();return {enabled:closureEnabled(),counts,state:state??{status:'active',jobId:null},recipientCopiesRemain:true};}
export async function GET(){const user=await authenticatedUser();if(!user)return failure('ログインが必要です。',401);try{return Response.json(await view(user),{headers});}catch(error){return serverError(error);}}
export async function POST(request:Request){const user=await authenticatedUser();if(!user)return failure('ログインが必要です。',401);if(!sameOrigin(request))return failure('許可されていません。',403);
 if(!closureEnabled())return failure('退会機能は検証中のため現在は停止しています。データは削除されません。',409);
 const db=database();let lease:string|null=null;let operationToken:string|null=null;
 try{const bytes=await readLimitedBody(request,4096);if(!bytes)return failure('操作を確認できません。');const body=JSON.parse(new TextDecoder().decode(bytes));const now=Date.now(),time=new Date(now).toISOString();
 if(body.action==='prepare'){
  const nonce=crypto.randomUUID();const result=await db.prepare("INSERT INTO account_lifecycle(user_id,status,nonce_hash,nonce_expires,updated_at) VALUES(?,'active',?,?,?) ON CONFLICT(user_id) DO UPDATE SET nonce_hash=excluded.nonce_hash,nonce_expires=excluded.nonce_expires,updated_at=excluded.updated_at WHERE account_lifecycle.status='active'").bind(user,await hash(nonce),now+300000,time).run();
  if(!result.meta.changes)return Response.json(await view(user),{headers});return Response.json({...await view(user),nonce},{headers});
 }
 if(body.action==='start'){
  if(body.confirm!=='退会してすべて削除'||body.exportAcknowledged!==true||typeof body.nonce!=='string')return failure('書き出しと削除内容を確認してください。');
  const job=crypto.randomUUID();const results=await db.batch([db.prepare("UPDATE account_lifecycle SET status='deleting',job_id=?,nonce_hash=NULL,nonce_expires=0,updated_at=? WHERE user_id=? AND status='active' AND nonce_hash=? AND nonce_expires>?").bind(job,time,user,await hash(body.nonce),now),db.prepare("UPDATE shares SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=? AND status='deleting' AND job_id=?)").bind(time,user,user,job)]);
  if(!results[0].meta.changes)return failure('確認が期限切れ、またはすでに開始済みです。状況を再取得してください。',409);
  return Response.json(await view(user),{headers});
 }
 if(body.action!=='advance'||typeof body.jobId!=='string')return failure('操作を確認できません。');
 operationToken=await beginStorageOperation(user,"closure",body.jobId);
 lease=crypto.randomUUID();const locked=await db.prepare("UPDATE account_lifecycle SET lease_token=?,lease_until=? WHERE user_id=? AND job_id=? AND status='deleting' AND lease_until<?").bind(lease,now+120000,user,body.jobId,now).run();
 if(!locked.meta.changes)return failure('処理中、完了済み、または対象が異なります。状況を再取得してください。',409);
 // Revoke on each retry, including failure immediately after marking the account.
 await db.prepare('UPDATE shares SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(time,user).run();
 const pending=await db.prepare("SELECT * FROM import_jobs WHERE user_id=? AND status='pending' LIMIT 1").bind(user).first<Record<string,any>>();
 if(pending){const held=await db.prepare("UPDATE import_jobs SET lease_token=?,lease_until=? WHERE id=? AND user_id=? AND lease_until<?").bind(lease,now+120000,pending.id,user,now).run();if(!held.meta.changes)return failure('取り込みの停止を待っています。少し待って再開してください。',409);try{await cancelJob(pending);}finally{await db.prepare('UPDATE import_jobs SET lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?').bind(pending.id,lease).run();}return Response.json(await view(user),{headers});}
 const {results:books}=await db.prepare('SELECT id,upload_id FROM books WHERE user_id=? LIMIT 10').bind(user).all<{id:string,upload_id:string|null}>();
 for(const book of books){const key=fileKey(user,book.id);if(book.upload_id&&!await bucket().head(key))await abortKnownMultipart(bucket(),key,book.upload_id);await bucket().delete([key,`${user}/${book.id}.thumbnail.jpg`]);await db.batch([db.prepare('DELETE FROM pages WHERE book_id=? AND EXISTS(SELECT 1 FROM books WHERE id=? AND user_id=?)').bind(book.id,book.id,user),db.prepare('DELETE FROM books WHERE id=? AND user_id=?').bind(book.id,user)]);}
 if(books.length)return Response.json(await view(user),{headers});
 // Remove orphaned objects under this application's exact user namespace.
 const orphaned=await bucket().list({prefix:`${user}/`,limit:100});if(orphaned.objects.length){await bucket().delete(orphaned.objects.map(o=>o.key));return Response.json(await view(user),{headers});}
 await db.batch([db.prepare('DELETE FROM shelves WHERE user_id=?').bind(user),db.prepare('DELETE FROM shares WHERE user_id=?').bind(user),db.prepare('DELETE FROM import_jobs WHERE user_id=?').bind(user),db.prepare("UPDATE account_lifecycle SET status='deleted',updated_at=? WHERE user_id=? AND job_id=? AND lease_token=?").bind(time,user,body.jobId,lease)]);
 return Response.json(await view(user),{headers});
 }catch(error){if(error instanceof SyntaxError)return failure('操作の形式が不正です。');return storageError(error);}finally{try{if(lease)await db.prepare('UPDATE account_lifecycle SET lease_token=NULL,lease_until=0 WHERE user_id=? AND lease_token=?').bind(user,lease).run();}finally{await endStorageOperation(user,operationToken);}}
}
