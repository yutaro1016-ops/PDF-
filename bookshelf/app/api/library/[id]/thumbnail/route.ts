import {beginStorageOperation,endStorageOperation,storageError} from "../../../account/storage-operation";
import { bucket, currentUser, failure, ownedBook, sameOrigin, serverError, readLimitedBody } from '../../shared';
export const runtime = 'edge';
type Context = { params: Promise<{id:string}> };
export async function GET(_request: Request, context: Context) {
 const user=await currentUser();if(!user)return failure('ログインが必要です。',401);
 const {id}=await context.params;
 try{if(!await ownedBook(id,user))return failure('資料が見つかりません。',404);
 const object=await bucket().get(`${user}/${id}.thumbnail.jpg`);if(!object)return new Response(null,{status:404});
 return new Response(object.body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){return serverError(error);}
}
export async function PUT(request: Request, context: Context) {
 const user=await currentUser();if(!user)return failure('ログインが必要です。',401);
 if(!sameOrigin(request))return failure('この操作は許可されていません。',403);
 const {id}=await context.params;
 let operationToken:string|null=null;
  try{
    operationToken=await beginStorageOperation(user,"put");const book=await ownedBook(id,user);if(!book||book.status!=='ready')return failure('保存済みの資料が見つかりません。',404);
 const bytes=await readLimitedBody(request,65536);if(!bytes)return failure('表紙画像が大きすぎます。',413);
 if(bytes.length<4||bytes.length>65536||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)return failure('表紙画像を確認できません。');
 await bucket().put(`${user}/${id}.thumbnail.jpg`,bytes,{httpMetadata:{contentType:'image/jpeg'}});return Response.json({ok:true});
 }catch(error){return storageError(error);}finally{await endStorageOperation(user,operationToken);}
}
