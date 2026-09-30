import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {webcrypto,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const root=path.resolve(import.meta.dirname,'..');
const proc=spawn('python3',[path.join(root,'tests/sqlite_bridge.py')],{stdio:['pipe','pipe','inherit']});
let serial=0;const pending=new Map();
readline.createInterface({input:proc.stdout}).on('line',line=>{const reply=JSON.parse(line),entry=pending.get(reply.id);pending.delete(reply.id);reply.error?entry.reject(Error(reply.error)):entry.resolve(reply.results);});
function query(statements){return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});proc.stdin.write(JSON.stringify({id,statements})+'\n');});}
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async run(){return (await query([this]))[0];}async all(){return this.run();}async first(){return (await this.run()).results[0]??null;}}
const db={prepare:sql=>new Statement(sql),batch:statements=>query(statements)};
const objects=new Map(),uploads=new Map();let maxRead=0,failPart=false;
function object(data,range){let bytes=data;if(range)bytes=data.subarray(range.offset,range.offset+range.length);return {size:data.byteLength,body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),arrayBuffer:async()=>{maxRead=Math.max(maxRead,bytes.byteLength);return bytes.slice().buffer;}};}
function upload(key,id){return {uploadId:id,uploadPart:async(number,data)=>{if(failPart){failPart=false;throw Error('temporary copy failure');}const u=uploads.get(id);assert(u);u.parts.set(number,new Uint8Array(data));return {partNumber:number,etag:'etag-'+number};},complete:async parts=>{const u=uploads.get(id);assert(u);const length=parts.reduce((n,p)=>n+u.parts.get(p.partNumber).length,0),result=new Uint8Array(length);let offset=0;for(const part of parts){const bytes=u.parts.get(part.partNumber);result.set(bytes,offset);offset+=bytes.length;}objects.set(key,result);uploads.delete(id);return {size:length};},abort:async()=>{uploads.delete(id);}};}
const bucket={head:async key=>objects.has(key)?{size:objects.get(key).length}:null,get:async(key,options)=>objects.has(key)?object(objects.get(key),options?.range):null,put:async(key,bytes)=>{objects.set(key,new Uint8Array(bytes));},delete:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);},createMultipartUpload:async key=>{const id=randomUUID();uploads.set(id,{key,parts:new Map()});return upload(key,id);},resumeMultipartUpload:upload};
let user='owner';
const libraryShared={database:()=>db,bucket:()=>bucket,currentUser:async()=>user,fileKey:(uid,id)=>`${uid}/${id}.pdf`,PART_BYTES:8*1024*1024,MAX_PDF_BYTES:1024**3,sameOrigin:req=>req.headers.get('origin')===new URL(req.url).origin,failure:(error,status=400)=>Response.json({error},{status}),serverError:error=>{console.error(error);return Response.json({error:'Storage failure'},{status:503});},ownedBook:(id,uid)=>db.prepare('SELECT * FROM books WHERE id=? AND user_id=?').bind(id,uid).first()};
const modules=new Map();
function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const source=readFileSync(file,'utf8'),exports={};modules.set(file,exports);const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{exports,require:specifier=>{const target=path.resolve(path.dirname(file),specifier)+'.ts';if(target===path.join(root,'app/api/library/shared.ts'))return libraryShared;return load(target);},crypto:{subtle:webcrypto.subtle,randomUUID},Response,Request,Headers,URL,TextEncoder,Uint8Array,Date,console,Number,JSON,Set,Array},{filename:file});return exports;}
const share=load(path.join(root,'app/api/shares/route.ts')),preview=load(path.join(root,'app/api/shares/[token]/route.ts')),createImport=load(path.join(root,'app/api/shares/[token]/import/route.ts')),advance=load(path.join(root,'app/api/shares/imports/[id]/route.ts')),library=load(path.join(root,'app/api/library/route.ts')),search=load(path.join(root,'app/api/search/route.ts')),fileRoute=load(path.join(root,'app/api/library/[id]/file/route.ts')),shelfRoute=load(path.join(root,'app/api/shelves/[id]/route.ts'));
const request=(body,method='POST',origin=true)=>new Request('https://test.example/api/shares',{method,headers:{...(origin?{origin:'https://test.example'}:{}),'content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
const context=values=>({params:Promise.resolve(values)});
const first=randomUUID(),second=randomUUID(),shelf=randomUUID();
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
 console.log('Sharing integration: ownership, copy, resume, search, ranges, revocation and cleanup passed');
}finally{proc.stdin.end();}
