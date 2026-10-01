import base64, importlib.util, json, pathlib, sqlite3, subprocess, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bundle', ROOT / 'scripts/migration-bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)
PDF = '12345678-1234-1234-1234-123456789abc'
SHELF = '22345678-1234-1234-1234-123456789abc'

class MigrationBundleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.temp.name)
        self.source = self.base / 'export'
        self.source.mkdir()
        self.manifest = self.base / 'manifest.json'
        self.pdf = subprocess.check_output(['node', '--input-type=module', '-e', "import {makePagedPDF} from './tests/pdf_fixture.mjs';process.stdout.write(makePagedPDF(1));"], cwd=ROOT)
        (self.source / (PDF + '.pdf')).write_bytes(self.pdf)
        (self.source / (PDF + '.pages.ndjson')).write_text(json.dumps({'number': 1, 'body': '検証語Ａ', 'normalized': '検証語a'}) + '\n')
        self.meta = {'format': 'pdf-page-finder-backup', 'version': 1,
            'shelves': [{'id': SHELF, 'name': '医学資料', 'shelf_order': 2, 'color': '#123456', 'board_color': '#234567', 'text_color': '#ffffff', 'design': 'wood', 'created_at': 'now', 'updated_at': 'now'}],
            'books': [{'id': PDF, 'title': '長いタイトル', 'file_name': 'test.pdf', 'file_size': len(self.pdf), 'page_count': 1, 'indexed_pages': 1, 'status': 'ready', 'created_at': 'now', 'shelf_id': SHELF, 'tags': '["医学"]', 'book_order': 3, 'book_color': '#123456', 'cover_image': 'data:image/png;base64,' + base64.b64encode(b'fixture-image-bytes').decode()}]}
        self.save_meta()
        (self.source / 'COMPLETE.json').write_text(json.dumps({'complete': True, 'pdfCount': 1}))

    def tearDown(self):
        self.temp.cleanup()

    def save_meta(self):
        (self.source / 'metadata.json').write_text(json.dumps(self.meta, ensure_ascii=False))

    def test_restore_ids_index_settings_cover_and_no_overwrite(self):
        sealed = bundle.seal(self.source, self.manifest)
        target = self.base / 'stage'
        report = bundle.restore(self.source, self.manifest, target)
        self.assertFalse(report['productionReady'])
        self.assertFalse(report['authenticationMappingApplied'])
        self.assertIn('shares', report['omitted'])
        self.assertEqual((target / 'images' / (PDF + '.cover')).read_bytes(), b'fixture-image-bytes')
        db = sqlite3.connect(target / 'restored.sqlite')
        self.assertEqual(db.execute('SELECT id,user_id,book_order,tags FROM books').fetchone(), (PDF, 'recovery-staging', 3, '["医学"]'))
        self.assertEqual(db.execute('SELECT normalized FROM pages').fetchone()[0], '検証語a')
        db.close()
        with self.assertRaises(ValueError):
            bundle.restore(self.source, self.manifest, target)
        self.assertTrue((target / 'restored.sqlite').exists())
        with self.assertRaises(FileExistsError):
            bundle.seal(self.source, self.manifest)
        self.assertEqual(bundle.verify(self.source, self.manifest), sealed)

    def test_same_size_pdf_corruption_is_rejected(self):
        bundle.seal(self.source, self.manifest)
        (self.source / (PDF + '.pdf')).write_bytes(b'X' * len(self.pdf))
        with self.assertRaises(ValueError):
            bundle.restore(self.source, self.manifest, self.base / 'stage')
        self.assertFalse((self.base / 'stage').exists())

    def test_index_and_cover_content_changes_are_rejected(self):
        bundle.seal(self.source, self.manifest)
        (self.source / (PDF + '.pages.ndjson')).write_text(json.dumps({'number': 1, 'body': '別の内容', 'normalized': '別の内容'}) + '\n')
        with self.assertRaises(ValueError):
            bundle.verify(self.source, self.manifest)
        (self.source / (PDF + '.pages.ndjson')).write_text(json.dumps({'number': 1, 'body': '検証語Ａ', 'normalized': '検証語a'}) + '\n')
        self.meta['books'][0]['cover_image'] = 'data:image/png;base64,' + base64.b64encode(b'other-image-bytes!!').decode()
        self.save_meta()
        with self.assertRaises(ValueError):
            bundle.verify(self.source, self.manifest)

    def test_incomplete_duplicate_foreign_shelf_and_unsafe_path(self):
        for mutation in ('pending', 'duplicate', 'foreign', 'path'):
            original = json.loads(json.dumps(self.meta))
            if mutation == 'pending': self.meta['books'][0]['status'] = 'uploading'
            if mutation == 'duplicate': self.meta['books'].append(dict(self.meta['books'][0]))
            if mutation == 'foreign': self.meta['books'][0]['shelf_id'] = 'unknown'
            if mutation == 'path': self.meta['books'][0]['id'] = '../private'
            self.save_meta()
            with self.assertRaises(ValueError): bundle.inspect(self.source)
            self.meta = original
        self.save_meta()
        (self.source / 'COMPLETE.json').unlink()
        with self.assertRaises(ValueError): bundle.inspect(self.source)

    def test_symlinks_and_invalid_index_are_rejected(self):
        pdf = self.source / (PDF + '.pdf')
        outside = self.base / 'outside.pdf'
        pdf.rename(outside)
        pdf.symlink_to(outside)
        with self.assertRaises(ValueError): bundle.inspect(self.source)
        pdf.unlink(); outside.rename(pdf)
        (self.source / (PDF + '.pages.ndjson')).write_text(json.dumps({'number': True, 'body': 'x', 'normalized': 'x'}) + '\n')
        with self.assertRaises(ValueError): bundle.inspect(self.source)

    def test_unknown_metadata_never_silently_disappears(self):
        self.meta['books'][0]['future_setting'] = 'preserve-me'
        self.save_meta()
        bundle.seal(self.source, self.manifest)
        with self.assertRaises(ValueError): bundle.restore(self.source, self.manifest, self.base / 'stage')
        self.assertFalse((self.base / 'stage').exists())
        self.assertTrue(self.source.exists())

    def test_first_page_covers_do_not_claim_cached_image_restore(self):
        self.meta['books'][0]['cover_image'] = 'first-page'
        self.save_meta()
        self.assertEqual(bundle.inspect(self.source)['customCovers'], {})

if __name__ == '__main__':
    unittest.main()
