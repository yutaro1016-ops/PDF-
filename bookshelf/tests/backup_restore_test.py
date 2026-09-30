import importlib.util,json,pathlib,sqlite3,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('restore',ROOT/'scripts/restore-backup.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class BackupTest(unittest.TestCase):
    def test_non_destructive_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            base=pathlib.Path(directory);source=base/'backup';source.mkdir();pdf_id='12345678-1234-1234-1234-123456789abc';pdf=b'%PDF-test-fixture'
            (source/(pdf_id+'.pdf')).write_bytes(pdf);(source/(pdf_id+'.pages.ndjson')).write_text(json.dumps({'number':1,'body':'検索語','normalized':'検索語'})+'\n')
            book={'id':pdf_id,'title':'Original','file_name':'original.pdf','file_size':len(pdf),'page_count':1,'indexed_pages':1,'status':'ready','created_at':'now','shelf_id':None,'tags':'[]'}
            (source/'metadata.json').write_text(json.dumps({'format':'pdf-page-finder-backup','version':1,'shelves':[],'books':[book]}));(source/'COMPLETE.json').write_text(json.dumps({'complete':True,'pdfCount':1}))
            result=module.restore(source,base/'staging');self.assertEqual(result,{'pdfs':1,'pages':1});self.assertEqual((base/'staging'/'pdfs'/(pdf_id+'.pdf')).read_bytes(),pdf)
            db=sqlite3.connect(base/'staging'/'restored.sqlite');self.assertEqual(db.execute('SELECT id,title FROM books').fetchone(),(pdf_id,'Original'));self.assertEqual(db.execute('SELECT body FROM pages').fetchone()[0],'検索語');db.close()
            with self.assertRaises(ValueError):module.restore(source,base/'staging')
            (source/(pdf_id+'.pdf')).write_bytes(b'bad')
            with self.assertRaises(ValueError):module.restore(source,base/'bad-staging')
            self.assertFalse((base/'bad-staging').exists())
if __name__=='__main__':unittest.main()
