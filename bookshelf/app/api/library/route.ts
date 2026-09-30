import { currentUser, database, failure, MAX_PDF_BYTES, sameOrigin, serverError } from "./shared";

export const runtime = "edge";

export async function GET() {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  try {
    const { results } = await database().prepare(
      "SELECT id, title, file_name AS fileName, file_size AS fileSize, page_count AS pageCount, indexed_pages AS indexedPages, status, created_at AS createdAt, shelf_id AS shelfId, book_color AS bookColor, text_color AS textColor, book_design AS bookDesign, book_icon AS bookIcon, CASE WHEN cover_image LIKE 'data:image/%' THEN 'custom' ELSE cover_image END AS coverImage, book_order AS bookOrder, tags, updated_at AS updatedAt, last_opened_at AS lastOpenedAt FROM books WHERE user_id = ? AND status != 'importing' ORDER BY created_at DESC"
    ).bind(userId).all();
    return Response.json({ books: results },{headers:{'Cache-Control':'private, no-store'}});
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
    const shelfId = payload.shelfId == null ? null : String(payload.shelfId);
    if (shelfId && !await database().prepare("SELECT id FROM shelves WHERE id = ? AND user_id = ?").bind(shelfId, userId).first())
      return failure("本棚が見つかりません。", 404);
    if (!/\.pdf$/i.test(fileName) || !title || !Number.isInteger(size) || size < 1 || size > MAX_PDF_BYTES)
      return failure("1GB以下のPDFを選択してください。");
    const id = crypto.randomUUID();
    await database().prepare(
      "INSERT INTO books (id, user_id, title, file_name, file_size, created_at, shelf_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, userId, title, fileName, size, new Date().toISOString(), shelfId).run();
    return Response.json({ id }, { status: 201 });
  } catch (error) { return serverError(error); }
}
