import { bucket, currentUser, database, failure, fileKey, ownedBook, sameOrigin, serverError } from "../shared";

export const runtime = "edge";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  if (!sameOrigin(request)) return failure("この操作は許可されていません。", 403);
  const { id } = await context.params;
  try {
    if (!await ownedBook(id, userId)) return failure("資料が見つかりません。", 404);
    const payload = await request.json() as Record<string, unknown>;
    const columns: Record<string,string> = { title:"title", shelfId:"shelf_id", bookColor:"book_color", textColor:"text_color", bookDesign:"book_design", bookIcon:"book_icon", coverImage:"cover_image", bookOrder:"book_order", tags:"tags", lastOpenedAt:"last_opened_at" };
    const sets: string[] = [], values: unknown[] = [];
    for (const [key, column] of Object.entries(columns)) if (key in payload) {
      let value = payload[key];
      if (key === "title") { value = String(value ?? "").trim().slice(0,240); if (!value) return failure("タイトルを入力してください。"); }
      else if (key === "shelfId") { if (value !== null && (typeof value !== "string" || !await database().prepare("SELECT id FROM shelves WHERE id = ? AND user_id = ?").bind(value,userId).first())) return failure("本棚が見つかりません。",404); }
      else if (key === "bookColor" || key === "textColor") { if (value !== null && !/^#[0-9a-f]{6}$/i.test(String(value))) return failure("色が不正です。"); }
      else if (key === "bookDesign") { if (value !== null && !["simple","modern","classic","minimal"].includes(String(value))) return failure("デザインが不正です。"); }
      else if (key === "bookIcon") { if (value !== null && !["pdf","medical","star","bookmark"].includes(String(value))) return failure("アイコンが不正です。"); }
      else if (key === "coverImage") { if (value !== null && value !== "first-page" && value !== "none" && !(typeof value === "string" && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) && value.length < 200000)) return failure("表紙画像が不正です。"); }
      else if (key === "bookOrder") { if (!Number.isSafeInteger(value) || Number(value) < 0) return failure("順序が不正です。"); }
      else if (key === "tags") { if (!Array.isArray(value) || value.length > 20 || value.some(tag => typeof tag !== "string" || tag.length > 40)) return failure("タグが不正です。"); value = JSON.stringify(value); }
      else if (key === "lastOpenedAt") { value = new Date().toISOString(); }
      sets.push(column + " = ?"); values.push(value);
    }
    if (!sets.length) return failure("変更項目がありません。");
    await database().prepare("UPDATE books SET " + sets.join(", ") + ", updated_at = ? WHERE id = ? AND user_id = ?").bind(...values,new Date().toISOString(),id,userId).run();
    return Response.json({ ok:true, ...payload });
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
