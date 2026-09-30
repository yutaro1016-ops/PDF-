import { currentUser, database, failure, sameOrigin, serverError } from '../shared';
export const runtime = 'edge';
export async function PATCH(request: Request) {
 const user = await currentUser(); if (!user) return failure('ログインが必要です。',401);
 if (!sameOrigin(request)) return failure('許可されていません。',403);
 try {
  const payload = await request.json() as Record<string, unknown>;
  if (!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 100 || payload.ids.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))) return failure('対象を確認できません。');
  const ids = [...new Set(payload.ids)] as string[];
  const db = database(); const placeholders = 'SELECT value FROM json_each(?)';
  const owned = await db.prepare(`SELECT COUNT(*) AS n FROM books WHERE user_id = ? AND id IN (${placeholders})`).bind(user,JSON.stringify(ids)).first<{n:number}>();
  if (owned?.n !== ids.length) return failure('対象が見つかりません。',404);
  const changes: string[] = []; const args: unknown[] = [];
  if ('shelfId' in payload) {
   if (payload.shelfId !== null && (typeof payload.shelfId !== 'string' || !await db.prepare('SELECT id FROM shelves WHERE id = ? AND user_id = ?').bind(payload.shelfId,user).first())) return failure('本棚が見つかりません。',404);
   changes.push('shelf_id = ?'); args.push(payload.shelfId);
  }
  if ('tags' in payload) {
   if (!Array.isArray(payload.tags) || payload.tags.length > 20 || payload.tags.some(tag => typeof tag !== 'string' || tag.length > 40)) return failure('タグが不正です。');
   changes.push('tags = ?'); args.push(JSON.stringify(payload.tags));
  }
  const styleColumns: Record<string,string> = { bookColor:'book_color', textColor:'text_color', bookDesign:'book_design', bookIcon:'book_icon', coverImage:'cover_image' };
  for (const [key,column] of Object.entries(styleColumns)) if (key in payload) {
   const value = payload[key];
   if ((key === 'bookColor' || key === 'textColor') && !/^#[0-9a-f]{6}$/i.test(String(value))) return failure('色が不正です。');
   if (key === 'bookDesign' && !['simple','modern','classic','minimal'].includes(String(value))) return failure('デザインが不正です。');
   if (key === 'bookIcon' && !['pdf','medical','star','bookmark'].includes(String(value))) return failure('アイコンが不正です。');
   if (key === 'coverImage' && !['first-page','none'].includes(String(value))) return failure('表紙が不正です。');
   changes.push(column + ' = ?'); args.push(value);
  }
  if (!changes.length) return failure('変更項目がありません。');
  await db.prepare(`UPDATE books SET ${changes.join(', ')}, updated_at = ? WHERE user_id = ? AND id IN (${placeholders})`).bind(...args,new Date().toISOString(),user,JSON.stringify(ids)).run();
  return Response.json({ ok:true });
 } catch(error) { return serverError(error); }
}
