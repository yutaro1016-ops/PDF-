import { currentUser, database, failure, MAX_PDF_BYTES, sameOrigin, serverError } from "./shared";

export const runtime = "edge";

export async function GET() {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  try {
    const { results } = await database().prepare(
      "SELECT id, title, file_name AS fileName, file_size AS fileSize, page_count AS pageCount, indexed_pages AS indexedPages, status, created_at AS createdAt FROM books WHERE user_id = ? ORDER BY created_at DESC"
    ).bind(userId).all();
    return Response.json({ books: results });
  } catch (error) { return serverError(error); }
}

export async function POST(request: Request) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  if (!sameOrigin(request)) return failure("この操作は許可されていません。", 403);
  try {
    const payload = await request.json() as Record<string, unknown>;
    const fileName = String(payload.fileName || "").trim().slice(0, 240);
    const title = String(payload.title || "").trim().slice(0, 240);
    const size = Number(payload.size);
    if (!/\.pdf$/i.test(fileName) || !title || !Number.isInteger(size) || size < 1 || size > MAX_PDF_BYTES)
      return failure("50MB以下のPDFを選択してください。");
    const id = crypto.randomUUID();
    await database().prepare(
      "INSERT INTO books (id, user_id, title, file_name, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(id, userId, title, fileName, size, new Date().toISOString()).run();
    return Response.json({ id }, { status: 201 });
  } catch (error) { return serverError(error); }
}
