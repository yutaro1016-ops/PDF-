import { currentUser, database, failure, sameOrigin, serverError } from '../library/shared';
export const runtime = 'edge';
export async function GET() {
  const user = await currentUser(); if (!user) return failure('ログインが必要です。', 401);
  try { const { results } = await database().prepare('SELECT id, name, shelf_order AS shelfOrder, color, board_color AS boardColor, text_color AS textColor, design, created_at AS createdAt, updated_at AS updatedAt FROM shelves WHERE user_id = ? ORDER BY shelf_order, created_at').bind(user).all(); return Response.json({ shelves: results }); }
  catch (error) { return serverError(error); }
}
export async function POST(request: Request) {
  const user = await currentUser(); if (!user) return failure('ログインが必要です。', 401);
  if (!sameOrigin(request)) return failure('許可されていません。', 403);
  try {
    const { name } = await request.json() as { name?: unknown };
    const value = String(name ?? '').trim().slice(0, 80); if (!value) return failure('本棚の名前を入力してください。');
    const id = crypto.randomUUID(), now = new Date().toISOString();
    await database().prepare('INSERT INTO shelves (id,user_id,name,shelf_order,created_at,updated_at) VALUES (?,?,?,(SELECT COALESCE(MAX(shelf_order),0)+1 FROM shelves WHERE user_id = ?),?,?)').bind(id,user,value,user,now,now).run();
    return Response.json({ id }, { status: 201 });
  } catch (error) { return serverError(error); }
}
