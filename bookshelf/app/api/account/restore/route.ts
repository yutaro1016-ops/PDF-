import {currentUser,database,failure,readLimitedBody,sameOrigin,serverError} from '../../library/shared';
export const runtime='edge';
// Restores only settings for existing, owned IDs. Never inserts/deletes PDFs or indexes.
export async function POST(request:Request){const user=await currentUser();if(!user)return failure('ログインが必要です。',401);if(!sameOrigin(request))return failure('許可されていません。',403);
 try{const bytes=await readLimitedBody(request,5000000);if(!bytes)return failure('一度に復元する設定が大きすぎます。',413);const payload=JSON.parse(new TextDecoder().decode(bytes));if(payload.format!=='pdf-page-finder-backup'||payload.version!==1||!Array.isArray(payload.books)||payload.books.length>20)return failure('バックアップ形式を確認できません。');const statements:D1PreparedStatement[]=[],db=database();let skipped=0;const now=new Date().toISOString();
 for(const book of payload.books){
  if(!book||typeof book.id!=='string'||!/^[a-f0-9-]{36}$/i.test(book.id))return failure('PDF IDが不正です。');
  const own=await db.prepare('SELECT file_size FROM books WHERE id=? AND user_id=?').bind(book.id,user).first<{file_size:number}>();if(!own){skipped++;continue;}if(own.file_size!==book.file_size)return failure('PDFのサイズがバックアップと一致しません。');
  if(typeof book.title!=='string'||!book.title.trim()||book.title.length>240||!Number.isSafeInteger(book.book_order)||book.book_order<0)return failure('本の設定が不正です。');
  for(const field of ['book_color','text_color'])if(book[field]!==null&&!/^#[0-9a-f]{6}$/i.test(book[field]??''))return failure('色が不正です。');
  if(book.book_design!==null&&!['simple','modern','classic','minimal'].includes(book.book_design))return failure('デザインが不正です。');
  if(book.book_icon!==null&&!['pdf','medical','star','bookmark'].includes(book.book_icon))return failure('アイコンが不正です。');
  if(book.cover_image!==null&&!['first-page','none'].includes(book.cover_image)&&!(typeof book.cover_image==='string'&&book.cover_image.length<200000&&/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(book.cover_image)))return failure('表紙が不正です。');
  const tags=JSON.parse(book.tags);if(!Array.isArray(tags)||tags.length>20||tags.some((tag:unknown)=>typeof tag!=='string'||tag.length>40))return failure('タグが不正です。');
  let shelf=book.shelf_id??null;if(shelf&&!await db.prepare('SELECT id FROM shelves WHERE id=? AND user_id=?').bind(shelf,user).first())shelf=null;
  statements.push(db.prepare('UPDATE books SET title=?,shelf_id=?,book_color=?,text_color=?,book_design=?,book_icon=?,cover_image=?,book_order=?,tags=?,updated_at=? WHERE id=? AND user_id=?').bind(book.title.trim(),shelf,book.book_color,book.text_color,book.book_design,book.book_icon,book.cover_image,book.book_order,book.tags,now,book.id,user));
 }
 if(payload.apply===true&&statements.length)await db.batch(statements);
 return Response.json({matched:statements.length,skipped,applied:payload.apply===true},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){if(error instanceof SyntaxError)return failure('バックアップのJSON形式が不正です。');return serverError(error);}
}
