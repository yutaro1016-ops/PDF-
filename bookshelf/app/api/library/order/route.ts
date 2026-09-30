import { currentUser, database, failure, sameOrigin, serverError } from '../shared';
export const runtime = 'edge';
export async function PATCH(request: Request) {
 const user = await currentUser(); if (!user) return failure('ログインが必要です。',401);
 if (!sameOrigin(request)) return failure('許可されていません。',403);
 try {
  const { ids, shelfId } = await request.json() as { ids?: unknown; shelfId?: unknown };
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id=>typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) || new Set(ids).size !== ids.length) return failure('並び順が不正です。');
  if (shelfId !== null && (typeof shelfId !== 'string' || !await database().prepare('SELECT id FROM shelves WHERE id = ? AND user_id = ?').bind(shelfId,user).first())) return failure('本棚が見つかりません。',404);
  const db=database(); const placeholders='SELECT value FROM json_each(?)';
  const count=await db.prepare(`SELECT COUNT(*) AS n FROM books WHERE user_id = ? AND (shelf_id = ? OR (shelf_id IS NULL AND ? IS NULL)) AND id IN (${placeholders})`).bind(user,shelfId,shelfId,JSON.stringify(ids)).first<{n:number}>();
  if(count?.n !== ids.length) return failure('対象の本棚が一致しません。',409);
  await db.batch(ids.map((id,index)=>db.prepare('UPDATE books SET book_order = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(index+1,new Date().toISOString(),id,user)));
  return Response.json({ok:true});
 } catch(error) { return serverError(error); }
}
