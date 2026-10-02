import { currentUser, database, failure, sameOrigin, serverError } from '../../library/shared';
export const runtime = 'edge';
type Context = { params: Promise<{ id: string }> };
const colors = /^#[0-9a-f]{6}$/i;
const designs = ['simple','modern','wood','darkwood','lightwood','white','black','gray'];
export async function PATCH(request: Request, context: Context) {
  const user = await currentUser(); if (!user) return failure('ログインが必要です。', 401);
  if (!sameOrigin(request)) return failure('許可されていません。', 403);
  const { id } = await context.params;
  try {
    const row = await database().prepare('SELECT id FROM shelves WHERE id = ? AND user_id = ?').bind(id,user).first(); if (!row) return failure('本棚が見つかりません。',404);
    const payload = await request.json() as Record<string,unknown>;
    const columns: Record<string,string> = { name:'name', shelfOrder:'shelf_order', color:'color', boardColor:'board_color', textColor:'text_color', design:'design' };
    const values: unknown[] = [], sets: string[] = [];
    for (const [key,column] of Object.entries(columns)) if (key in payload) {
      let value = payload[key];
      if (key === 'name') { value = String(value ?? '').trim().slice(0,80); if (!value) return failure('本棚名を入力してください。'); }
      else if (key === 'shelfOrder') { if (!Number.isSafeInteger(value) || Number(value) < 0) return failure('順序が不正です。'); }
      else if (key === 'design') { if (!designs.includes(String(value))) return failure('デザインが不正です。'); }
      else if (!colors.test(String(value))) return failure('色が不正です。');
      sets.push(`${column} = ?`); values.push(value);
    }
    if (!sets.length) return failure('変更項目がありません。');
    await database().prepare(`UPDATE shelves SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).bind(...values,new Date().toISOString(),id,user).run();
    return Response.json({ ok:true });
  } catch (error) { return serverError(error); }
}
export async function DELETE(request: Request, context: Context) {
  const user = await currentUser(); if (!user) return failure('ログインが必要です。', 401);
  if (!sameOrigin(request)) return failure('許可されていません。',403);
  const { id } = await context.params;
  try {
    const db = database();
    const shelf = await db.prepare('SELECT id FROM shelves WHERE id = ? AND user_id = ?').bind(id,user).first(); if (!shelf) return failure('本棚が見つかりません。',404);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM books WHERE user_id = ? AND shelf_id = ?').bind(user,id).first<{n:number}>();
    await db.batch([db.prepare('UPDATE books SET shelf_id = NULL, updated_at = ? WHERE user_id = ? AND shelf_id = ?').bind(new Date().toISOString(),user,id), db.prepare('DELETE FROM shelves WHERE id = ? AND user_id = ?').bind(id,user)]);
    return Response.json({ movedToUncategorized:count?.n ?? 0 });
  } catch (error) { return serverError(error); }
}
