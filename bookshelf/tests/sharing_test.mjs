import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {webcrypto,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {makePDF} from './pdf_fixture.mjs';
const ts=createRequire(import.meta.url)('typescript');
const root=path.resolve(import.meta.dirname,'..');
const proc=spawn('python3',[path.join(root,'tests/sqlite_bridge.py')],{stdio:['pipe','pipe','inherit']});
let serial=0;const pending=new Map();
readline.createInterface({input:proc.stdout}).on('line',line=>{const reply=JSON.parse(line),entry=pending.get(reply.id);pending.delete(reply.id);reply.error?entry.reject(Error(reply.error)):entry.resolve(reply.results);});
function query(statements){return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});proc.stdin.write(JSON.stringify({id,statements})+'\n');});}
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){assert(args.length<=100,'D1 parameter limit exceeded');return new Statement(this.sql,args);}async run(){if(failFinalize&&this.sql.includes("upload_id = NULL, status = 'ready'")){failFinalize=false;throw Error('simulated database interruption');}return (await query([this]))[0];}async all(){return this.run();}async first(){return (await this.run()).results[0]??null;}}
const db={prepare:sql=>new Statement(sql),batch:statements=>query(statements)};
const objects=new Map(),uploads=new Map();let maxRead=0,failPart=false,failFinalize=false,completeCalls=0;
function object(data,range){let bytes=data;if(range)bytes=data.subarray(range.offset,range.offset+range.length);return {size:data.byteLength,body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),arrayBuffer:async()=>{maxRead=Math.max(maxRead,bytes.byteLength);return bytes.slice().buffer;}};}
function upload(key,id){return {uploadId:id,uploadPart:async(number,data)=>{if(failPart){failPart=false;throw Error('temporary copy failure');}const u=uploads.get(id);assert(u);u.parts.set(number,await consume(data));return {partNumber:number,etag:'etag-'+number};},complete:async parts=>{completeCalls++;const u=uploads.get(id);assert(u);const length=parts.reduce((n,p)=>n+u.parts.get(p.partNumber).length,0),result=new Uint8Array(length);let offset=0;for(const part of parts){const bytes=u.parts.get(part.partNumber);result.set(bytes,offset);offset+=bytes.length;}objects.set(key,result);uploads.delete(id);return {size:length};},abort:async()=>{uploads.delete(id);}};}
const bucket={head:async key=>objects.has(key)?{size:objects.get(key).length}:null,get:async(key,options)=>objects.has(key)?object(objects.get(key),options?.range):null,put:async(key,bytes)=>{objects.set(key,await consume(bytes));},list:async({prefix='',limit=100}={})=>({objects:[...objects.keys()].filter(key=>key.startsWith(prefix)).slice(0,limit).map(key=>({key})),truncated:false}),delete:async keys=>{if(failDelete){failDelete=false;throw Error('simulated deletion outage');}for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);},createMultipartUpload:async key=>{const id=randomUUID();uploads.set(id,{key,parts:new Map()});return upload(key,id);},resumeMultipartUpload:upload};
let user='owner';const settings={CAPACITY_ENFORCED:'false',ACCOUNT_DELETION_ENABLED:'false'};let failDelete=false;
const libraryShared={database:()=>db,bucket:()=>bucket,authenticatedUser:async()=>user,currentUser:async()=>{if(!user)return null;const row=await db.prepare('SELECT status FROM account_lifecycle WHERE user_id=?').bind(user).first();return row&&row.status!=='active'?null:user;},fileKey:(uid,id)=>`${uid}/${id}.pdf`,PART_BYTES:8*1024*1024,MAX_PDF_BYTES:1024**3,sameOrigin:req=>req.headers.get('origin')===new URL(req.url).origin,failure:(error,status=400)=>Response.json({error},{status}),serverError:error=>{console.error(error);return Response.json({error:'Storage failure'},{status:503});},ownedBook:(id,uid)=>db.prepare('SELECT * FROM books WHERE id=? AND user_id=?').bind(id,uid).first()};
const helperSource=readFileSync(path.join(root,'app/api/library/shared.ts'),'utf8');
const limitedSource=helperSource.slice(helperSource.indexOf('export async function readLimitedBody'),helperSource.indexOf('export function serverError'));
const helperExports={};vm.runInNewContext(ts.transpileModule(limitedSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:helperExports,Uint8Array});libraryShared.readLimitedBody=helperExports.readLimitedBody;
const modules=new Map();
function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const source=readFileSync(file,'utf8'),exports={};modules.set(file,exports);const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{exports,require:specifier=>{if(specifier==='cloudflare:workers')return {env:settings};const target=path.resolve(path.dirname(file),specifier)+'.ts';if(target===path.join(root,'app/api/library/shared.ts'))return libraryShared;return load(target);},crypto:{subtle:webcrypto.subtle,randomUUID},ReadableStream,Response,Request,Headers,URL,TextEncoder,TextDecoder,atob,Uint8Array,Date,console,Number,JSON,Set,Array},{filename:file});return exports;}
const share=load(path.join(root,'app/api/shares/route.ts')),preview=load(path.join(root,'app/api/shares/[token]/route.ts')),createImport=load(path.join(root,'app/api/shares/[token]/import/route.ts')),advance=load(path.join(root,'app/api/shares/imports/[id]/route.ts')),library=load(path.join(root,'app/api/library/route.ts')),search=load(path.join(root,'app/api/search/route.ts')),fileRoute=load(path.join(root,'app/api/library/[id]/file/route.ts')),shelfRoute=load(path.join(root,'app/api/shelves/[id]/route.ts'));
const request=(body,method='POST',origin=true)=>new Request('https://test.example/api/shares',{method,headers:{...(origin?{origin:'https://test.example'}:{}),'content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
const context=values=>({params:Promise.resolve(values)});
const first=randomUUID(),second=randomUUID(),shelf=randomUUID();
async function consume(bytes){if(!bytes?.getReader)return new Uint8Array(bytes);const buffer=await new Response(bytes).arrayBuffer();return new Uint8Array(buffer);}
async function source(id,size,title,order){await db.prepare("INSERT INTO books(id,user_id,title,file_name,file_size,page_count,indexed_pages,status,created_at,shelf_id,book_order,book_color,cover_image,tags) VALUES(?,'owner',?,'source.pdf',?,1,1,'ready','2026-01-01',?,?,'#2f6078','first-page','[\"医療\"]')").bind(id,title,size,shelf,order).run();await db.prepare('INSERT INTO pages VALUES(?,1,?,?)').bind(id,'本文の検索語','本文の検索語').run();const bytes=new Uint8Array(size);bytes[0]=37;bytes[size-1]=42;objects.set(`owner/${id}.pdf`,bytes);}
try{
 await db.prepare("INSERT INTO shelves(id,user_id,name,color,design,created_at,updated_at) VALUES(?,'owner','共有本棚','#123456','wood','now','now')").bind(shelf).run();
 await source(first,8*1024*1024+17,'大きなPDF',1);await source(second,100,'小さなPDF',2);objects.set(`owner/${first}.thumbnail.jpg`,new Uint8Array([255,216,255,217]));
 user=null;assert.equal((await share.GET()).status,401);user='owner';assert.equal((await share.POST(request({kind:'shelf',shelfId:shelf},'POST',false))).status,403);
 const made=await share.POST(request({kind:'shelf',shelfId:shelf,expiryDays:7}));assert.equal(made.status,201);const shared=await made.json(),token=new URL(shared.url).searchParams.get('share');assert.equal(shared.count,2);
 user='recipient';assert.equal((await preview.GET(request(null,'GET'),context({token:'bad'}))).status,404);
 const data=await (await preview.GET(request(null,'GET'),context({token}))).json();assert.equal(data.books.length,2);assert.equal(data.books[0].id,first);
 assert.equal((await createImport.POST(request({requestId:randomUUID(),ids:[randomUUID()],mode:'existing'}),context({token}))).status,400);
 const jobId=randomUUID(),payload={requestId:jobId,ids:[first,second],mode:'new',shelfName:'取り込んだ本棚'};
 let response=await createImport.POST(request(payload),context({token}));assert.equal(response.status,201);let job=(await response.json()).job;
 const copiedShelf=await db.prepare('SELECT * FROM shelves WHERE id=?').bind(job.shelfId).first();assert.equal(copiedShelf.user_id,'recipient');assert.equal(copiedShelf.color,'#123456');assert.equal(copiedShelf.design,'wood');
 response=await createImport.POST(request(payload),context({token}));assert.equal((await response.json()).job.id,jobId);
 user='intruder';assert.equal((await advance.POST(request({}),context({id:jobId}))).status,404);user='recipient';
 await advance.POST(request({}),context({id:jobId}));failPart=true;assert.equal((await advance.POST(request({}),context({id:jobId}))).status,503);
 assert.equal((await library.GET()).status,200);assert.equal((await (await library.GET()).json()).books.length,0);
 let steps=0;while(job.status==='pending'&&steps++<30){const next=await advance.POST(request({}),context({id:jobId}));assert.equal(next.status,200);job=(await next.json()).job;}
 assert.equal(job.status,'done');assert.equal(job.done,2);assert(maxRead<=8*1024*1024);assert.equal(uploads.size,0);
 const ownBooks=(await (await library.GET()).json()).books;assert.equal(ownBooks.length,2);assert(ownBooks.every(b=>![first,second].includes(b.id)));assert(ownBooks.every(b=>b.indexedPages===1&&b.coverImage==='first-page'&&b.bookColor==='#2f6078'));
 const copied=job.items[0].targetId;assert.deepEqual(objects.get(`recipient/${copied}.pdf`),objects.get(`owner/${first}.pdf`));assert(objects.has(`recipient/${copied}.thumbnail.jpg`));
 const hit=await search.GET(new Request('https://test.example/api/search?q=検索語'));assert.equal((await hit.json()).results.length,2);
 const selected=await search.GET(new Request('https://test.example/api/search?q=検索語&book='+copied));assert.equal((await selected.json()).results.length,1);
 const range=await fileRoute.GET(new Request('https://test.example/api/file',{headers:{range:'bytes=0-0'}}),context({id:copied}));assert.equal(range.status,206);assert.equal(new Uint8Array(await range.arrayBuffer())[0],37);
 await shelfRoute.DELETE(request({},'DELETE'),context({id:job.shelfId}));assert.equal((await db.prepare('SELECT shelf_id FROM books WHERE id=?').bind(copied).first()).shelf_id,null);assert(objects.has(`recipient/${copied}.pdf`));
 user='owner';assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM books WHERE user_id=?').bind(user).first()).n,2);await share.DELETE(request({id:shared.id},'DELETE'));user='recipient';assert.equal((await preview.GET(request(null,'GET'),context({token}))).status,404);assert.equal((await (await library.GET()).json()).books.length,2);
 // Revocation during an incomplete copy blocks further reads, but owner can cancel it.
 user='owner';const again=await (await share.POST(request({kind:'books',ids:[first]}))).json(),token2=new URL(again.url).searchParams.get('share');user='recipient';const cancelledId=randomUUID();await createImport.POST(request({requestId:cancelledId,ids:[first],mode:'existing'}),context({token:token2}));await advance.POST(request({}),context({id:cancelledId}));user='owner';await share.DELETE(request({id:again.id},'DELETE'));user='recipient';assert.equal((await advance.POST(request({}),context({id:cancelledId}))).status,410);const cancelled=await (await advance.DELETE(request({},'DELETE'),context({id:cancelledId}))).json();assert.equal(cancelled.job.status,'cancelled');assert.equal(uploads.size,0);assert.equal((await (await library.GET()).json()).books.length,2);
 user='owner';const expired=await (await share.POST(request({kind:'books',ids:[first],expiryDays:1}))).json();await db.prepare("UPDATE shares SET expires_at='2000-01-01' WHERE id=?").bind(expired.id).run();user='recipient';assert.equal((await preview.GET(request(null,'GET'),context({token:new URL(expired.url).searchParams.get('share')}))).status,404);
 user='owner';const partial=await (await share.POST(request({kind:'books',ids:[second]}))).json();user='recipient';const partialId=randomUUID();await createImport.POST(request({requestId:partialId,ids:[second],mode:'existing'}),context({token:new URL(partial.url).searchParams.get('share')}));for(let n=0;n<3;n++)await advance.POST(request({}),context({id:partialId}));const pendingItem=await db.prepare('SELECT target_id FROM import_items WHERE job_id=?').bind(partialId).first();assert(objects.has(`recipient/${pendingItem.target_id}.pdf`));assert.equal((await (await library.GET()).json()).books.length,2);await advance.DELETE(request({},'DELETE'),context({id:partialId}));assert(!objects.has(`recipient/${pendingItem.target_id}.pdf`));assert.equal(await db.prepare('SELECT id FROM books WHERE id=?').bind(pendingItem.target_id).first(),null);

 const exportRoute=load(path.join(root,'app/api/account/export/route.ts')),usageRoute=load(path.join(root,'app/api/account/usage/route.ts')),restoreRoute=load(path.join(root,'app/api/account/restore/route.ts')),pagesExport=load(path.join(root,'app/api/library/[id]/export-pages/route.ts')),batchRoute=load(path.join(root,'app/api/library/batch/route.ts')),orderRoute=load(path.join(root,'app/api/library/order/route.ts'));
 const exportedResponse=await exportRoute.GET();assert.equal(exportedResponse.headers.get('cache-control'),'private, no-store');const exported=await exportedResponse.json();assert.equal(exported.books.length,2);assert(exported.books.every(b=>b.id!==first&&b.id!==second));assert(!JSON.stringify(exported).includes('recipient'));
 const backupBook=exported.books[0];await db.prepare('UPDATE books SET title=? WHERE id=?').bind('changed',backupBook.id).run();
 const restorePayload={format:exported.format,version:exported.version,books:[backupBook]};let restored=await restoreRoute.POST(request(restorePayload));assert.equal(restored.status,200);assert.equal((await db.prepare('SELECT title FROM books WHERE id=?').bind(backupBook.id).first()).title,'changed');
 restored=await restoreRoute.POST(request({...restorePayload,apply:true}));assert.equal(restored.status,200);assert.equal((await db.prepare('SELECT title FROM books WHERE id=?').bind(backupBook.id).first()).title,backupBook.title);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pages WHERE book_id=?').bind(backupBook.id).first()).n,1);
 user='intruder';assert.equal((await (await restoreRoute.POST(request({...restorePayload,apply:true}))).json()).matched,0);user='recipient';
 assert.equal((await restoreRoute.POST(request({...restorePayload,apply:true,books:[{...backupBook,book_color:'invalid'}]}))).status,400);
 const pageBackup=await (await pagesExport.GET(new Request('https://test.example/api/export-pages'),context({id:backupBook.id}))).json();assert.equal(pageBackup.pages[0].body,'本文の検索語');assert.equal((await pagesExport.GET(new Request('https://test.example/api/export-pages'),context({id:first}))).status,404);
 const usage=await (await usageRoute.GET()).json();assert.equal(usage.enforced,false);assert.equal(usage.proposedLimitBytes,5000000000);assert.equal(usage.reservedBytes,0);
 const ids=[...exported.books.map(b=>b.id)];for(let n=0;n<98;n++){const id=randomUUID();ids.push(id);await db.prepare("INSERT INTO books(id,user_id,title,file_name,file_size,status,created_at) VALUES(?,'recipient','fixture','test.pdf',100,'ready','now')").bind(id).run();}
 assert.equal((await batchRoute.PATCH(request({ids,tags:['bulk']},'PATCH'))).status,200);
 assert.equal((await orderRoute.PATCH(request({ids,shelfId:null},'PATCH'))).status,200);
 const manySearch=await search.POST(request({q:'検索語',books:[...ids,first]}));assert.equal(manySearch.status,200);assert.equal((await manySearch.json()).results.length,2);
 assert.equal((await batchRoute.PATCH(request({ids:[...ids.slice(0,99),first],tags:['forbidden']},'PATCH'))).status,404);
 assert.equal(await libraryShared.readLimitedBody(new Request('https://test.example',{method:'POST',body:new Uint8Array(65537)}),65536),null);
 const coverRoute=load(path.join(root,'app/api/library/[id]/cover/route.ts'));
 const image='data:image/jpeg;base64,/9j/2Q==';await db.prepare('UPDATE books SET cover_image=? WHERE id=?').bind(image,copied).run();
 assert.equal((await (await library.GET()).json()).books.find(b=>b.id===copied).coverImage,'custom');
 assert.equal((await coverRoute.GET(new Request('https://test.example/cover'),context({id:copied}))).status,200);
 assert.equal((await (await coverRoute.GET(new Request('https://test.example/cover?metadata=1'),context({id:copied}))).json()).image,image);
 user='intruder';assert.equal((await coverRoute.GET(new Request('https://test.example/cover'),context({id:copied}))).status,404);user='recipient';
 const multipart=load(path.join(root,'app/api/library/[id]/multipart/route.ts')),largeId=randomUUID(),size=8*1024*1024+17;
 await db.prepare("INSERT INTO books(id,user_id,title,file_name,file_size,status,created_at) VALUES(?,'recipient','multipart fixture','large.pdf',?,'uploading','now')").bind(largeId,size).run();
 const initialized=await (await multipart.POST(request({}),context({id:largeId}))).json();assert(initialized.uploadId);
 assert.equal((await (await multipart.POST(request({}),context({id:largeId}))).json()).uploadId,initialized.uploadId);
 const uploader=bucket.resumeMultipartUpload(`recipient/${largeId}.pdf`,initialized.uploadId);
 const parts=[await uploader.uploadPart(1,new Uint8Array(8*1024*1024)),await uploader.uploadPart(2,new Uint8Array(17))];
 const before=completeCalls;failFinalize=true;assert.equal((await multipart.POST(request({parts}),context({id:largeId}))).status,503);
 assert(objects.has(`recipient/${largeId}.pdf`));assert.equal((await multipart.POST(request({parts}),context({id:largeId}))).status,200);assert.equal(completeCalls,before+1);
 assert.equal((await db.prepare('SELECT status FROM books WHERE id=?').bind(largeId).first()).status,'ready');
 assert.equal((await multipart.POST(request({parts}),context({id:largeId}))).status,200);
 const indexDownload=load(path.join(root,'app/api/library/[id]/export-index/route.ts'));
 assert((await (await indexDownload.GET(new Request('https://test.example/index'),context({id:copied}))).text()).includes('本文の検索語'));
 assert.equal((await indexDownload.GET(new Request('https://test.example/index'),context({id:first}))).status,404);
 if(process.env.PDF_ENGINE_TEST==='true'){
  const canvas=createRequire(import.meta.url)('@napi-rs/canvas');Object.assign(globalThis,{DOMMatrix:canvas.DOMMatrix,ImageData:canvas.ImageData,Path2D:canvas.Path2D});
  const engine=await import('../public/vendor/legacy/pdf.min.mjs');engine.GlobalWorkerOptions.workerSrc=new URL('../public/vendor/legacy/pdf.worker.min.mjs',import.meta.url).href;
  const pageRoute=load(path.join(root,'app/api/library/[id]/pages/route.ts')),partRoute=load(path.join(root,'app/api/library/[id]/multipart/[part]/route.ts'));
  user='pdf-test';for(const padding of [0,32*1024*1024]){
   const bytes=makePDF(padding),created=await library.POST(request({title:'Self-authored test',fileName:'fixture.pdf',size:bytes.length}));assert.equal(created.status,201);const id=(await created.json()).id;
   const rawRequest=data=>new Request('https://test.example/upload',{method:'PUT',headers:{origin:'https://test.example','content-length':String(data.length)},body:data});
   if(padding){await multipart.POST(request({}),context({id}));const parts=[];for(let offset=0;offset<bytes.length;offset+=libraryShared.PART_BYTES){const part=await partRoute.PUT(rawRequest(bytes.subarray(offset,offset+libraryShared.PART_BYTES)),context({id,part:String(parts.length+1)}));assert.equal(part.status,200);parts.push(await part.json());}assert.equal((await multipart.POST(request({parts}),context({id}))).status,200);}else assert.equal((await fileRoute.PUT(rawRequest(bytes),context({id}))).status,200);
   assert.deepEqual(objects.get(`pdf-test/${id}.pdf`),bytes);
   const download=await fileRoute.GET(new Request('https://test.example/file'),context({id}));const task=engine.getDocument({data:new Uint8Array(await download.arrayBuffer()),isEvalSupported:false,standardFontDataUrl:new URL('../public/vendor/standard_fonts/',import.meta.url).pathname});const document=await task.promise;
   assert.equal((await pageRoute.PATCH(request({pageCount:document.numPages},'PATCH'),context({id}))).status,200);const pages=[];for(let n=1;n<=document.numPages;n++){const text=(await (await document.getPage(n)).getTextContent()).items.map(item=>item.str??'').join(' ');pages.push({number:n,text,normalized:text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'')});}
   assert.equal((await pageRoute.POST(request({pages}),context({id}))).status,200);assert.equal((await (await search.POST(request({q:'MEDICAL-STUDENT-TEST',books:[id]}))).json()).results.length,3);await task.destroy();
  }user='recipient';console.log('Real normal/32MB+ PDFs: API registration, streamed upload, retrieval, PDF.js extraction, indexing and search passed');
 }
 // Capacity checks reserve in the same statement/transaction as registration.
 settings.CAPACITY_ENFORCED='true';user='quota';const quotaBook=randomUUID();
 await db.prepare("INSERT INTO books(id,user_id,title,file_name,file_size,status,created_at) VALUES(?,'quota','used','used.pdf',?,'ready','now')").bind(quotaBook,5000000000-100).run();
 const registered=await Promise.all([library.POST(request({fileName:'a.pdf',title:'a',size:60})),library.POST(request({fileName:'b.pdf',title:'b',size:60}))]);assert.deepEqual(registered.map(r=>r.status).sort(),[201,409]);
 assert.equal((await (await usageRoute.GET()).json()).enforced,true);
 user='owner';const quotaShare=await (await share.POST(request({kind:'books',ids:[second]}))).json();user='quota-import';const usedId=randomUUID();await db.prepare("INSERT INTO books(id,user_id,title,file_name,file_size,status,created_at) VALUES(?,'quota-import','used','used.pdf',?,'ready','now')").bind(usedId,5000000000-150).run();
 const quotaJob=randomUUID();const quotaStarted=await createImport.POST(request({requestId:quotaJob,ids:[second],mode:'existing'}),context({token:new URL(quotaShare.url).searchParams.get('share')}));assert.equal(quotaStarted.status,201);assert.equal((await (await usageRoute.GET()).json()).reservedBytes,100);
 assert.equal((await library.POST(request({fileName:'c.pdf',title:'c',size:60}))).status,409);await advance.DELETE(request({},'DELETE'),context({id:quotaJob}));assert.equal((await (await usageRoute.GET()).json()).reservedBytes,0);assert.equal((await library.POST(request({fileName:'c.pdf',title:'c',size:60}))).status,201);
 settings.CAPACITY_ENFORCED='false';user='recipient';
 // Closure is disabled in production configuration; tests opt in explicitly.
 const closure=load(path.join(root,'app/api/account/closure/route.ts'));
 assert.equal((await closure.POST(request({action:'prepare'}))).status,409);
 user='closing';const closingId=randomUUID();await db.prepare("INSERT INTO books(id,user_id,title,file_name,file_size,status,created_at) VALUES(?,'closing','test account','test.pdf',10,'ready','now')").bind(closingId).run();objects.set(`closing/${closingId}.pdf`,new Uint8Array(10));objects.set('closing/orphan.thumbnail.jpg',new Uint8Array(4));
 settings.ACCOUNT_DELETION_ENABLED='true';const prepared=await (await closure.POST(request({action:'prepare'}))).json();assert(prepared.nonce);
 assert.equal((await closure.POST(request({action:'start',nonce:prepared.nonce,confirm:'wrong',exportAcknowledged:true}))).status,400);
 user='intruder';assert.equal((await closure.POST(request({action:'start',nonce:prepared.nonce,confirm:'退会してすべて削除',exportAcknowledged:true}))).status,409);user='closing';
 const started=await (await closure.POST(request({action:'start',nonce:prepared.nonce,confirm:'退会してすべて削除',exportAcknowledged:true}))).json();assert.equal(started.state.status,'deleting');assert.equal((await library.GET()).status,401);
 failDelete=true;assert.equal((await closure.POST(request({action:'advance',jobId:started.state.jobId}))).status,503);assert(objects.has(`closing/${closingId}.pdf`));
 let state=started;for(let n=0;n<10&&state.state.status!=='deleted';n++){const response=await closure.POST(request({action:'advance',jobId:started.state.jobId}));assert.equal(response.status,200);state=await response.json();}
 assert.equal(state.state.status,'deleted');assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM books WHERE user_id='closing'").first()).n,0);assert(![...objects.keys()].some(k=>k.startsWith('closing/')));assert(objects.has(`owner/${first}.pdf`));assert(objects.has(`recipient/${copied}.pdf`));
 assert.equal((await library.POST(request({fileName:'new.pdf',title:'new',size:10}))).status,401);
 settings.ACCOUNT_DELETION_ENABLED='false';user='recipient';
 console.log('Atomic quota reservation, disabled closure, ownership and resumable test-account closure passed');
 console.log('Multipart database-interruption recovery and private lazy covers passed');
 console.log('Sales readiness: private export, safe restore, usage, 100-book operations and bounded bodies passed');
 console.log('Sharing integration: ownership, copy, resume, search, ranges, revocation and cleanup passed');
}finally{proc.stdin.end();}
