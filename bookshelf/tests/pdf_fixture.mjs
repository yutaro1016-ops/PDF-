// Self-authored, valid PDF; no patient or third-party content. Extra stream exercises large-file storage.
export function makePDF(padding=0){
 const text=n=>`BT /F1 18 Tf 40 740 Td (MEDICAL-STUDENT-TEST page ${n}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 for(let n=1;n<=3;n++){objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${n*2+3} 0 R >>`);const content=text(n);objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);}
 if(padding)objects.push(Buffer.concat([Buffer.from(`<< /Length ${padding} >>\nstream\n`),Buffer.alloc(padding,32),Buffer.from('\nendstream')]));
 const chunks=[Buffer.from('%PDF-1.7\n')],offsets=[0];let offset=chunks[0].length;
 objects.forEach((obj,i)=>{offsets.push(offset);const data=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),Buffer.from(obj),Buffer.from('\nendobj\n')]);chunks.push(data);offset+=data.length;});
 const xref=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;chunks.push(Buffer.from(xref));return new Uint8Array(Buffer.concat(chunks));
}

// Disk writer for large fixtures: never allocates the padding in memory.
export async function writePDF(destination,padding=0){
 const {open}=await import('node:fs/promises');
 if(!Number.isSafeInteger(padding)||padding<0)throw new RangeError('Invalid padding');
 const handle=await open(destination,'wx');let offset=0;
 const write=async data=>{const bytes=Buffer.from(data);let done=0;while(done<bytes.length){const result=await handle.write(bytes,done,bytes.length-done,offset);if(!result.bytesWritten)throw Error('Fixture write stalled');done+=result.bytesWritten;offset+=result.bytesWritten;}};
 try{
  const small=makePDF();const marker=Buffer.from(small).indexOf('xref\n');
  const prefix=Buffer.from(small).subarray(0,marker);await write(prefix);
  const offsets=[...prefix.toString().matchAll(/^(\d+) 0 obj$/gm)].map(match=>match.index);
  const extraOffset=offset;
  if(padding){await write(`10 0 obj\n<< /Length ${padding} >>\nstream\n`);const chunk=Buffer.alloc(1024*1024,32);for(let left=padding;left>0;left-=chunk.length)await write(chunk.subarray(0,Math.min(left,chunk.length)));await write('\nendstream\nendobj\n');offsets.push(extraOffset);}
  const xrefOffset=offset;
  await write(`xref\n0 ${offsets.length+1}\n0000000000 65535 f \n`+offsets.map(value=>String(value).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${offsets.length+1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return offset;
 }finally{await handle.close();}
}

// Self-authored text pages, optionally with self-generated JPEGs on each page.
export function makePagedPDF(count,images=[]){
 if(!Number.isInteger(count)||count<1||count>20000)throw new RangeError('Invalid pages');
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],kids=[];
 for(let page=1;page<=count;page++){
  const id=objects.length+1,jpeg=images.length?images[(page-1)%images.length]:null;kids.push(`${id} 0 R`);
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> ${jpeg?`/XObject << /Im0 ${id+2} 0 R >>`:''} >> /Contents ${id+1} 0 R >>`);
  const content=`BT /F1 18 Tf 40 740 Td (STUDY-PAGE-${String(page).padStart(5,'0')}) Tj ET`+(jpeg?'\nq 520 0 0 520 40 100 cm /Im0 Do Q':'');
  objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  if(jpeg)objects.push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 768 /Height 768 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]));
 }
 objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>`;
 const chunks=[Buffer.from('%PDF-1.7\n')],offsets=[];let offset=chunks[0].length;
 objects.forEach((object,i)=>{offsets.push(offset);const chunk=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),Buffer.from(object),Buffer.from('\nendobj\n')]);chunks.push(chunk);offset+=chunk.length;});
 chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(value=>String(value).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));return new Uint8Array(Buffer.concat(chunks));
}
