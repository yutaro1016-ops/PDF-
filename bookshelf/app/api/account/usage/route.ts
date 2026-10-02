import {capacityEnforced} from '../policy';
import {currentUser,database,failure,serverError} from '../../library/shared';
export const runtime='edge';
export async function GET(){const user=await currentUser();if(!user)return failure('ログインが必要です。',401);
 try{const db=database();const usage=await db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(file_size),0) AS bytes,SUM(CASE WHEN status != \'ready\' THEN 1 ELSE 0 END) AS incomplete FROM books WHERE user_id=?').bind(user).first();const reservation=await db.prepare("SELECT COALESCE(SUM(CAST(json_extract(i.metadata,'$.file_size') AS INTEGER)),0) AS bytes FROM import_items i JOIN import_jobs j ON j.id=i.job_id LEFT JOIN books b ON b.id=i.target_id WHERE j.user_id=? AND j.status='pending' AND i.status!='done' AND b.id IS NULL").bind(user).first<{bytes:number}>();return Response.json({usage,reservedBytes:reservation?.bytes??0,proposedLimitBytes:5000000000,enforced:capacityEnforced()},{headers:{'Cache-Control':'private, no-store'}});}catch(error){return serverError(error);}
}
