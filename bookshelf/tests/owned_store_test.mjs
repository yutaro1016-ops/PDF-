// Real local Miniflare D1/R2. No Cloudflare account, Sites production or private data.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createRequire} from 'node:module';
import {SCHEMA,createOwnedStore,createImmutableStorage} from '../migration/owned-store.mjs';
import {createAccessBoundary} from '../migration/access-boundary.mjs';
const require=createRequire(import.meta.url),{Miniflare}=require('miniflare'),ts=require('typescript');
const folder=mkdtempSync(join(tmpdir(),'pdf-owned-store-'));
const source=readFileSync(new URL('../app/api/library/shared.ts',import.meta.url),'utf8');
const helper=ts.transpileModule(source.slice(source.indexOf('export function expectedLengthBody'),source.indexOf('export function serverError')),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const moduleSource=readFileSync(new URL('../migration/owned-store.mjs',import.meta.url),'utf8');
const pdf='12345678-1234-1234-1234-123456789abc';
const script=moduleSource+helper+`
export default {async fetch(request,env){
 const store=createOwnedStore({db:env.DB,proofVerifier:async()=>null,ledgerVerifier:async()=>null});
 const storage=createImmutableStorage({bucket:env.BUCKET,store,expectedLengthBody});
 const ctx={ownerId:'native-owner'},pdf='${pdf}';
 try{
  if(new URL(request.url).pathname==='/multipart'){const started=await storage.startMultipart(ctx,pdf);const part=await storage.uploadPart(started.operation,started.uploadId,1,request.body,Number(request.headers.get('x-test-length')));return Response.json(await storage.completeMultipart(started.operation,started.uploadId,[part]));}
  if(request.method==='POST'){const result=await storage.put(ctx,pdf,request.body,Number(request.headers.get('x-test-length')));return Response.json(result);}
  const value=await storage.get(ctx,pdf,{range:{offset:1,length:2}});return value?new Response(value.body):new Response('missing',{status:404});
 }catch{return new Response('refused',{status:409});}
}};`;
let runtime;
const options={modules:true,script,compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET'],d1Persist:join(folder,'db'),r2Persist:join(folder,'bucket')};
try{
 runtime=new Miniflare(options);let db=await runtime.getD1Database('DB');for(const sql of SCHEMA)await db.prepare(sql).run();
 const fixtureProof=async c=>c.proofReference==='signed-fixture'?{issuer:c.issuer,subject:c.subject,ownerId:c.originalUserId,proofReference:c.proofReference,approvalReference:'operator-approved-fixture'}:null;
 const store=createOwnedStore({db,proofVerifier:fixtureProof,ledgerVerifier:async entry=>entry});
 await store.provisionOwner('owner-a');await store.provisionOwner('owner-b');
 const claim={issuer:'trusted',subject:'new-a',originalUserId:'owner-a',proofReference:'signed-fixture'};
 await assert.rejects(()=>store.approveMapping({...claim,proofReference:'self-declared'}));
 await store.approveMapping(claim);await store.approveMapping(claim);
 await assert.rejects(()=>store.approveMapping({...claim,originalUserId:'owner-b'}));
 await assert.rejects(()=>store.approveMapping({...claim,subject:'another-subject'}));
 const authorize=createAccessBoundary({issuer:'trusted',audience:'app',verifySession:async()=>({issuer:'trusted',audience:'app',subject:'new-a',expiresAt:2000}),loadMapping:store.mapping,isBlocked:store.blocked});
 assert.equal((await authorize(new Request('https://fixture.test'),{now:1000})).ownerId,'owner-a');
 const context={ownerId:'owner-a'},old=await store.begin(context,pdf);assert(await store.publish(old));
 const newer=await store.begin(context,pdf);assert.equal(await store.visible(context,pdf),old.key,'pending replacement must preserve previous visible object');
 const newest=await store.begin(context,pdf);assert.equal(await store.publish(newer),false);assert(await store.publish(newest));
 assert.equal(await store.visible({ownerId:'owner-b'},pdf),null);
 await store.uncertain(newer);await assert.rejects(()=>store.begin(context,pdf));
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM migration_candidates WHERE owner='owner-a'").first()).n,3,'all candidate operations retained');
 await store.applyTombstone({ownerId:'owner-a',sequence:2,state:'deleted'});
 await store.applyTombstone({ownerId:'owner-a',sequence:1,state:'deleting'});
 assert.equal((await db.prepare("SELECT sequence FROM migration_tombstones WHERE owner='owner-a'").first()).sequence,2);
 assert.equal(await store.visible(context,pdf),null);assert.equal(await store.mapping('trusted','new-a'),null);assert.equal(await store.publish(newest),false);
 await assert.rejects(()=>store.applyTombstone({ownerId:'owner-a',sequence:2,state:'deleting'}));
 await store.applyTombstone({ownerId:'not-yet-restored',sequence:3,state:'deleted'});await assert.rejects(()=>store.provisionOwner('not-yet-restored'));
 // Object may commit after a returned error; its generation never becomes visible.
 await store.provisionOwner('unknown-owner');const lateContext={ownerId:'unknown-owner'};let late;
 const uncertainStorage=createImmutableStorage({bucket:{put:async(key)=>{late=key;throw Error('Unknown downstream result');}},store,expectedLengthBody:b=>b});
 await assert.rejects(()=>uncertainStorage.put(lateContext,pdf,new Response('PDF').body,3));
 const bucket=await runtime.getR2Bucket('BUCKET');await bucket.put(late,'late-data');assert.equal(await store.visible(lateContext,pdf),null);
 await store.applyTombstone({ownerId:'unknown-owner',sequence:4,state:'deleted'});assert.equal(await store.visible(lateContext,pdf),null);
 // Actual R2 upload uses the existing native FixedLengthStream implementation.
 await store.provisionOwner('native-owner');
 const response=await runtime.dispatchFetch('https://fixture.test',{method:'POST',headers:{'x-test-length':'4'},body:'PDF!'});assert.equal(response.status,200);assert((await response.json()).published);
 assert.equal(await (await runtime.dispatchFetch('https://fixture.test')).text(),'DF');
 const multipart=await runtime.dispatchFetch('https://fixture.test/multipart',{method:'POST',headers:{'x-test-length':'4'},body:'BOOK'});assert.equal(multipart.status,200);assert((await multipart.json()).published);assert.equal(await (await runtime.dispatchFetch('https://fixture.test')).text(),'OO');
 assert.equal((await runtime.dispatchFetch('https://fixture.test',{method:'POST',headers:{'x-test-length':'4'},body:'X'})).status,409);
 // Uncertainty must survive worker restart; no elapsed-time unlock.
 await runtime.dispose();runtime=new Miniflare(options);db=await runtime.getD1Database('DB');
 const restarted=createOwnedStore({db,proofVerifier:fixtureProof,ledgerVerifier:async entry=>entry});
 await assert.rejects(()=>restarted.begin({ownerId:'native-owner'},pdf));await assert.rejects(()=>restarted.provisionOwner('not-yet-restored'));
 console.log('Native local D1/R2 owned store: mapping uniqueness, auth integration, persistent tombstones, old/unknown generations, Range, FixedLengthStream and restart protection passed');
}finally{if(runtime)await runtime.dispose();rmSync(folder,{recursive:true,force:true});}
