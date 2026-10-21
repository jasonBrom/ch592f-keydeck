"""Loopback console server with optional Windows paired-BLE transport."""
import argparse
import json
import hashlib
import hmac
import secrets
import subprocess
import sys
import webbrowser
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
ONLINE_ORIGIN = 'https://jasonbrom.github.io'
API_ACTIONS = ('status', 'connect', 'frame', 'disconnect')


class ConsoleHandler(SimpleHTTPRequestHandler):
    def _online_api(self):
        return (self.headers.get('Origin') == ONLINE_ORIGIN and
                urlsplit(self.path).path in
                tuple('/api/windows-ble/' + action for action in API_ACTIONS))

    def _token(self):
        # Keep the local console token separate from the official site's token.
        if self._online_api():
            return hmac.new(self.server.api_token.encode(), ONLINE_ORIGIN.encode(),
                            hashlib.sha256).hexdigest()
        return self.server.api_token

    def _trusted(self, mutation=False):
        port = self.server.server_port
        host = self.headers.get('Host', '')
        if host not in (f'localhost:{port}', f'127.0.0.1:{port}'):
            return False
        origin = self.headers.get('Origin')
        online = self._online_api()
        if origin and origin != f'http://{host}' and not online:
            return False
        if self.headers.get('Sec-Fetch-Site') == 'cross-site' and not online:
            return False
        if mutation and ((origin != f'http://{host}' and not online) or
                         not hmac.compare_digest(self.headers.get('X-C5-Token', ''), self._token()) or
                         self.headers.get('Content-Type', '').split(';')[0] != 'application/json'):
            return False
        return True

    def _json(self, status, data):
        content = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        if not self._trusted():
            self._json(403, {'error': '仅允许本机控制台访问。'})
            return
        if urlsplit(self.path).path == '/api/windows-ble/status':
            bridge = self.server.bridge
            self._json(200, {'available': bridge.available, 'reason': bridge.reason,
                             'token': self._token() if bridge.available else None,
                             'bridgeVersion': 2})
            return
        if urlsplit(self.path).path.startswith('/api/'):
            self._json(404, {'error': '未知操作。'})
            return
        super().do_GET()

    def do_OPTIONS(self):
        requested = {header.strip().lower() for header in
                     self.headers.get('Access-Control-Request-Headers', '').split(',') if header.strip()}
        if (not self._trusted() or not self._online_api() or
                self.headers.get('Access-Control-Request-Method') not in ('GET', 'POST') or
                not requested <= {'content-type', 'x-c5-token'}):
            self._json(403, {'error': '不允许此来源或请求。'})
            return
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-C5-Token')
        if self.headers.get('Access-Control-Request-Private-Network') == 'true':
            self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Access-Control-Max-Age', '600')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_HEAD(self):
        if not self._trusted() or self.headers.get('Origin') == ONLINE_ORIGIN:
            self.send_error(403)
            return
        super().do_HEAD()

    def do_POST(self):
        if not self._trusted(mutation=True):
            self._json(403, {'error': '请求来源或控制台授权无效。'})
            return
        path = urlsplit(self.path).path
        if not path.startswith('/api/windows-ble/'):
            self._json(404, {'error': '未知操作。'})
            return
        action = path.removeprefix('/api/windows-ble/')
        if action not in ('connect', 'frame', 'disconnect'):
            self._json(404, {'error': '未知操作。'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 2048:
                raise ValueError('Invalid body length')
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError('Expected object')
        except (ValueError, UnicodeError):
            self._json(400, {'error': '无效的请求内容。'})
            return
        try:
            self._json(200, self.server.bridge.call(action, body))
        except Exception as error:
            self._json(getattr(error, 'status', 502), {'error': str(error)})

    def end_headers(self):
        if self._online_api() and self._trusted():
            self.send_header('Access-Control-Allow-Origin', ONLINE_ORIGIN)
            self.send_header('Vary', 'Origin')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--port', type=int, default=8792)
    parser.add_argument('--install-bluetooth', action='store_true')
    args = parser.parse_args()
    if args.install_bluetooth and sys.platform == 'win32':
        sys.path.insert(0, str(ROOT / '.runtime'))
        try:
            import bleak
        except ImportError:
            print('Installing local Windows Bluetooth components from PyPI...', flush=True)
            subprocess.run([sys.executable, '-m', 'pip', 'install', '--target', str(ROOT / '.runtime'),
                            '-r', str(ROOT / 'requirements-windows.txt')], check=False)
    from windows_ble import WindowsBLE
    bridge = WindowsBLE()
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port),
                                    partial(ConsoleHandler, directory=str(ROOT / 'public')))
    except OSError:
        bridge.close()
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{args.port}/api/windows-ble/status', timeout=2) as response:
                existing = json.load(response)
            if existing.get('bridgeVersion', 0) >= 2:
                print(f'KeyDeck service is already running: http://localhost:{args.port}/', flush=True)
                if not args.no_browser:
                    webbrowser.open(f'http://localhost:{args.port}/')
                return
        except Exception:
            pass
        print(f'Port {args.port} is occupied by an old console or another app. Close it and restart StartConsole.cmd.', flush=True)
        return
    server.bridge = bridge
    server.api_token = secrets.token_urlsafe(32)
    print(f'C5 Console: http://localhost:{args.port}/ ; Ctrl+C to stop', flush=True)
    print('Windows paired Bluetooth: ' + ('ready' if bridge.available else bridge.reason), flush=True)
    print('Online console: https://jasonbrom.github.io/ch592f-keydeck/ (click Windows paired Bluetooth)', flush=True)
    if not args.no_browser:
        webbrowser.open(f'http://localhost:{args.port}/')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        bridge.close()


if __name__ == '__main__':
    main()
