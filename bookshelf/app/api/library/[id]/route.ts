import { bucket, currentUser, database, failure, fileKey, ownedBook, sameOrigin, serverError } from "../shared";

export const runtime = "edge";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  if (!sameOrigin(request)) return failure("この操作は許可されていません。", 403);
  const { id } = await context.params;
  try {
    if (!await ownedBook(id, userId)) return failure("資料が見つかりません。", 404);
    const { title } = await request.json() as { title?: unknown };
    const value = String(title ?? "").trim().slice(0, 240);
    if (!value) return failure("タイトルを入力してください。");
    await database().prepare("UPDATE books SET title = ? WHERE id = ? AND user_id = ?").bind(value, id, userId).run();
    return Response.json({ title: value });
  } catch (error) { return serverError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  if (!sameOrigin(request)) return failure("この操作は許可されていません。", 403);
  const { id } = await context.params;
  try {
    const book = await ownedBook(id, userId);
    if (!book) return failure("資料が見つかりません。", 404);
    if (book.upload_id) await bucket().resumeMultipartUpload(fileKey(userId, id), String(book.upload_id)).abort();
    await bucket().delete(fileKey(userId, id));
    await database().batch([
      database().prepare("DELETE FROM pages WHERE book_id = ?").bind(id),
      database().prepare("DELETE FROM books WHERE id = ? AND user_id = ?").bind(id, userId),
    ]);
    return Response.json({ ok: true });
  } catch (error) { return serverError(error); }
}
