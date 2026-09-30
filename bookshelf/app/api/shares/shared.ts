import { bucket, database, fileKey, PART_BYTES } from '../library/shared';
export type Row = Record<string, any>;
export async function tokenHash(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return '';
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function activeShare(token: string) {
  const hash=await tokenHash(token); if (!hash) return null;
  return database().prepare('SELECT * FROM shares WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)').bind(hash,new Date().toISOString()).first<Row>();
}
export async function sharedBooks(share: Row) {
  const {results}=await database().prepare("SELECT b.id,b.title,b.file_size,b.tags,sb.position FROM share_books sb JOIN books b ON b.id=sb.book_id WHERE sb.share_id=? AND b.user_id=? AND b.status='ready' ORDER BY sb.position").bind(share.id,share.user_id).all<Row>();
  return results;
}
export async function jobView(id: string, user: string) {
  const job=await database().prepare('SELECT id,shelf_id AS shelfId,status FROM import_jobs WHERE id=? AND user_id=?').bind(id,user).first<Row>();
  if(!job)return null;
  const {results}=await database().prepare("SELECT source_id AS sourceId,target_id AS targetId,status,json_extract(metadata,'$.title') AS title,json_extract(metadata,'$.file_size') AS bytes,parts FROM import_items WHERE job_id=? ORDER BY position").bind(id).all<Row>();
  return {...job,items:results.map(row=>({sourceId:row.sourceId,targetId:row.targetId,status:row.status,title:row.title,bytes:row.bytes,copiedBytes:Math.min(JSON.parse(row.parts).length*PART_BYTES,row.bytes)})),done:results.filter(row=>row.status==='done').length,total:results.length};
}
// R2 copies stay bounded to one 8MB part; PDFs never pass through the browser.
export async function advanceItem(job: Row, item: Row, owner: string) {
  const db=database(), store=bucket(), meta=JSON.parse(item.metadata), targetKey=fileKey(job.user_id,item.target_id);
  if(item.status==='pending') {
    const source=await store.head(fileKey(owner,item.source_id));
    if(!source || source.size!==Number(meta.file_size))throw new Error('共有元のPDFが見つかりません。共有者に確認してください。');
    const upload=await store.createMultipartUpload(targetKey,{httpMetadata:{contentType:'application/pdf'}});
    try {await db.prepare("UPDATE import_items SET status='file',upload_id=? WHERE job_id=? AND source_id=?").bind(upload.uploadId,job.id,item.source_id).run();}
    catch(error){await upload.abort();throw error;} return;
  }
  if(item.status==='file') {
    const parts=JSON.parse(item.parts) as R2UploadedPart[], upload=store.resumeMultipartUpload(targetKey,item.upload_id);
    const offset=parts.length*PART_BYTES;
    if(offset<Number(meta.file_size)) {
      const object=await store.get(fileKey(owner,item.source_id),{range:{offset,length:Math.min(PART_BYTES,Number(meta.file_size)-offset)}});
      if(!object)throw new Error('共有元のPDFが見つかりません。');
      // A fixed, small buffer also works in environments without known-length streams.
      const part=await upload.uploadPart(parts.length+1,await object.arrayBuffer());
      parts.push(part);await db.prepare('UPDATE import_items SET parts=? WHERE job_id=? AND source_id=?').bind(JSON.stringify(parts),job.id,item.source_id).run();return;
    }
    // Retrying after a crash following complete() does not re-complete the upload.
    if(!await store.head(targetKey))await upload.complete(parts);
    const thumb=await store.get(`${owner}/${item.source_id}.thumbnail.jpg`);
    if(thumb)await store.put(`${job.user_id}/${item.target_id}.thumbnail.jpg`,await thumb.arrayBuffer(),{httpMetadata:{contentType:'image/jpeg'}});
    const now=new Date().toISOString();
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO books (id,user_id,title,file_name,file_size,page_count,indexed_pages,status,created_at,shelf_id,book_color,text_color,book_design,book_icon,cover_image,book_order,tags,updated_at) VALUES (?,?,?,?,?,?,0,'importing',?,?,?,?,?,?,?,(SELECT COALESCE(MAX(book_order),0)+1 FROM books WHERE user_id=? AND shelf_id IS ?),?,?)").bind(item.target_id,job.user_id,meta.title,meta.file_name,meta.file_size,meta.page_count,now,job.shelf_id,meta.book_color,meta.text_color,meta.book_design,meta.book_icon,meta.cover_image,job.user_id,job.shelf_id,meta.tags,now),
      db.prepare("UPDATE import_items SET status='pages' WHERE job_id=? AND source_id=?").bind(job.id,item.source_id)
    ]);return;
  }
  if(item.status==='pages') {
    const range=await db.prepare('SELECT MAX(page_number) AS last FROM (SELECT page_number FROM pages WHERE book_id=? AND page_number>? ORDER BY page_number LIMIT 25)').bind(item.source_id,item.page_cursor).first<{last:number|null}>();
    if(range?.last) {
      await db.batch([
        db.prepare('INSERT OR REPLACE INTO pages(book_id,page_number,body,normalized) SELECT ?,page_number,body,normalized FROM pages WHERE book_id=? AND page_number>? AND page_number<=?').bind(item.target_id,item.source_id,item.page_cursor,range.last),
        db.prepare('UPDATE import_items SET page_cursor=? WHERE job_id=? AND source_id=?').bind(range.last,job.id,item.source_id)
      ]);return;
    }
    await db.batch([
      db.prepare("UPDATE books SET status='ready',indexed_pages=(SELECT COUNT(*) FROM pages WHERE book_id=?) WHERE id=? AND user_id=?").bind(item.target_id,item.target_id,job.user_id),
      db.prepare("UPDATE import_items SET status='done' WHERE job_id=? AND source_id=?").bind(job.id,item.source_id)
    ]);
  }
}
export async function cancelJob(job: Row) {
  const db=database(),store=bucket();
  const {results}=await db.prepare("SELECT * FROM import_items WHERE job_id=? AND status!='done'").bind(job.id).all<Row>();
  for(const item of results){
    const key=fileKey(job.user_id,item.target_id);
    if(item.upload_id && !await store.head(key)){try{await store.resumeMultipartUpload(key,item.upload_id).abort();}catch(error){console.warn('Import abort failed',error);}}
    await store.delete([key,`${job.user_id}/${item.target_id}.thumbnail.jpg`]);
    await db.batch([db.prepare('DELETE FROM pages WHERE book_id=?').bind(item.target_id),db.prepare("DELETE FROM books WHERE id=? AND user_id=? AND status='importing'").bind(item.target_id,job.user_id)]);
  }
  await db.prepare("UPDATE import_jobs SET status='cancelled',updated_at=? WHERE id=?").bind(new Date().toISOString(),job.id).run();
}
