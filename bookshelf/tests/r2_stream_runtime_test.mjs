// Native workerd + local R2 emulation, not production Sites/R2 or browser QA.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{Miniflare}=require('miniflare'),ts=require('typescript');
const source=readFileSync(new URL('../app/api/library/shared.ts',import.meta.url),'utf8');
const helper=ts.transpileModule(source.slice(source.indexOf('export function expectedLengthBody'),source.indexOf('export function serverError')),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const operation=readFileSync(new URL('../app/api/account/storage-operation.ts',import.meta.url),'utf8');
const abortHelper=ts.transpileModule(operation.slice(operation.indexOf('export async function abortKnownMultipart')),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const script=helper+abortHelper+`
 export default {async fetch(request,env){
  const params=new URL(request.url).searchParams,expected=Number(params.get('expected'));
  try{
   if(params.get('abort')==='1'){const upload=await env.BUCKET.createMultipartUpload('abort.pdf');await abortKnownMultipart(env.BUCKET,'abort.pdf',upload.uploadId);await abortKnownMultipart(env.BUCKET,'abort.pdf',upload.uploadId);return Response.json({aborted:true});}
   let stream;
   if(params.get('generic')==='1'){const reader=request.body.getReader();stream=new ReadableStream({async pull(c){const p=await reader.read();if(p.done)c.close();else c.enqueue(p.value);}});}else stream=expectedLengthBody(request.body,expected);
   if(params.get('part')==='1'){const upload=await env.BUCKET.createMultipartUpload('part.pdf');try{const part=await upload.uploadPart(1,stream);const object=await upload.complete([part]);return Response.json({size:object.size});}catch(error){await upload.abort();throw error;}}
   const object=await env.BUCKET.put('test.pdf',stream);return Response.json({size:object.size});
  }catch(error){return Response.json({failed:true,type:error.name,reason:error.message}, {status:400});}
 }};`;
const runtime=new Miniflare({modules:true,script,compatibilityDate:'2026-05-15',r2Buckets:['BUCKET'],r2Persist:false});
try{
 for(const part of [false,true]){
  const send=(size,extra='')=>runtime.dispatchFetch('https://test.example/?expected=8'+(part?'&part=1':'')+extra,{method:'POST',body:new Uint8Array(size)});
  const valid=await send(8);assert.equal(valid.status,200);assert.equal((await valid.json()).size,8);
  assert.equal((await send(7)).status,400);assert.equal((await send(9)).status,400);
 }
 // Native R2 rejects the unknown-length wrapper used by the previous revision.
 const generic=await runtime.dispatchFetch('https://test.example/?expected=8&generic=1',{method:'POST',body:new Uint8Array(8)});assert.equal(generic.status,400);assert.match((await generic.json()).reason,/known.*length|length.*known/i);
 const abort=await runtime.dispatchFetch('https://test.example/?abort=1',{method:'POST',body:new Uint8Array(1)});assert.equal(abort.status,200);assert.equal((await abort.json()).aborted,true);
 console.log('Native workerd/local R2: known-length PUT/multipart, short/long rejection and generic-stream regression passed');
}finally{await runtime.dispose();}
