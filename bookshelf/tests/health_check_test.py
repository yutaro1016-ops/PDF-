"""No network requests: HTTP responses and failures are injected."""
import contextlib
import importlib.util
import io
import pathlib
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('health_probe', ROOT / 'scripts/health-check.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class Response:
    def __init__(self, body=b'{"ok":true,"version":"22"}', status=200,
                 url=health.URL, content_type='application/json; charset=utf-8'):
        self.body, self.status, self.url = body, status, url
        self.headers = {'Content-Type': content_type}
        self.read_limit = None
        self.closed = False

    def geturl(self):
        return self.url

    def read(self, limit):
        self.read_limit = limit
        return self.body[:limit]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True


class Opener:
    def __init__(self, response):
        self.response = response
        self.requests = []

    def open(self, request, *, timeout):
        self.requests.append((request, timeout))
        return self.response


class HealthProbeTests(unittest.TestCase):
    def test_current_health_payload_is_accepted_and_response_closed(self):
        response = Response()
        opener = Opener(response)
        self.assertTrue(health.check(opener=opener))
        request, timeout = opener.requests[0]
        self.assertEqual(request.full_url, health.URL)
        self.assertEqual(request.get_header('Accept'), 'application/json')
        self.assertFalse(request.has_header('Authorization'))
        self.assertEqual(timeout, 20)
        self.assertEqual(response.read_limit, 2049)
        self.assertTrue(response.closed)

    def test_only_fixed_endpoint_is_allowed_without_transport_call(self):
        opener = Opener(Response())
        for url in ('http://localhost/api/health', health.URL + '?token=private',
                    'https://example.org/api/health'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                health.check(url, opener=opener)
        self.assertEqual(opener.requests, [])

    def test_http_status_media_type_and_response_location_are_checked(self):
        for overrides in ({'status': 503}, {'status': 302},
                          {'url': health.URL + '/login'},
                          {'content_type': 'text/html'}, {'content_type': ''}):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                health.check(opener=Opener(Response(**overrides)))

    def test_truncated_valid_prefix_does_not_hide_oversized_response(self):
        # The old read(2048) accepted this valid prefix, ignoring the last byte.
        body = b'{"ok":true}' + b' ' * (2048 - len(b'{"ok":true}')) + b'X'
        with self.assertRaisesRegex(ValueError, 'exceeds limit'):
            health.check(opener=Opener(Response(body=body)))
        self.assertTrue(health.check(opener=Opener(Response(body=body[:-1]))))

    def test_untrusted_json_shapes_values_and_encoding_fail_closed(self):
        for body in (b'[]', b'null', b'true', b'{"ok":1}', b'{"ok":"true"}',
                     b'{"ok":false}', b'{}', b'{"ok":true,"ok":false}',
                     b'{"ok":false,"ok":true}', b'{"ok":true}extra', b'\xff'):
            with self.subTest(body=body), self.assertRaises(ValueError):
                health.check(opener=Opener(Response(body=body)))

    def test_redirect_handler_rejects_without_disclosing_target(self):
        target = 'https://example.org/?token=secret'
        with self.assertRaisesRegex(ValueError, '^Health endpoint redirected$'):
            health.RejectRedirects().redirect_request(None, None, 302, '', {}, target)

    def test_default_transport_installs_redirect_rejection(self):
        opener = Opener(Response())
        with patch.object(health.urllib.request, 'build_opener', return_value=opener) as build:
            self.assertTrue(health.check())
            self.assertIsInstance(build.call_args.args[0], health.RejectRedirects)

    def test_main_does_not_log_raw_transport_failure(self):
        err = io.StringIO()
        with patch.object(health, 'check', side_effect=OSError('secret-key /private')), contextlib.redirect_stderr(err):
            self.assertEqual(health.main(), 1)
        self.assertNotIn('secret-key', err.getvalue())
        self.assertNotIn('/private', err.getvalue())

    def test_main_reports_success(self):
        out = io.StringIO()
        with patch.object(health, 'check', return_value=True), contextlib.redirect_stdout(out):
            self.assertEqual(health.main(), 0)
        self.assertIn('storage health: OK', out.getvalue())


if __name__ == '__main__':
    unittest.main()
