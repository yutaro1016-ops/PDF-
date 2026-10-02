// Offline execution of the actual TypeScript route with synthetic auth/R2.
// No production service, PDF content, credentials, packages or network calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const path = process.env.PDF_ROUTE_SOURCE || new URL('../app/api/library/[id]/file/route.ts', import.meta.url);
const raw = readFileSync(path, 'utf8');
const source = stripTypeScriptTypes(raw.replace(/^import[^\n]*;\n/gm, ''), {mode:'strip'})
 .replace(/export\s+(?=(async\s+)?function|const)/g, '');
let user='owner', bookOwner='owner', exists=true, reads=0, heads=0, objectExists=true;
const bytes=new TextEncoder().encode('0123456789');
const store={head:async key=>{heads++;assert.equal(key,'owner/book.pdf');return exists?{size:bytes.length}:null;},get:async(key,options)=>{
 reads++;assert.equal(key,'owner/book.pdf');if(!objectExists)return null;
 const data=options?.range?bytes.slice(options.range.offset,options.range.offset+options.range.length):bytes;
 return {body:new ReadableStream({start(c){c.enqueue(data);c.close();}})};
}};
const globals={Request,Response,Headers,URL,Number,Math,encodeURIComponent,
 currentUser:async()=>user,ownedBook:async()=>user===bookOwner?{file_name:'資料.pdf'}:null,
 bucket:()=>store,fileKey:(uid,id)=>`${uid}/${id}.pdf`,failure:(error,status=400)=>Response.json({error},{status}),
 serverError:()=>Response.json({error:'storage failed'},{status:503})};
const context=vm.createContext(globals);vm.runInContext(source+'\nglobalThis.routes={GET,HEAD};',context);
const routes=context.routes;
function reset(){user='owner';bookOwner='owner';exists=true;objectExists=true;reads=0;heads=0;}
async function call(method='GET',range=null,search='',extraHeaders={}){
 const headers={...extraHeaders,...(range===null?{}:{range})};
 return routes[method](new Request('https://test.invalid/api/library/book/file'+search,{method,headers}),{params:Promise.resolve({id:'book'})});
}
let passed=0;async function check(name,fn){reset();await fn();passed++;console.log('PASS '+name);}
await check('HEAD with Range has full metadata and performs no body read',async()=>{
 const r=await call('HEAD','bytes=0-3');assert.equal(r.status,200);assert.equal(r.body,null);assert.equal(r.headers.get('content-length'),'10');assert.equal(r.headers.get('content-range'),null);assert.equal(reads,0);assert.equal(heads,1);
});
await check('HEAD ignores invalid Range',async()=>{const r=await call('HEAD','bytes=bad');assert.equal(r.status,200);assert.equal(r.body,null);assert.equal(reads,0);});
await check('HEAD has same download metadata without storage body',async()=>{const r=await call('HEAD',null,'?download=1');assert.equal(r.body,null);assert.match(r.headers.get('content-disposition'),/attachment/);assert.equal(reads,0);});
await check('GET without Range returns full body',async()=>{const r=await call();assert.equal(r.status,200);assert.equal(await r.text(),'0123456789');assert.equal(r.headers.get('content-length'),'10');assert.equal(reads,1);});
for(const [range,start,end,body] of [['bytes=2-5',2,5,'2345'],['bytes=2-',2,9,'23456789'],['bytes=-3',7,9,'789'],['bytes=-100',0,9,'0123456789'],['bytes=2-100',2,9,'23456789'],['bytes=0-0',0,0,'0']]){
 await check('GET '+range,async()=>{const r=await call('GET',range);assert.equal(r.status,206);assert.equal(await r.text(),body);assert.equal(r.headers.get('content-range'),`bytes ${start}-${end}/10`);assert.equal(Number(r.headers.get('content-length')),body.length);assert.equal(reads,1);});
}
for(const range of ['bytes=10-','bytes=9-3','bytes=-0','bytes=-','bytes=1-2,4-5','bytes=1.5-3','bytes=9007199254740992-','bytes=0-9007199254740992','bytes=-9007199254740992']){
 await check('reject unsupported/invalid '+range,async()=>{const r=await call('GET',range);assert.equal(r.status,416);assert.equal(r.body,null);assert.equal(r.headers.get('content-range'),'bytes */10');assert.equal(reads,0);});
}
await check('unsupported range unit is ignored',async()=>{const r=await call('GET','items=2-4');assert.equal(r.status,200);assert.equal(await r.text(),'0123456789');});
for(const validator of ['"stale-etag"','Wed, 01 Jan 2020 00:00:00 GMT']){
 await check('If-Range without verified validator returns complete representation '+validator,async()=>{
  const r=await call('GET','bytes=2-5','',{'if-range':validator});
  assert.equal(r.status,200);assert.equal(await r.text(),'0123456789');
  assert.equal(r.headers.get('content-range'),null);assert.equal(r.headers.get('content-length'),'10');assert.equal(reads,1);
 });
}
await check('HEAD with Range and If-Range remains body-free metadata',async()=>{
 const r=await call('HEAD','bytes=2-5','',{'if-range':'"stale-etag"'});
 assert.equal(r.status,200);assert.equal(r.body,null);assert.equal(r.headers.get('content-range'),null);
 assert.equal(r.headers.get('content-length'),'10');assert.equal(reads,0);assert.equal(heads,1);
});
await check('anonymous cannot probe owner file or metadata',async()=>{user=null;const r=await call('GET','bytes=-3');assert.equal(r.status,401);assert.equal(heads,0);assert.equal(reads,0);});
await check('another owner cannot probe file or metadata',async()=>{bookOwner='other';const r=await call('GET','bytes=-3');assert.equal(r.status,404);assert.equal(heads,0);assert.equal(reads,0);});
await check('missing object metadata produces 404 without body read',async()=>{exists=false;const r=await call('GET','bytes=-3');assert.equal(r.status,404);assert.equal(reads,0);});
await check('object removed after HEAD produces 404',async()=>{objectExists=false;const r=await call('GET','bytes=2-4');assert.equal(r.status,404);assert.equal(reads,1);});
console.log(`${passed} offline file-route cases passed; no production or network calls`);
