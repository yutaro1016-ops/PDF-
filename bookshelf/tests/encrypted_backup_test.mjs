import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,chmod,truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';
import {transform} from '../scripts/encrypted-backup.mjs';
const root=await mkdtemp(path.join(tmpdir(),'pdf-encryption-fixture-'));
try{
 const key=path.join(root,'key');await writeFile(key,Buffer.alloc(32,7),{mode:0o600});
 for(const size of [0,31,8*1024*1024+9]){
  const src=path.join(root,'src'+size),enc=src+'.enc',out=src+'.out';const bytes=Buffer.alloc(size,123);await writeFile(src,bytes);
  await transform('encrypt',src,key,enc);await transform('decrypt',enc,key,out);assert.deepEqual(await readFile(out),bytes);
  const wrong=path.join(root,'wrong-key');await writeFile(wrong,Buffer.alloc(32,8),{mode:0o600});
  await assert.rejects(()=>transform('decrypt',enc,wrong,out+'.wrong'));
  await assert.rejects(()=>transform('decrypt',enc,key,out));assert.deepEqual(await readFile(out),bytes);
  const damaged=await readFile(enc);damaged[damaged.length-1]^=1;await writeFile(enc,damaged);
  await assert.rejects(()=>transform('decrypt',enc,key,out+'.bad'));assert(!(await readdir(root)).includes(path.basename(out+'.bad')));
 }
 assert(!(await readdir(root)).some(x=>x.startsWith('.pdf-backup-')));
 // A concurrent truncation used to silently produce a valid encrypted short file.
 const changing=path.join(root,'changing'),changingOut=changing+'.enc';await writeFile(changing,'');await truncate(changing,256*1024*1024);
 const outcome=transform('encrypt',changing,key,changingOut).then(()=>null,error=>error);
 let started=false;
 for(let i=0;i<1000;i++){if((await readdir(root)).some(x=>x.startsWith('.pdf-backup-'))){started=true;break;}await new Promise(resolve=>setTimeout(resolve,1));}
 assert(started);await truncate(changing,0);assert(await outcome instanceof Error);
 assert(!(await readdir(root)).includes(path.basename(changingOut)));assert(!(await readdir(root)).some(x=>x.startsWith('.pdf-backup-')));
 const truncated=path.join(root,'truncated');await writeFile(truncated,Buffer.from('PPFBENC1'));
 await assert.rejects(()=>transform('decrypt',truncated,key,truncated+'.out'));
 await chmod(key,0o644);await assert.rejects(()=>transform('encrypt',path.join(root,'src31'),key,path.join(root,'refused')));
 console.log('Offline AES-GCM: empty/multipart-sized files, corruption refusal, existing destination protection and failed plaintext cleanup passed');
}finally{await rm(root,{recursive:true,force:true});}
