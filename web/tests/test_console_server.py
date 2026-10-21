import importlib.util
import asyncio
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('console_server', ROOT / 'start-console.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
from windows_ble import valid_frame, WindowsBLE, BridgeError


class FakeBridge:
    available, reason = True, ''
    def __init__(self):
        self.calls = []
    def call(self, action, body):
        self.calls.append((action, body))
        return {'session': 'test-session'}


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(module.ConsoleHandler, directory=str(ROOT / 'public')))
        cls.server.bridge = FakeBridge()
        cls.server.api_token = 'test-token'
        cls.origin = f'http://127.0.0.1:{cls.server.server_port}'
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, path, body=None, headers=None, method=None):
        req = urllib.request.Request(self.origin+path, data=json.dumps(body).encode() if body is not None else None,
                                     headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(req) as response:
                return response.status, response.read(), response.headers
        except urllib.error.HTTPError as error:
            try:
                return error.code, error.read(), error.headers
            finally:
                error.close()

    def test_static_page_and_capability(self):
        status, body, _ = self.request('/')
        self.assertEqual(status, 200)
        self.assertIn(b'connectDevice', body)
        status, body, headers = self.request('/api/windows-ble/status')
        self.assertEqual(json.loads(body), {'available': True, 'reason': '', 'token': 'test-token', 'bridgeVersion': 2})
        self.assertIn('no-store', ','.join(headers.get_all('Cache-Control')))

    def test_cross_origin_and_rebinding_cannot_access_bridge(self):
        before = len(self.server.bridge.calls)
        for headers in ({'Host': 'evil.example'}, {'Origin': 'https://evil.example'}, {'Sec-Fetch-Site': 'cross-site'}):
            self.assertEqual(self.request('/api/windows-ble/status', headers=headers)[0], 403)
        self.assertEqual(self.request('/api/windows-ble/connect', {}, {'Content-Type': 'application/json'})[0], 403)
        self.assertEqual(self.request('/api/windows-ble/connect', {}, {'Origin': self.origin, 'Content-Type': 'application/json', 'X-C5-Token': 'wrong'})[0], 403)
        self.assertEqual(len(self.server.bridge.calls), before)

    def test_official_online_console_has_scoped_token_and_cors(self):
        origin = module.ONLINE_ORIGIN
        headers = {'Origin': origin, 'Sec-Fetch-Site': 'cross-site'}
        status, body, response = self.request('/api/windows-ble/status', headers=headers)
        self.assertEqual(status, 200)
        token = json.loads(body)['token']
        self.assertNotEqual(token, self.server.api_token)
        self.assertEqual(response['Access-Control-Allow-Origin'], origin)
        self.assertEqual(response['Vary'], 'Origin')
        headers.update({'Content-Type': 'application/json', 'X-C5-Token': token})
        self.assertEqual(self.request('/api/windows-ble/connect', {}, headers)[0], 200)
        headers['X-C5-Token'] = self.server.api_token
        self.assertEqual(self.request('/api/windows-ble/connect', {}, headers)[0], 403)
        headers['Origin'] = self.origin
        headers['Sec-Fetch-Site'] = 'same-origin'
        headers['X-C5-Token'] = token
        self.assertEqual(self.request('/api/windows-ble/connect', {}, headers)[0], 403)

    def test_preflight_only_allows_official_origin_and_bounded_api(self):
        headers = {'Origin': module.ONLINE_ORIGIN,
                   'Access-Control-Request-Method': 'POST',
                   'Access-Control-Request-Headers': 'content-type,x-c5-token',
                   'Access-Control-Request-Private-Network': 'true'}
        status, _, response = self.request('/api/windows-ble/frame', headers=headers, method='OPTIONS')
        self.assertEqual(status, 204)
        self.assertEqual(response['Access-Control-Allow-Origin'], module.ONLINE_ORIGIN)
        self.assertEqual(response['Access-Control-Allow-Private-Network'], 'true')
        for path in ('/', '/api/windows-ble/flash', '/windows_ble.py'):
            self.assertEqual(self.request(path, headers=headers, method='OPTIONS')[0], 403)
            self.assertEqual(self.request(path, headers={'Origin': module.ONLINE_ORIGIN})[0], 403)
        for change in ({'Origin': 'https://evil.example'}, {'Host': 'evil.example'},
                       {'Access-Control-Request-Method': 'DELETE'},
                       {'Access-Control-Request-Headers': 'authorization'}):
            rejected = self.request('/api/windows-ble/frame', headers={**headers, **change}, method='OPTIONS')
            self.assertEqual(rejected[0], 403)
            if 'Origin' in change or 'Host' in change:
                self.assertIsNone(rejected[2].get('Access-Control-Allow-Origin'))

    def test_same_origin_token_can_connect_but_unknown_paths_are_rejected(self):
        headers = {'Origin': self.origin, 'Content-Type': 'application/json', 'X-C5-Token': 'test-token'}
        self.assertEqual(self.request('/api/windows-ble/connect', {}, headers)[0], 200)
        self.assertEqual(self.request('/connect', {}, headers)[0], 404)
        self.assertEqual(self.request('/api/windows-ble/flash', {}, headers)[0], 404)
        self.assertEqual(self.request('/api/windows-ble/frame', [], headers)[0], 400)

    def test_config_frames_are_bounded_and_do_not_accept_arbitrary_bytes(self):
        info = [197, 1, 1, 4, 0, 0, 0, 0]+[0]*12
        self.assertTrue(valid_frame(info))
        for opcode in range(1, 19):
            request = info.copy()
            request[2] = opcode
            self.assertTrue(valid_frame(request), opcode)
        for bad in (info[:-1], info+[0], [-1]+info[1:], [True]+info[1:], [0]+info[1:], info[:2]+[19]+info[3:], info[:2]+[99]+info[3:], info[:2]+[129]+info[3:], info[:4]+[13]+info[5:], info[:5]+[1]+info[6:]):
            self.assertFalse(valid_frame(bad))


class BridgeDispatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_dispatch_forwards_tuning_frames_and_rejects_unknown_commands(self):
        # Use the real bridge dispatch and validator without connecting hardware.
        bridge = WindowsBLE.__new__(WindowsBLE)
        bridge.lock = asyncio.Lock()
        bridge.session = 'test-session'
        bridge.client = SimpleNamespace(is_connected=True)
        forwarded = []

        async def exchange(packet):
            forwarded.append(packet)
            response = bytearray(packet)
            response[2] |= 128
            return bytes(response)

        bridge._exchange = exchange
        tuning = [0xc1, 0x78, 0x6b, 0x11, 90, 66, 3, 24]
        for opcode, offset, payload in [(17, 0, []), (17, 1, []), (17, 2, []),
                                         (18, 0, [0] + tuning), (18, 0, [1]),
                                         (18, 0, [2]), (18, 0, [3])]:
            packet = [197, 1, opcode, 7, len(payload), 0, offset, 0] + payload + [0] * (12-len(payload))
            reply = await bridge._dispatch('frame', {'session': 'test-session', 'frame': packet})
            self.assertEqual(forwarded[-1], bytes(packet))
            self.assertEqual(reply['frame'][2], opcode | 128)
        self.assertEqual(len(forwarded), 7)
        bad = [197, 1, 19, 7, 0, 0, 0, 0] + [0] * 12
        with self.assertRaisesRegex(BridgeError, '无效的 C5 配置请求'):
            await bridge._dispatch('frame', {'session': 'test-session', 'frame': bad})
        self.assertEqual(len(forwarded), 7)

    async def test_current_bridge_command_whitelist(self):
        for opcode in range(1, 19):
            self.assertTrue(valid_frame([197, 1, opcode, 0, 0, 0, 0, 0] + [0]*12))
        self.assertFalse(valid_frame([197, 1, 19, 0, 0, 0, 0, 0] + [0]*12))


if __name__ == '__main__':
    unittest.main()
