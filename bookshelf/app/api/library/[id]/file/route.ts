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
    // A HEAD response describes the full representation without fetching its
    // body. Range is only meaningful for GET, including when it is malformed.
    if (request.method === "HEAD") {
      headers.set("Content-Length", String(metadata.size));
      return new Response(null, { headers });
    }
    const range = request.headers.get("range");
    // No response validator is exposed by this route. If-Range cannot be
    // proven to match, so return a fresh full body rather than mix revisions.
    if (range && !request.headers.has("if-range") && range.trim().startsWith("bytes=")) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      let start = NaN, end = NaN;
      if (match && (match[1] || match[2])) {
        if (match[1]) {
          start = Number(match[1]);
          const requestedEnd = match[2] ? Number(match[2]) : metadata.size - 1;
          if (Number.isSafeInteger(requestedEnd)) end = Math.min(requestedEnd, metadata.size - 1);
        } else {
          const suffixLength = Number(match[2]);
          if (Number.isSafeInteger(suffixLength) && suffixLength > 0) {
            start = Math.max(0, metadata.size - suffixLength);
            end = metadata.size - 1;
          }
        }
      }
      // Only a single safe integer range is supported. Never fetch storage for
      // malformed, multiple, zero-length suffix or unsatisfiable ranges.
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= metadata.size) {
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
  let operationToken:string|null=null;let operationUncertain=false;
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
  } catch (error) { operationUncertain=operationToken!==null;return storageError(error); } finally {await endStorageOperation(userId,operationToken,operationUncertain);}
}
