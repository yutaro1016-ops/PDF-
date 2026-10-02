// Additional CPU/image/page-count workloads; not real browser or production QA.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {makePagedPDF} from './pdf_fixture.mjs';
const canvas=createRequire(import.meta.url)('@napi-rs/canvas');
Object.assign(globalThis,{DOMMatrix:canvas.DOMMatrix,ImageData:canvas.ImageData,Path2D:canvas.Path2D});
const engine=await import('../public/vendor/legacy/pdf.min.mjs');engine.GlobalWorkerOptions.workerSrc=new URL('../public/vendor/legacy/pdf.worker.min.mjs',import.meta.url).href;
class CanvasFactory{create(width,height){const element=canvas.createCanvas(width,height);return {canvas:element,context:element.getContext('2d')};}reset(value,width,height){value.canvas.width=width;value.canvas.height=height;}destroy(value){value.canvas.width=0;value.canvas.height=0;value.canvas=null;value.context=null;}}
const images=[];let seed=12345;for(let n=0;n<24;n++){const target=canvas.createCanvas(768,768),context=target.getContext('2d'),data=context.createImageData(768,768);for(let i=0;i<data.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data.data[i]=seed&255;data.data[i+1]=(seed>>>8)&255;data.data[i+2]=(seed>>>16)&255;data.data[i+3]=255;}context.putImageData(data,0,0);images.push(target.toBuffer('image/jpeg'));}
for(const [name,count,jpegs] of [['many-pages',2000,[]],['image-pages',24,images]]){
 const bytes=makePagedPDF(count,jpegs),size=bytes.length,start=Date.now(),task=engine.getDocument({data:bytes,isEvalSupported:false,CanvasFactory,standardFontDataUrl:new URL('../public/vendor/standard_fonts/',import.meta.url).pathname});
 try{const pdf=await task.promise;assert.equal(pdf.numPages,count);for(let n=1;n<=count;n++){const page=await pdf.getPage(n);assert((await page.getTextContent()).items.some(item=>item.str===`STUDY-PAGE-${String(n).padStart(5,'0')}`));page.cleanup();}
  for(const n of [1,count]){const page=await pdf.getPage(n),viewport=page.getViewport({scale:.2}),target=canvas.createCanvas(viewport.width,viewport.height);await page.render({canvasContext:target.getContext('2d'),viewport}).promise;const data=target.getContext('2d').getImageData(0,0,target.width,target.height).data;assert(data.some((value,i)=>i%4!==3&&value<230));if(jpegs.length){let colored=0;for(let i=0;i<data.length;i+=4)if(Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2])>8)colored++;assert(colored>1000,'JPEG content rendered');}page.cleanup();}
  console.log(JSON.stringify({test:'content_pdf_engine',name,pages:count,bytes:size,elapsedMs:Date.now()-start,result:'passed'}));
 }finally{await task.destroy();}
}
