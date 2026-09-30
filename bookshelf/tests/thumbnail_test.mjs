import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const snippet=source.slice(source.indexOf('const thumbnailCache=new Map()'),source.indexOf('function setControls()'));
let active=0,maxActive=0,loads=0,fail=false,saves=0;
const element=tag=>({tag,isConnected:true,naturalWidth:140,decode:async function(){if(this.src==='bad-cache')throw Error('Malformed JPEG');},children:[],replaceChildren(...children){this.children=children;},cloneNode(){return {...this};},setAttribute(){},addEventListener(){},getContext(){return {};},toDataURL(){return 'data:image/jpeg;base64,abcd';},toBlob(cb){cb({size:4});}});
const context={setTimeout,clearTimeout,AbortController,console:{warn(){}},document:{createElement:element},pdfOptions:{},fetch:async(_url,options)=>{if(options?.method==='PUT'){saves++;return {ok:true};}return {ok:false,status:404};},pdfjsLib:{getDocument(){loads++;active++;maxActive=Math.max(maxActive,active);return {promise:fail?Promise.reject(new Error('PDF unavailable')):Promise.resolve({getPage:async()=>({getViewport:({scale})=>({width:100*scale,height:150*scale}),render:()=>({promise:new Promise(resolve=>setTimeout(resolve,5))})})}),destroy:async()=>{active--;}};}}};
vm.createContext(context);vm.runInContext(snippet+'\nglobalThis.runThumbnail=makeThumbnail;',context);
const a=element('div'),b=element('div');
await Promise.all([context.runThumbnail({id:'one',status:'ready'},a),context.runThumbnail({id:'one',status:'ready'},b)]);
assert.equal(loads,1,'Concurrent requests for the same book share one render');
assert.equal(a.children[0].tag,'img');assert.equal(b.children[0].tag,'img');assert.equal(saves,1,'Generated thumbnail is persisted');
await context.runThumbnail({id:'one',status:'ready'},element('div'));assert.equal(loads,1,'Cached images are reused');
await Promise.all([2,3,4,5].map(id=>context.runThumbnail({id:String(id),status:'ready'},element('div'))));assert.ok(maxActive<=2,'At most two PDFs are open for thumbnails');
fail=true;const broken=element('div');await context.runThumbnail({id:'broken',status:'ready'},broken);assert.equal(broken.children[0].tag,'button','A failed thumbnail offers a retry');assert.equal(active,0,'Failed tasks release PDF resources');

fail=false;context.FileReader=class {readAsDataURL(){this.result='bad-cache';this.onload();}};context.fetch=async(_url,options)=>options?.method==='PUT'?{ok:true}:{ok:true,blob:async()=>({size:4})};const before=loads;const corrupt=element('div');await context.runThumbnail({id:'corrupt-cache',status:'ready'},corrupt);assert.equal(loads,before+1,'A corrupt cached image regenerates the first page');assert.equal(corrupt.children[0].tag,'img');console.log('Thumbnail concurrency, failure retry and malformed cached-image regeneration passed');
