import importlib.util,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('auth',pathlib.Path(__file__).resolve().parents[1]/'scripts/manifest-auth.py');auth=importlib.util.module_from_spec(spec);spec.loader.exec_module(auth)
class AuthTest(unittest.TestCase):
    def test_independent_key_detects_manifest_and_tag_tampering(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);m=root/'manifest';k=root/'key';s=root/'tag'
            m.write_text('{"fixture":true}');k.write_bytes(b'SYNTHETIC-TEST-ONLY-NOT-A-REAL-KEY!!');k.chmod(0o600)
            auth.sign(m,k,s);self.assertTrue(auth.verify(m,k,s))
            with self.assertRaises(FileExistsError):auth.sign(m,k,s)
            m.write_text('{"fixture":false}')
            with self.assertRaises(ValueError):auth.verify(m,k,s)
            m.write_text('{"fixture":true}');k.write_bytes(b'DIFFERENT-SYNTHETIC-TEST-KEY-ONLY!!')
            with self.assertRaises(ValueError):auth.verify(m,k,s)
    def test_insecure_key_and_unknown_format_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);m=root/'manifest';k=root/'key';s=root/'tag'
            m.write_text('{}');k.write_bytes(b'X'*32);k.chmod(0o644)
            with self.assertRaises(ValueError):auth.sign(m,k,s)
            k.chmod(0o600);auth.sign(m,k,s);s.write_text('{"version":999}')
            with self.assertRaises(ValueError):auth.verify(m,k,s)
if __name__=='__main__':unittest.main()
