import {currentUser,failure,ownedBook,serverError} from '../../shared';
export const runtime='edge';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){const user=await currentUser();if(!user)return failure('ログインが必要です。',401);
 try{const {id}=await context.params,book=await ownedBook(id,user);if(!book)return failure('資料が見つかりません。',404);const cover=String(book.cover_image??'');const match=/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i.exec(cover);if(!match||cover.length>=200000)return failure('表紙がありません。',404);const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 if(new URL(request.url).searchParams.get('metadata')==='1')return Response.json({image:cover},{headers});const raw=atob(match[2]),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));return new Response(bytes,{headers:{...headers,'Content-Type':match[1]}});
 }catch(error){return serverError(error);}
}
