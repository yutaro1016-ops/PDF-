import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {makePDF} from './pdf_fixture.mjs';
const canvas=createRequire(import.meta.url)('@napi-rs/canvas');
Object.assign(globalThis,{DOMMatrix:canvas.DOMMatrix,ImageData:canvas.ImageData,Path2D:canvas.Path2D});
const pdfjs=await import('../public/vendor/legacy/pdf.min.mjs');
pdfjs.GlobalWorkerOptions.workerSrc=new URL('../public/vendor/legacy/pdf.worker.min.mjs',import.meta.url).href;
class CanvasFactory{create(width,height){const element=canvas.createCanvas(width,height);return {canvas:element,context:element.getContext('2d')};}reset(value,width,height){value.canvas.width=width;value.canvas.height=height;}destroy(value){value.canvas.width=0;value.canvas.height=0;value.canvas=null;value.context=null;}}
for(const padding of [0,32*1024*1024]){
 const bytes=makePDF(padding),task=pdfjs.getDocument({data:bytes,isEvalSupported:false,CanvasFactory,standardFontDataUrl:new URL('../public/vendor/standard_fonts/',import.meta.url).pathname});const document=await task.promise;assert.equal(document.numPages,3);
 for(let n=1;n<=3;n++){const page=await document.getPage(n),content=await page.getTextContent();assert(content.items.some(item=>item.str.includes('MEDICAL-STUDENT-TEST')));}
 const page=await document.getPage(1),viewport=page.getViewport({scale:.2}),target=canvas.createCanvas(viewport.width,viewport.height);await page.render({canvasContext:target.getContext('2d'),viewport}).promise;const jpg=target.toBuffer('image/jpeg');assert(jpg.length>500&&jpg.length<=65536);const pixels=target.getContext('2d').getImageData(0,0,target.width,target.height).data;assert(pixels.some((v,i)=>i%4!==3&&v<230),'First-page image contains visible text');await task.destroy();console.log(`Real PDF engine: ${padding?'32MB+':'normal'}, text extraction and first-page rendering passed`);
}
