/** Offline AES-256-GCM file wrapper, version 1. No network or archive extraction.
 * encrypt|decrypt SOURCE PRIVATE_32_BYTE_KEY NEW_DESTINATION
 * Encrypt a private archive produced separately; does not create a DB/R2 snapshot.
 */
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {open,lstat,link,unlink} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const MAGIC=Buffer.from('PPFBENC1'),HEADER_BYTES=20,TAG_BYTES=16;
async function regular(file){const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink())throw Error('Regular file required');return st;}
export async function transform(action,source,keyPath,destination){
  if(!['encrypt','decrypt'].includes(action))throw Error('Unsupported action');
  const st=await regular(source),ks=await regular(keyPath);
  const maxPlaintext=2**36-32;
  if(st.size>(action==='encrypt'?maxPlaintext:maxPlaintext+HEADER_BYTES+TAG_BYTES))throw Error('Split archive below AES-GCM per-file size limit');
  if(ks.size!==32||(process.platform!=='win32'&&(ks.mode&0o077)))throw Error('Owner-only 32-byte key required');
  const keyFile=await open(keyPath,'r');let key;try{key=Buffer.alloc(32);if((await keyFile.read(key,0,32,0)).bytesRead!==32)throw Error('Incomplete key');}finally{await keyFile.close();}
  const temporary=path.join(path.dirname(destination),'.pdf-backup-'+randomBytes(16).toString('hex'));
  let created=false;
  try{
    let header,tag,start=0,end=st.size-1;
    if(action==='encrypt'){header=Buffer.concat([MAGIC,randomBytes(12)]);}
    else{
      if(st.size<HEADER_BYTES+TAG_BYTES)throw Error('Incomplete encrypted backup');
      const file=await open(source,'r');try{header=Buffer.alloc(HEADER_BYTES);tag=Buffer.alloc(TAG_BYTES);await file.read(header,0,HEADER_BYTES,0);await file.read(tag,0,TAG_BYTES,st.size-TAG_BYTES);}finally{await file.close();}
      if(!header.subarray(0,8).equals(MAGIC))throw Error('Unsupported encrypted backup version');
      start=HEADER_BYTES;end=st.size-TAG_BYTES-1;
    }
    const cipher=action==='encrypt'?createCipheriv('aes-256-gcm',key,header.subarray(8)):createDecipheriv('aes-256-gcm',key,header.subarray(8));
    cipher.setAAD(header);if(tag)cipher.setAuthTag(tag);
    const out=await open(temporary,'wx',0o600);created=true;
    try{if(action==='encrypt')await out.write(header);}finally{await out.close();}
    // Empty files still run cipher.final() through the empty readable stream.
    const input=end>=start?createReadStream(source,{start,end,highWaterMark:8*1024*1024}):createReadStream(source,{start:st.size});
    await pipeline(input,cipher,createWriteStream(temporary,{flags:'a',highWaterMark:8*1024*1024}));
    {const file=await open(temporary,'a');try{if(action==='encrypt')await file.write(cipher.getAuthTag());await file.sync();}finally{await file.close();}}
    // Hard-link publish fails if destination already exists; never overwrites it.
    await link(temporary,destination);await unlink(temporary);created=false;
    return {format:'pdf-page-finder-encrypted-file',version:1,productionSnapshot:false};
  }finally{key?.fill(0);if(created)await unlink(temporary).catch(()=>{});}
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  try{if(process.argv.length!==6)throw Error('Usage: encrypted-backup.mjs encrypt|decrypt SOURCE PRIVATE_KEY NEW_DESTINATION');await transform(...process.argv.slice(2));console.log('Offline encrypted file: complete (not a production snapshot)');}
  catch{console.error('Encrypted backup failed; check format, authentication, permissions and destination. Existing files preserved.');process.exitCode=1;}
}
