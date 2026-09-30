import {abortKnownMultipart,beginStorageOperation,endStorageOperation,storageError} from "../../../account/storage-operation";
import { bucket, currentUser, database, failure, fileKey, ownedBook, PART_BYTES, sameOrigin, serverError } from "../../shared";

export const runtime = "edge";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  if (!sameOrigin(request)) return failure("この操作は許可されていません。", 403);
  const { id } = await context.params;
  let operationToken:string|null=null;let operationUncertain=false;
  try {
    operationToken=await beginStorageOperation(userId,"post");
    const book = await ownedBook(id, userId);
    if (!book) return failure("資料が見つかりません。", 404);
    const payload = await request.json() as { parts?: Array<{ partNumber: number; etag: string }> };
    if (payload.parts === undefined) {
      if(book.status==="uploading" && book.upload_id)return Response.json({uploadId:book.upload_id});
      if (book.status !== "uploading" || Number(book.file_size) <= PART_BYTES)
        return failure("分割保存を開始できません。", 409);
      const upload = await bucket().createMultipartUpload(fileKey(userId, id), { httpMetadata: { contentType: "application/pdf" } });
      try {
        const result=await database().prepare("UPDATE books SET upload_id = ? WHERE id = ? AND user_id = ? AND status = 'uploading' AND upload_id IS NULL")
          .bind(upload.uploadId, id, userId).run();
        if(!result.meta.changes){await upload.abort();return failure("保存開始処理中です。再試行してください。",409);}
      } catch (error) { await upload.abort(); throw error; }
      return Response.json({ uploadId: upload.uploadId });
    }
    if(book.status==="ready")return Response.json({ok:true});
    if (book.status !== "uploading" || !book.upload_id) return failure("保存中の資料が見つかりません。", 409);
    const expected = Math.ceil(Number(book.file_size) / PART_BYTES);
    if (!Array.isArray(payload.parts) || payload.parts.length !== expected ||
      payload.parts.some((part, index) => part.partNumber !== index + 1 || typeof part.etag !== "string" || !part.etag || part.etag.length > 200))
      return failure("分割データを確認できません。");
    const upload = bucket().resumeMultipartUpload(fileKey(userId, id), String(book.upload_id));
    const existing=await bucket().head(fileKey(userId,id));
    const object = existing ?? await upload.complete(payload.parts);
    if (object.size !== Number(book.file_size)) {
      await bucket().delete(fileKey(userId, id));
      await database().prepare("UPDATE books SET upload_id = NULL WHERE id = ? AND user_id = ?").bind(id, userId).run();
      return failure("PDFのサイズが一致しません。再度追加してください。");
    }
    await database().prepare("UPDATE books SET upload_id = NULL, status = 'ready' WHERE id = ? AND user_id = ?")
      .bind(id, userId).run();
    return Response.json({ ok: true });
  } catch (error) { operationUncertain=operationToken!==null;return storageError(error); } finally {await endStorageOperation(userId,operationToken,operationUncertain);}
}

export async function DELETE(request: Request, context: Context) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  if (!sameOrigin(request)) return failure("この操作は許可されていません。", 403);
  const { id } = await context.params;
  let operationToken:string|null=null;let operationUncertain=false;
  try {
    operationToken=await beginStorageOperation(userId,"delete");
    const book = await ownedBook(id, userId);
    if (!book) return failure("資料が見つかりません。", 404);
    if (book.upload_id) {
      await abortKnownMultipart(bucket(),fileKey(userId,id),String(book.upload_id));
      await database().prepare("UPDATE books SET upload_id = NULL WHERE id = ? AND user_id = ?").bind(id, userId).run();
    }
    return Response.json({ ok: true });
  } catch (error) { operationUncertain=operationToken!==null;return storageError(error); } finally {await endStorageOperation(userId,operationToken,operationUncertain);}
}
