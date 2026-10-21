"""Loopback console server with optional Windows paired-BLE transport."""
import argparse
import json
import secrets
import subprocess
import sys
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent


class ConsoleHandler(SimpleHTTPRequestHandler):
    def _trusted(self, mutation=False):
        port = self.server.server_port
        host = self.headers.get('Host', '')
        if host not in (f'localhost:{port}', f'127.0.0.1:{port}'):
            return False
        origin = self.headers.get('Origin')
        if origin and origin != f'http://{host}':
            return False
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return False
        if mutation and (origin != f'http://{host}' or
                         self.headers.get('X-C5-Token') != self.server.api_token or
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
                             'token': self.server.api_token if bridge.available else None})
            return
        super().do_GET()

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
    server = ThreadingHTTPServer(('127.0.0.1', args.port),
                                partial(ConsoleHandler, directory=str(ROOT / 'public')))
    server.bridge = bridge
    server.api_token = secrets.token_urlsafe(32)
    print(f'C5 Console: http://localhost:{args.port}/ ; Ctrl+C to stop', flush=True)
    print('Windows paired Bluetooth: ' + ('ready' if bridge.available else bridge.reason), flush=True)
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
