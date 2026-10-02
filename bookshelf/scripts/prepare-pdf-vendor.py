"""Reproduce existing PDF.js assets from a pinned official npm tarball, checking every file.
No runtime network requests to npm: generated assets are served locally by the app.
"""
import hashlib,io,json,pathlib,tarfile,urllib.request
root=pathlib.Path(__file__).resolve().parents[1]
manifest=json.loads((root/'scripts/pdf-vendor-manifest.json').read_text())
url='https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-'+manifest['version']+'.tgz'
with urllib.request.urlopen(url,timeout=90) as response:data=response.read(20000000)
if hashlib.sha256(data).hexdigest()!=manifest['tarballSha256']:raise SystemExit('Vendor tarball hash mismatch; no assets updated')
with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as tar:
    verified={}
    for path,entry in manifest['files'].items():
        content=tar.extractfile('package/'+entry['source']).read()
        if hashlib.sha256(content).hexdigest()!=entry['sha256']:raise SystemExit('Vendor file hash mismatch; no assets updated')
        verified[path]=content
    for path,content in verified.items():
        target=root/'public/vendor'/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(content)
print('Verified PDF.js assets:',len(verified))
