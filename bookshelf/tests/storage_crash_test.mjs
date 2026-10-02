// Real local workerd termination + persisted D1; not a Sites production drill.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{Miniflare}=require('miniflare'),ts=require('typescript');
const path=mkdtempSync(join(tmpdir(),'pdf-crash-'));
const source=readFileSync(new URL('../app/api/account/storage-operation.ts',import.meta.url),'utf8').replace(/^import .*library\/shared.*;\n/m,'');
const helper=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const script=helper+`
function database(){return env.DB;}
function failure(message,status){return Response.json({message},{status});}
function serverError(){return new Response('error',{status:503});}
export default {async fetch(request){const url=new URL(request.url),user=url.searchParams.get('user');let token=null;try{token=await beginStorageOperation(user,'test');if(url.searchParams.has('hold'))await new Promise(()=>{});return new Response('ok');}catch(error){return storageError(error);}finally{await endStorageOperation(user,token);}}};`;
const options={modules:true,script,compatibilityDate:'2026-05-15',d1Databases:['DB'],d1Persist:path,bindings:{STORAGE_OPERATION_GUARD_ENABLED:'true'}};
let runtime;
try{
 runtime=new Miniflare(options);let db=await runtime.getD1Database('DB');
 await db.exec("CREATE TABLE account_lifecycle(user_id TEXT,status TEXT,job_id TEXT); CREATE TABLE storage_operations(user_id TEXT PRIMARY KEY,token TEXT,kind TEXT,created_at TEXT);");
 const stopped=runtime.dispatchFetch('https://test.example/?user=crashed&hold=1').then(()=>null,()=>null);
 let row;
 for(let i=0;i<100;i++){row=await db.prepare("SELECT * FROM storage_operations WHERE user_id='crashed'").first();if(row)break;await new Promise(r=>setTimeout(r,20));}
 assert(row,'worker must acquire barrier before termination');
 await runtime.dispose();await stopped;
 runtime=new Miniflare(options);db=await runtime.getD1Database('DB');
 assert.equal((await db.prepare("SELECT token FROM storage_operations WHERE user_id='crashed'").first()).token,row.token);
 assert.equal((await runtime.dispatchFetch('https://test.example/?user=crashed')).status,409);
 assert.equal((await runtime.dispatchFetch('https://test.example/?user=independent')).status,200);
 // No forced unlock: termination of this test runtime proves nothing about Sites R2.
 console.log('Native local workerd termination: persisted barrier survives restart, same user blocked, other user independent');
}finally{if(runtime)await runtime.dispose();rmSync(path,{recursive:true,force:true});}
