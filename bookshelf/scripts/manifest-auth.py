"""Detached HMAC-SHA256 for an offline manifest (integrity, NOT encryption).
Usage: manifest-auth.py sign|verify MANIFEST PRIVATE_KEY DETACHED_TAG
Key: >=32 random bytes, operator-created, owner-only permissions on POSIX.
Never put a key/tag/private manifest in GitHub. Independent key custody required.
"""
import hashlib,hmac,json,os,pathlib,sys

def tag(manifest,key):
    key=pathlib.Path(key);manifest=pathlib.Path(manifest)
    if key.is_symlink() or not key.is_file() or manifest.is_symlink() or not manifest.is_file():raise ValueError('Regular files required')
    if os.name=='posix' and key.stat().st_mode & 0o077:raise ValueError('Private key permissions required')
    if not 32<=key.stat().st_size<=4096:raise ValueError('Key length must be 32..4096 bytes')
    mac=hmac.new(key.read_bytes(),digestmod=hashlib.sha256)
    mac.update(b'PDF-PAGE-FINDER-MANIFEST-V1\x00')
    with manifest.open('rb') as src:
        while chunk:=src.read(8*1024*1024):mac.update(chunk)
    return {'format':'pdf-page-finder-manifest-auth','version':1,'algorithm':'HMAC-SHA256','mac':mac.hexdigest()}

def sign(manifest,key,destination):
    value=tag(manifest,key)
    with pathlib.Path(destination).open('x') as out:json.dump(value,out)

def verify(manifest,key,signature):
    path=pathlib.Path(signature)
    if path.is_symlink() or not path.is_file() or path.stat().st_size>4096:raise ValueError('Invalid detached tag')
    expected=json.loads(path.read_text());actual=tag(manifest,key)
    if set(expected)!=set(actual) or any(expected[x]!=actual[x] for x in ('format','version','algorithm')) or not isinstance(expected['mac'],str) or not hmac.compare_digest(expected['mac'],actual['mac']):raise ValueError('Manifest authentication failed')
    return True

if __name__=='__main__':
    try:
        if len(sys.argv)!=5 or sys.argv[1] not in ('sign','verify'):raise ValueError(__doc__)
        globals()[sys.argv[1]](*sys.argv[2:]);print('Manifest authentication: OK (not encryption)')
    except (ValueError,OSError,TypeError,KeyError) as error:raise SystemExit(str(error))
