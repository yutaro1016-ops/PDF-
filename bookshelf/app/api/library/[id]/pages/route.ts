import { currentUser, database, failure, ownedBook, sameOrigin, serverError } from "../../shared";

export const runtime = "edge";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  if (!sameOrigin(request)) return failure("この操作は許可されていません。", 403);
  const { id } = await context.params;
  try {
    const book = await ownedBook(id, userId);
    if (!book || book.status !== "ready") return failure("保存済みの資料が見つかりません。", 404);
    const { pageCount } = await request.json() as { pageCount?: unknown };
    if (!Number.isInteger(pageCount) || Number(pageCount) < 1 || Number(pageCount) > 20000) return failure("ページ数を確認できません。");
    if (Number(book.page_count) && Number(book.page_count) !== pageCount) return failure("登録済みのページ数と異なります。", 409);
    await database().prepare("UPDATE books SET page_count = ? WHERE id = ? AND user_id = ?").bind(pageCount, id, userId).run();
    return Response.json({ pageCount });
  } catch (error) { return serverError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  if (!sameOrigin(request)) return failure("この操作は許可されていません。", 403);
  const { id } = await context.params;
  try {
    const book = await ownedBook(id, userId);
    if (!book || book.status !== "ready") return failure("保存済みの資料が見つかりません。", 404);
    const payload = await request.json() as { pages?: Array<{ number: number; text: string; normalized: string }> };
    const pages = payload.pages;
    if (!Array.isArray(pages) || !pages.length || pages.length > 5 ||
      pages.some((page) => !Number.isInteger(page.number) || page.number < 1 ||
        page.number > Number(book.page_count) || typeof page.text !== "string" ||
        typeof page.normalized !== "string" || page.text.length > 200000 || page.normalized.length > 200000))
      return failure("文字データを確認できません。");
    const statements = pages.map((page) => database().prepare(
      "INSERT OR REPLACE INTO pages (book_id, page_number, body, normalized) VALUES (?, ?, ?, ?)"
    ).bind(id, page.number, page.text, page.normalized));
    await database().batch(statements);
    const count = await database().prepare("SELECT COUNT(*) AS total FROM pages WHERE book_id = ?").bind(id).first<{total:number}>();
    await database().prepare("UPDATE books SET indexed_pages = ? WHERE id = ? AND user_id = ?")
      .bind(count?.total || 0, id, userId).run();
    return Response.json({ indexedPages: count?.total || 0 });
  } catch (error) { return serverError(error); }
}
