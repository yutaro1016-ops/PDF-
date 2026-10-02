"""The bookshelf schema preserves existing PDF identifiers and page search rows."""
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class MigrationTest(unittest.TestCase):
    def test_existing_pdf_and_search_rows_survive(self):
        db = sqlite3.connect(':memory:')
        for name in ('0000_nosy_franklin_richards.sql', '0001_equal_gauntlet.sql'):
            for statement in (ROOT / 'drizzle' / name).read_text().split('--> statement-breakpoint'):
                if statement.strip():
                    db.executescript(statement)
        db.execute("INSERT INTO books(id,user_id,title,file_name,file_size,page_count,indexed_pages,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                   ('existing-id','user','Existing','old.pdf',42,1,1,'ready','2026-01-01'))
        db.execute("INSERT INTO pages(book_id,page_number,body,normalized) VALUES(?,?,?,?)",('existing-id',1,'検索語','検索語'))
        for statement in (ROOT / 'drizzle' / '0002_misty_jasper_sitwell.sql').read_text().split('--> statement-breakpoint'):
            if statement.strip():
                db.executescript(statement)
        self.assertEqual(db.execute('SELECT id,shelf_id FROM books').fetchone(),('existing-id',None))
        self.assertEqual(db.execute('SELECT body FROM pages WHERE book_id=?',('existing-id',)).fetchone(),('検索語',))
        self.assertEqual(db.execute('SELECT count(*) FROM shelves').fetchone()[0],0)
        db.execute("INSERT INTO shelves(id,user_id,name,created_at,updated_at) VALUES('s','user','Shelf','now','now')")
        db.execute("UPDATE books SET shelf_id='s',book_order=10 WHERE id='existing-id'")
        db.execute("UPDATE books SET shelf_id=NULL WHERE shelf_id='s'")
        db.execute("DELETE FROM shelves WHERE id='s'")
        self.assertEqual(db.execute('SELECT shelf_id FROM books').fetchone()[0],None)
        self.assertEqual(db.execute('SELECT count(*) FROM pages').fetchone()[0],1)
        for migration in sorted((ROOT / 'drizzle').glob('*.sql')):
            if migration.name > '0002_misty_jasper_sitwell.sql':
                db.executescript(migration.read_text())
        self.assertEqual(db.execute('SELECT id,title FROM books').fetchone(), ('existing-id','Existing'))
        self.assertEqual(db.execute('SELECT body FROM pages').fetchone()[0], '検索語')
        self.assertEqual(db.execute('SELECT COUNT(*) FROM shares').fetchone()[0], 0)

if __name__ == '__main__': unittest.main()
