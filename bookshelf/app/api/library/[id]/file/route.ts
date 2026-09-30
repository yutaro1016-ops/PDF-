import {beginStorageOperation,endStorageOperation,storageError} from "../../../account/storage-operation";
import { bucket, currentUser, database, expectedLengthBody, failure, fileKey, PART_BYTES, ownedBook, sameOrigin, serverError } from "../../shared";

export const runtime = "edge";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  const { id } = await context.params;
  try {
    const book=await ownedBook(id,userId);
    if (!book) return failure("資料が見つかりません。", 404);
    const key = fileKey(userId, id);
    const metadata = await bucket().head(key);
    if (!metadata) return failure("PDFが見つかりません。", 404);
    const headers = new Headers({ "Content-Type": "application/pdf", "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    if(new URL(request.url).searchParams.get('download')==='1')headers.set('Content-Disposition',`attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(String(book.file_name))}`);
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = match ? Number(match[1]) : NaN;
      const end = match ? (match[2] ? Number(match[2]) : metadata.size - 1) : NaN;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= metadata.size) {
        headers.set("Content-Range", `bytes */${metadata.size}`);
        return new Response(null, { status: 416, headers });
      }
      const object = await bucket().get(key, { range: { offset: start, length: end - start + 1 } });
      if (!object) return failure("PDFが見つかりません。", 404);
      headers.set("Content-Range", `bytes ${start}-${end}/${metadata.size}`);
      headers.set("Content-Length", String(end - start + 1));
      return new Response(object.body, { status: 206, headers });
    }
    headers.set("Content-Length", String(metadata.size));
    if (request.method === "HEAD") return new Response(null, { headers });
    const object = await bucket().get(key);
    if (!object) return failure("PDFが見つかりません。", 404);
    return new Response(object.body, { headers });
  } catch (error) { return serverError(error); }
}

export const HEAD = GET;

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  if (!sameOrigin(request)) return failure("この操作は許可されていません。", 403);
  const { id } = await context.params;
  let operationToken:string|null=null;
  try {
    operationToken=await beginStorageOperation(userId,"put");
    const book = await ownedBook(id, userId);
    if (!book) return failure("資料が見つかりません。", 404);
    if (book.status !== "uploading") return failure("すでに保存済みです。", 409);
    if (Number(request.headers.get("content-length")) !== book.file_size || Number(book.file_size) > PART_BYTES || !request.body || book.upload_id)
      return failure("PDFのサイズを確認できません。");
    await bucket().put(fileKey(userId, id), expectedLengthBody(request.body,Number(book.file_size)), { httpMetadata: { contentType: "application/pdf" } });
    await database().prepare("UPDATE books SET status = 'ready' WHERE id = ? AND user_id = ?")
      .bind(id, userId).run();
    return Response.json({ ok: true });
  } catch (error) { return storageError(error); } finally {await endStorageOperation(userId,operationToken);}
}
