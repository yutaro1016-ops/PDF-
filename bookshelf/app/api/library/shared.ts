import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export const MAX_PDF_BYTES = 50 * 1024 * 1024;

export function database() {
  if (!env.DB) throw new Error("Database unavailable");
  return env.DB;
}

export function bucket() {
  if (!env.BUCKET) throw new Error("File storage unavailable");
  return env.BUCKET;
}

export async function currentUser() {
  return (await getChatGPTUser())?.userId ?? null;
}

export function failure(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}

export async function ownedBook(id: string, userId: string) {
  return database().prepare("SELECT * FROM books WHERE id = ? AND user_id = ?")
    .bind(id, userId).first<Record<string, string | number>>();
}

export function fileKey(userId: string, id: string) {
  return `${userId}/${id}.pdf`;
}

export function serverError(error: unknown) {
  console.error("Library request failed:", error);
  return failure("保存先で問題が発生しました。少し待って再度お試しください。", 503);
}
