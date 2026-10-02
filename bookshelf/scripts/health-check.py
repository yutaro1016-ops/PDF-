"""Read-only fixed-endpoint operational probe.

No credentials, PDFs, identifiers, response contents, or redirect targets are logged.
Success proves this endpoint's DB/R2 probe returned ok, not full recovery/readiness.
"""
import json
import sys
import urllib.error
import urllib.request

URL = 'https://pdf-page-finder.yutaro1016.chatgpt.site/api/health'
MAX_BODY_BYTES = 2048
TIMEOUT_SECONDS = 20


class RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        # A login/intermediary redirect must not be reported as a healthy API.
        raise ValueError('Health endpoint redirected')


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate health response field')
        result[key] = value
    return result


def check(url=URL, *, opener=None):
    if url != URL:
        raise ValueError('Unsupported health endpoint')
    if opener is None:
        opener = urllib.request.build_opener(RejectRedirects())
    request = urllib.request.Request(
        url, headers={'Accept': 'application/json',
                      'User-Agent': 'PDF-Page-Finder-Health/2'})
    with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
        if response.status != 200 or response.geturl() != URL:
            raise ValueError('Health status unavailable')
        media_type = response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
        if media_type != 'application/json':
            raise ValueError('Health response is not JSON')
        # One byte beyond the limit distinguishes bounded input from truncation.
        raw = response.read(MAX_BODY_BYTES + 1)
        if len(raw) > MAX_BODY_BYTES:
            raise ValueError('Health response exceeds limit')
        body = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_object)
        if not isinstance(body, dict) or body.get('ok') is not True:
            raise ValueError('Storage health unavailable')
    return True


def main():
    try:
        check()
    except Exception:
        # The exception may contain URLs, response bodies, or transport secrets.
        print('PDF Page Finder storage health: FAILED; review worker logs/request IDs',
              file=sys.stderr)
        return 1
    print('PDF Page Finder storage health: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
