"""Restore a folder backup into a NEW local staging directory, never production.
Usage: python3 scripts/restore-backup.py BACKUP_FOLDER NEW_STAGING_FOLDER
"""
import hashlib,json,pathlib,shutil,sqlite3,sys

def restore(source,target):
    root=pathlib.Path(__file__).resolve().parents[1]
    source=pathlib.Path(source);target=pathlib.Path(target)
    if target.exists(): raise ValueError('Staging destination already exists; nothing was overwritten')
    metadata=json.loads((source/'metadata.json').read_text())
    complete=json.loads((source/'COMPLETE.json').read_text())
    if metadata.get('format')!='pdf-page-finder-backup' or metadata.get('version')!=1 or complete.get('complete') is not True:
        raise ValueError('Backup is incomplete or unsupported')
    ready=[book for book in metadata['books'] if book['status']=='ready']
    if complete['pdfCount']!=len(ready): raise ValueError('PDF count mismatch')
    import re
    for book in ready:
        if not re.fullmatch(r'[a-fA-F0-9-]{36}',book['id']): raise ValueError('Invalid PDF ID')
        pdf=source/(book['id']+'.pdf')
        if pdf.stat().st_size!=book['file_size']: raise ValueError('PDF size mismatch: '+book['id'])
        if not (source/(book['id']+'.pages.ndjson')).is_file(): raise ValueError('Search data is missing')
    target.mkdir();(target/'pdfs').mkdir();db=sqlite3.connect(target/'restored.sqlite');db.execute('PRAGMA foreign_keys=ON')
    try:
        for migration in sorted((root/'drizzle').glob('*.sql')): db.executescript(migration.read_text())
        hashes={}
        with db:
            for shelf in metadata['shelves']:
                cols=[key for key in shelf if key in {'id','name','shelf_order','color','board_color','text_color','design','created_at','updated_at'}]
                db.execute('INSERT INTO shelves('+','.join(cols)+',user_id) VALUES('+','.join('?' for _ in cols)+',?)',[shelf[key] for key in cols]+['recovery-staging'])
            allowed={row[1] for row in db.execute('PRAGMA table_info(books)')} - {'user_id','upload_id'}
            for book in ready:
                cols=[key for key in book if key in allowed]
                db.execute('INSERT INTO books('+','.join(cols)+',user_id) VALUES('+','.join('?' for _ in cols)+',?)',[book[key] for key in cols]+['recovery-staging'])
                count=0
                with (source/(book['id']+'.pages.ndjson')).open() as pages:
                    for line in pages:
                        page=json.loads(line)
                        if not isinstance(page['number'],int) or not 1<=page['number']<=book['page_count'] or not isinstance(page['body'],str) or not isinstance(page['normalized'],str): raise ValueError('Invalid search page')
                        db.execute('INSERT INTO pages VALUES(?,?,?,?)',(book['id'],page['number'],page['body'],page['normalized']));count+=1
                if count!=book['indexed_pages']: raise ValueError('Indexed-page count changed during backup; repeat export')
                sha=hashlib.sha256()
                with (source/(book['id']+'.pdf')).open('rb') as src,(target/'pdfs'/(book['id']+'.pdf')).open('wb') as dst:
                    while chunk:=src.read(8*1024*1024):sha.update(chunk);dst.write(chunk)
                hashes[book['id']]=sha.hexdigest()
        (target/'verified-hashes.json').write_text(json.dumps(hashes,indent=2))
        return {'pdfs':len(ready),'pages':db.execute('SELECT COUNT(*) FROM pages').fetchone()[0]}
    except Exception:
        db.close();shutil.rmtree(target);raise
    finally: db.close()

if __name__=='__main__':
    if len(sys.argv)!=3: raise SystemExit(__doc__)
    print(json.dumps(restore(sys.argv[1],sys.argv[2])))
