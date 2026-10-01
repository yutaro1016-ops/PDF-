"""Read-only local SQLite measurement; no remote credentials or D1 mutation.
Usage: python3 scripts/staging-capacity.py PRIVATE_STAGE/restored.sqlite
This aggregate report is not a cloud bill or a D1 performance measurement.
"""
import json, pathlib, sqlite3, sys

def measure(path):
    path = pathlib.Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Expected a regular local staging database')
    db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        db.execute('BEGIN')
        page_size = db.execute('PRAGMA page_size').fetchone()[0]
        page_count = db.execute('PRAGMA page_count').fetchone()[0]
        free_pages = db.execute('PRAGMA freelist_count').fetchone()[0]
        books, pdf_bytes = db.execute('SELECT COUNT(*),COALESCE(SUM(file_size),0) FROM books').fetchone()
        pages, text_bytes = db.execute('SELECT COUNT(*),COALESCE(SUM(length(CAST(body AS BLOB))+length(CAST(normalized AS BLOB))),0) FROM pages').fetchone()
        return {'scope': 'local-staging-only', 'books': books, 'pdfDeclaredBytes': pdf_bytes,
                'indexedPages': pages, 'indexTextBytes': text_bytes,
                'databaseAllocatedBytes': page_size * page_count,
                'databaseFreePageBytes': page_size * free_pages,
                'singleD1CapacityReviewAt8GB': page_size * page_count >= 8_000_000_000,
                'cloudCostMeasured': False}
    finally:
        db.close()

if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit(__doc__)
    print(json.dumps(measure(sys.argv[1])))
