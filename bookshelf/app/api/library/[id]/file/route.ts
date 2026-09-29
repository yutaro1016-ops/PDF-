import { bucket, currentUser, database, failure, fileKey, MAX_PDF_BYTES, ownedBook, sameOrigin, serverError } from "../../shared";

export const runtime = "edge";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  const { id } = await context.params;
  try {
    if (!await ownedBook(id, userId)) return failure("資料が見つかりません。", 404);
    const object = await bucket().get(fileKey(userId, id));
    if (!object) return failure("PDFが見つかりません。", 404);
    return new Response(object.body, {
      headers: { "Content-Type": "application/pdf", "Content-Length": String(object.size),
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) { return serverError(error); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  if (!sameOrigin(request)) return failure("この操作は許可されていません。", 403);
  const { id } = await context.params;
  try {
    const book = await ownedBook(id, userId);
    if (!book) return failure("資料が見つかりません。", 404);
    if (book.status !== "uploading") return failure("すでに保存済みです。", 409);
    if (Number(request.headers.get("content-length")) !== book.file_size || Number(book.file_size) > MAX_PDF_BYTES || !request.body)
      return failure("PDFのサイズを確認できません。");
    const pageCount = Number(request.headers.get("x-page-count"));
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 20000) return failure("ページ数を確認できません。");
    await bucket().put(fileKey(userId, id), request.body, { httpMetadata: { contentType: "application/pdf" } });
    await database().prepare("UPDATE books SET page_count = ?, status = 'ready' WHERE id = ? AND user_id = ?")
      .bind(pageCount, id, userId).run();
    return Response.json({ ok: true });
  } catch (error) { return serverError(error); }
}
