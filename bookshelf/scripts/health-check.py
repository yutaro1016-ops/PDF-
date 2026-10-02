"""Public operational probe. No credentials/PDFs/identifiers are collected or printed."""
import json,sys,urllib.request
URL='https://pdf-page-finder.yutaro1016.chatgpt.site/api/health'
def check(url=URL):
    request=urllib.request.Request(url,headers={'Accept':'application/json','User-Agent':'PDF-Page-Finder-Health/1'})
    with urllib.request.urlopen(request,timeout=20) as response:
        if response.status!=200:raise ValueError('Health status unavailable')
        body=json.loads(response.read(2048))
        if body.get('ok') is not True:raise ValueError('Storage health unavailable')
    return True
if __name__=='__main__':
    try:check();print('PDF Page Finder storage health: OK')
    except Exception:print('PDF Page Finder storage health: FAILED; review worker logs/request IDs',file=sys.stderr);raise SystemExit(1)
