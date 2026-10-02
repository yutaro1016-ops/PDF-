"""Offline single-user export verification. No network or production write operations.

seal BACKUP NEW_MANIFEST; verify BACKUP MANIFEST; restore BACKUP MANIFEST NEW_STAGE
audit BACKUP MANIFEST EXISTING_STAGE (read-only)
Keep the manifest independently and securely: hashes are not a digital signature.
"""
import base64, hashlib, importlib.util, json, pathlib, re, shutil, sqlite3, sys, uuid

CHUNK = 8 * 1024 * 1024
OMITTED = ['original_user_id', 'shares', 'share_books', 'import_jobs', 'import_items',
           'account_lifecycle', 'storage_operations', 'thumbnail_cache', 'atomic_snapshot']

def file_at(root, name):
    if pathlib.PurePath(name).name != name or name in {'.', '..'}:
        raise ValueError('Unsafe file name')
    path = root / name
    if path.is_symlink() or not path.is_file():
        raise ValueError('Missing file or symlink: ' + name)
    return path

def digest(path):
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(CHUNK):
            sha.update(chunk)
    return {'bytes': path.stat().st_size, 'sha256': sha.hexdigest()}

def cover_bytes(value):
    if not value or value == 'first-page':
        return None
    match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)', value)
    if not match or len(value) > 200000:
        raise ValueError('Unsupported custom cover; export original image separately')
    return base64.b64decode(match[2], validate=True)

def inspect(source):
    source = pathlib.Path(source).resolve()
    meta = json.loads(file_at(source, 'metadata.json').read_text())
    complete = json.loads(file_at(source, 'COMPLETE.json').read_text())
    if set(meta) - {'format', 'version', 'exportedAt', 'scope', 'books', 'shelves'} or set(complete) - {'format', 'version', 'complete', 'pdfCount', 'completedAt'}:
        raise ValueError('Unknown export envelope fields; preserve original and update format support')
    if meta.get('format') != 'pdf-page-finder-backup' or meta.get('version') != 1 or complete.get('complete') is not True:
        raise ValueError('Incomplete or unsupported export')
    books, shelves = meta['books'], meta['shelves']
    ids, shelf_ids = set(), set()
    for shelf in shelves:
        if shelf['id'] in shelf_ids:
            raise ValueError('Duplicate shelf ID')
        shelf_ids.add(shelf['id'])
    files = {name: digest(file_at(source, name)) for name in ('metadata.json', 'COMPLETE.json')}
    images, page_total = {}, 0
    for book in books:
        ident = book['id']
        if str(uuid.UUID(ident)) != ident.lower() or ident in ids:
            raise ValueError('Invalid or duplicate PDF ID')
        ids.add(ident)
        if book['status'] != 'ready':
            raise ValueError('Export includes unfinished PDF; finish or separately preserve its job')
        if book.get('shelf_id') is not None and book['shelf_id'] not in shelf_ids:
            raise ValueError('Unknown shelf')
        for suffix in ('.pdf', '.pages.ndjson'):
            name = ident + suffix
            files[name] = digest(file_at(source, name))
        if files[ident + '.pdf']['bytes'] != book['file_size']:
            raise ValueError('PDF size mismatch')
        count, previous = 0, 0
        with file_at(source, ident + '.pages.ndjson').open() as stream:
            for line in stream:
                page = json.loads(line)
                number = page['number']
                if type(number) is not int or not previous < number <= book['page_count'] or not isinstance(page['body'], str) or not isinstance(page['normalized'], str):
                    raise ValueError('Invalid, duplicate or unordered search page')
                count += 1
                previous = number
        if count != book['indexed_pages']:
            raise ValueError('Index count mismatch')
        page_total += count
        image = cover_bytes(book.get('cover_image'))
        if image is not None:
            images[ident] = {'bytes': len(image), 'sha256': hashlib.sha256(image).hexdigest()}
    if complete.get('pdfCount') != len(books):
        raise ValueError('PDF count mismatch')
    # Detect local changes between initial validation and end of traversal.
    for name, expected in files.items():
        if digest(file_at(source, name)) != expected:
            raise ValueError('Export changed while hashing')
    return {'format': 'pdf-page-finder-migration-manifest', 'version': 1,
            'scope': 'single-user-export', 'consistency': 'checked-files-not-atomic-snapshot',
            'productionReady': False, 'omitted': OMITTED,
            'pdfs': len(books), 'pages': page_total, 'files': files, 'customCovers': images}

def seal(source, manifest):
    result = inspect(source)
    with pathlib.Path(manifest).open('x') as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
    return result

def verify(source, manifest):
    expected = json.loads(pathlib.Path(manifest).read_text())
    actual = inspect(source)
    if expected != actual:
        raise ValueError('Manifest mismatch: export changed or is incomplete')
    return actual

def audit(source, manifest, target):
    """Read-only comparison of an existing staging restore; never removes it."""
    source, target = pathlib.Path(source).resolve(), pathlib.Path(target).resolve()
    verified = verify(source, manifest)
    for folder in ('pdfs', 'images'):
        if (target / folder).is_symlink():
            raise ValueError('Staging folder cannot be a symlink')
    meta = json.loads(file_at(source, 'metadata.json').read_text())
    expected_pdfs = {book['id'] + '.pdf' for book in meta['books']}
    expected_images = {ident + '.cover' for ident in verified['customCovers']}
    for folder, expected in [('pdfs', expected_pdfs), ('images', expected_images)]:
        if {path.name for path in (target / folder).iterdir()} != expected:
            raise ValueError('Missing or unexpected staging objects: ' + folder)
    db_path = file_at(target, 'restored.sqlite')
    db = sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        db.execute('BEGIN')
        for table in ('shares', 'share_books', 'import_jobs', 'import_items', 'account_lifecycle', 'storage_operations'):
            if db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]:
                raise ValueError('Unexpected lifecycle/share/job state in single-user staging')
        for table, rows in [('books', meta['books']), ('shelves', meta['shelves'])]:
            if db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0] != len(rows):
                raise ValueError('Restored record count mismatch')
            for row in rows:
                matched = db.execute('SELECT * FROM ' + table + ' WHERE id=?', (row['id'],)).fetchone()
                if matched is None:
                    raise ValueError('Restored record ID mismatch: ' + table)
                actual = dict(matched)
                if actual.get('user_id') != 'recovery-staging':
                    raise ValueError('Unexpected staging owner')
                for key, value in row.items():
                    if key not in actual or actual[key] != value:
                        raise ValueError('Restored metadata differs: ' + key)
        for book in meta['books']:
            ident = book['id']
            if digest(file_at(target / 'pdfs', ident + '.pdf')) != verified['files'][ident + '.pdf']:
                raise ValueError('Restored PDF hash mismatch')
            with file_at(source, ident + '.pages.ndjson').open() as pages:
                for line in pages:
                    page = json.loads(line)
                    actual = db.execute('SELECT body,normalized FROM pages WHERE book_id=? AND page_number=?', (ident, page['number'])).fetchone()
                    if actual is None or tuple(actual) != (page['body'], page['normalized']):
                        raise ValueError('Restored search data differs')
            image = cover_bytes(book.get('cover_image'))
            if image is not None:
                path = file_at(target / 'images', ident + '.cover')
                if digest(path) != verified['customCovers'][ident]:
                    raise ValueError('Restored image mismatch')
        if db.execute('SELECT COUNT(*) FROM pages').fetchone()[0] != verified['pages']:
            raise ValueError('Restored index count differs')
    finally:
        db.close()
    verify(source, manifest)
    report = {'verified': ['pdf_ids', 'pdf_sha256', 'index_contents', 'shelf_and_book_metadata', 'inline_custom_covers'],
              'productionReady': False, 'owner': 'recovery-staging',
              'authenticationMappingApplied': False, 'omitted': OMITTED,
              'pdfs': verified['pdfs'], 'pages': verified['pages']}
    return report

def restore(source, manifest, target):
    source, target = pathlib.Path(source).resolve(), pathlib.Path(target)
    verify(source, manifest)
    if target.exists() or target.is_symlink():
        raise ValueError('Destination exists; nothing overwritten')
    spec = importlib.util.spec_from_file_location('legacy_restore', pathlib.Path(__file__).with_name('restore-backup.py'))
    legacy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    legacy.restore(source, target)
    try:
        (target / 'images').mkdir()
        metadata = json.loads(file_at(source, 'metadata.json').read_text())
        for book in metadata['books']:
            image = cover_bytes(book.get('cover_image'))
            if image is not None:
                (target / 'images' / (book['id'] + '.cover')).write_bytes(image)
        report = audit(source, manifest, target)
        (target / 'migration-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        return report
    except Exception:
        shutil.rmtree(target)
        raise

if __name__ == '__main__':
    try:
        action = sys.argv[1]
        if action == 'seal' and len(sys.argv) == 4:
            result = seal(*sys.argv[2:])
        elif action == 'verify' and len(sys.argv) == 4:
            result = verify(*sys.argv[2:])
        elif action == 'audit' and len(sys.argv) == 5:
            result = audit(*sys.argv[2:])
        elif action == 'restore' and len(sys.argv) == 5:
            result = restore(*sys.argv[2:])
        else:
            raise ValueError(__doc__)
        print(json.dumps({key: result[key] for key in ('pdfs', 'pages', 'productionReady')}, ensure_ascii=False))
    except (ValueError, OSError, KeyError, IndexError, TypeError, sqlite3.Error) as error:
        raise SystemExit(str(error))
