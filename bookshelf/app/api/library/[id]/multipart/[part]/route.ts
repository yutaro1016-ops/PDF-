import {beginStorageOperation,endStorageOperation,storageError} from "../../../../account/storage-operation";
import { bucket, currentUser, expectedLengthBody, failure, fileKey, ownedBook, PART_BYTES, sameOrigin, serverError } from "../../../shared";

export const runtime = "edge";

export async function PUT(request: Request, context: { params: Promise<{ id: string; part: string }> }) {
  const userId = await currentUser();
  if (!userId) return failure("ログインが必要です。", 401);
  if (!sameOrigin(request)) return failure("この操作は許可されていません。", 403);
  const { id, part } = await context.params;
  let operationToken:string|null=null;let operationUncertain=false;
  try {
    operationToken=await beginStorageOperation(userId,"put");
    const book = await ownedBook(id, userId);
    if (!book || book.status !== "uploading" || !book.upload_id) return failure("保存中の資料が見つかりません。", 404);
    const number = Number(part);
    const expected = Math.ceil(Number(book.file_size) / PART_BYTES);
    const length = number === expected ? Number(book.file_size) - (number - 1) * PART_BYTES : PART_BYTES;
    if (!Number.isInteger(number) || number < 1 || number > expected ||
      Number(request.headers.get("content-length")) !== length || !request.body)
      return failure("分割データのサイズを確認できません。");
    const uploaded = await bucket().resumeMultipartUpload(fileKey(userId, id), String(book.upload_id))
      .uploadPart(number, expectedLengthBody(request.body,length));
    return Response.json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
  } catch (error) { operationUncertain=operationToken!==null;return storageError(error); } finally {await endStorageOperation(userId,operationToken,operationUncertain);}
}
