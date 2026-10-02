import {database,failure,serverError} from '../library/shared';
import {env} from 'cloudflare:workers';

// No clock-based takeover: a slow old R2 writer must finish before deletion.
// Unexpected worker termination leaves a fail-closed barrier for operator review.
export class StorageBusyError extends Error {}
export async function beginStorageOperation(user:string,kind:string,closureJob?:string){
 // Production stays unchanged until stranded-operation recovery is accepted.
 // Enabling closure necessarily enables the barrier for all R2 writers.
 const settings=env as unknown as Record<string,unknown>;
 if(settings.ACCOUNT_DELETION_ENABLED!=='true'&&settings.STORAGE_OPERATION_GUARD_ENABLED!=='true')return null;
 const token=crypto.randomUUID(),db=database();
 const predicate=closureJob
  ? "EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=? AND status='deleting' AND job_id=?)"
  : "NOT EXISTS(SELECT 1 FROM account_lifecycle WHERE user_id=? AND status!='active')";
 const result=await db.prepare(`INSERT OR IGNORE INTO storage_operations(user_id,token,kind,created_at) SELECT ?,?,?,? WHERE ${predicate}`)
  .bind(user,token,kind,new Date().toISOString(),user,...(closureJob?[closureJob]:[])).run();
 if(!result.meta.changes)throw new StorageBusyError('保存処理の完了を待っています。少し待って再試行してください。');
 return token;
}
export async function endStorageOperation(user:string,token:string|null,uncertain=false){
 // An error response does not prove that a downstream write cannot still commit.
 // Keep the barrier until an operator has established that all work has ended.
 if(token&&uncertain){await database().prepare("UPDATE storage_operations SET kind='uncertain:'||kind WHERE user_id=? AND token=?").bind(user,token).run();return;}
 if(token)await database().prepare('DELETE FROM storage_operations WHERE user_id=? AND token=?').bind(user,token).run();
}
export function storageError(error:unknown){return error instanceof StorageBusyError?failure(error.message,409):serverError(error);}

export async function abortKnownMultipart(store:R2Bucket,key:string,uploadId:string){
 try{await store.resumeMultipartUpload(key,uploadId).abort();}
 catch(error){
  const value=error as {code?:unknown,name?:unknown,message?:unknown};
  // Only a positively identified missing upload is an idempotent success.
  // A timeout, generic404 or storage failure must keep deletion retryable.
  if(value?.code===10024||value?.code==='10024'||value?.name==='NoSuchUpload'||
   (typeof value?.message==='string'&&/\(10024\)\s*$/.test(value.message)))return;
  throw error;
 }
}
