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
