import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export const MAX_PDF_BYTES = 1024 * 1024 * 1024;
export const PART_BYTES = 8 * 1024 * 1024;

export function database() {
  if (!env.DB) throw new Error("Database unavailable");
  return env.DB;
}

export function bucket() {
  if (!env.BUCKET) throw new Error("File storage unavailable");
  return env.BUCKET;
}

export async function authenticatedUser(){return (await getChatGPTUser())?.userId ?? null;}
export async function currentUser() {
  const id=await authenticatedUser();if(!id)return null;
  const state=await database().prepare("SELECT status FROM account_lifecycle WHERE user_id=?").bind(id).first<{status:string}>();
  return state && state.status!=='active'?null:id;
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

export async function readLimitedBody(request:Request,limit:number){
 const reader=request.body?.getReader();if(!reader)return null;
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();return null;}chunks.push(part.value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;}finally{reader.releaseLock();}
}
// Validate actual streamed bytes, not only the caller's Content-Length.
// At most one source chunk is held; an incomplete part remains retryable.
export function expectedLengthBody(body:ReadableStream<Uint8Array>,expected:number){
 const reader=body.getReader();let received=0,released=false;
 const release=()=>{if(!released){released=true;reader.releaseLock();}};
 return new ReadableStream<Uint8Array>({
  async pull(controller){try{const part=await reader.read();if(part.done){if(received!==expected)throw new RangeError('PDF body length mismatch');release();controller.close();return;}received+=part.value.byteLength;if(received>expected)throw new RangeError('PDF body length exceeded');controller.enqueue(part.value);}catch(error){try{await reader.cancel(error);}finally{release();controller.error(error);}}},
  async cancel(reason){try{await reader.cancel(reason);}finally{release();}}
 });
}
export function serverError(error: unknown) {
 const requestId=crypto.randomUUID();
 console.error(JSON.stringify({event:'storage_request_failed',requestId,time:new Date().toISOString(),type:error instanceof Error?error.name:'unknown'}));
 return Response.json({error:'保存先で問題が発生しました。少し待って再度お試しください。',requestId},{status:503,headers:{'Cache-Control':'private, no-store','X-Request-ID':requestId}});
}
