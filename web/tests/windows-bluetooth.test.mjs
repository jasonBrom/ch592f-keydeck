import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeviceLink } from '../public/config/transport.js';
import { autoConnect } from '../public/config/connection.js';
import { windowsBluetoothStatus, windowsBridgeBase } from '../public/config/windows-bluetooth.js';
import { defaults, encode, frame, parseFrame } from '../public/config/schema.js';

function fixture(
  t,
  {
    available = true,
    connectError,
    expired = false,
    identity = true,
    networkLoss = false,
    oldBridge = false,
    hosted = false,
    bridgeVersion = 2,
  } = {},
) {
  const originals = ['location', 'fetch', 'isSecureContext'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  let config = encode(defaults()),
    draft,
    saved,
    active = false;
  const calls = [],
    urls = [];
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: hosted
      ? {
          hostname: 'jasonbrom.github.io',
          origin: 'https://jasonbrom.github.io',
          pathname: '/ch592f-keydeck/',
        }
      : { hostname: 'localhost' },
  });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (url, options = {}) => {
      urls.push(url);
      if (hosted) {
        assert(url.startsWith('http://127.0.0.1:8792/api/windows-ble/'));
        assert.equal(options.mode, 'cors');
        assert.equal(options.targetAddressSpace, 'loopback');
        assert.equal(options.credentials, 'omit');
        assert.equal(options.redirect, 'error');
      }
      const action = url.split('/').at(-1);
      if (action === 'status')
        return new Response(
          JSON.stringify({ available, bridgeVersion, token: available ? 'test-token' : null }),
        );
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.equal(options.headers['X-C5-Token'], 'test-token');
      const body = JSON.parse(options.body);
      calls.push(action);
      if (action === 'connect') {
        if (connectError)
          return new Response(JSON.stringify({ error: connectError }), { status: 409 });
        active = true;
        return new Response(JSON.stringify({ session: 'test-session', name: 'C5 Rev.E' }));
      }
      assert.equal(body.session, 'test-session');
      if (action === 'disconnect') {
        active = false;
        return new Response('{"ok":true}');
      }
      if (expired) return new Response(JSON.stringify({ error: '会话已结束' }), { status: 410 });
      assert(active);
      const r = parseFrame(Uint8Array.from(body.frame));
      calls.push(r.op);
      if (oldBridge && r.op >= 15)
        return new Response(JSON.stringify({ error: '无效的 C5 配置请求。' }), { status: 400 });
      if (networkLoss && r.op === 2) throw new TypeError('Failed to fetch');
      let payload = new Uint8Array();
      if (r.op === 1)
        payload = Uint8Array.of(identity ? 67 : 0, 53, 82, 69, 1, 2, 0, 4, 255, 255, 0, 0);
      if (r.op === 2) payload = config.slice(r.offset, r.offset + r.payload[0]);
      if (r.op === 3) draft = new Uint8Array(1024);
      if (r.op === 4) draft.set(r.payload, r.offset);
      if (r.op === 5) config = draft.slice();
      if (r.op === 6) saved = config.slice();
      return new Response(
        JSON.stringify({ frame: Array.from(frame(r.op | 128, r.seq, payload, r.offset)) }),
      );
    },
  });
  return {
    link: new DeviceLink(),
    calls,
    urls,
    get config() {
      return config;
    },
    get saved() {
      return saved;
    },
    get active() {
      return active;
    },
  };
}

test('Windows paired transport reads, applies, saves and verifies through the existing C5 protocol', async (t) => {
  const f = fixture(t),
    before = f.config.slice();
  await f.link.connect('windows-ble');
  assert(f.link.connected);
  assert.equal(f.link.kind, 'windows-ble');
  assert.deepEqual(await f.link.read(), before);
  assert.deepEqual(f.config, before);
  const edited = defaults();
  edited.brightness = 63;
  edited.profiles[0][0] = { type: 2, modifiers: 0, value: 233 };
  const bytes = encode(edited);
  await f.link.apply(bytes, true);
  assert.deepEqual(f.config, bytes);
  assert.deepEqual(f.saved, bytes);
  await f.link.disconnect();
  assert(!f.link.connected);
  assert(!f.active);
  assert(f.calls.includes(6));
});
test('unavailable local backend leaves device untouched and gives launcher instructions', async (t) => {
  const f = fixture(t, { available: false });
  await assert.rejects(f.link.connect('windows-ble'), /StartConsole.cmd/);
  assert(!f.link.connected);
  assert.deepEqual(f.calls, []);
});
test('busy backend does not take ownership or send configuration frames', async (t) => {
  const f = fixture(t, { connectError: '另一网页正在管理 C5' });
  await assert.rejects(f.link.connect('windows-ble'), /另一网页/);
  assert(!f.link.connected);
  assert.deepEqual(f.calls, ['connect']);
});
test('wrong device identity releases the native session before configuration access', async (t) => {
  const f = fixture(t, { identity: false });
  await assert.rejects(f.link.connect('windows-ble'), /不是兼容/);
  assert(!f.link.connected);
  assert(!f.active);
  assert.deepEqual(f.calls, ['connect', 'frame', 1, 'disconnect']);
});
test('expired native session disconnects browser state and rejects pending work', async (t) => {
  const f = fixture(t, { expired: true });
  await assert.rejects(f.link.connect('windows-ble'), /断开|结束/);
  assert(!f.link.connected);
  assert(!f.calls.some((x) => typeof x === 'number'));
});
test('official hosted page does not probe loopback during automatic discovery', async (t) => {
  const f = fixture(t, { hosted: true });
  assert.deepEqual(await windowsBluetoothStatus(), { available: false });
  assert.deepEqual(f.urls, []);
});

test('explicit online Windows connection reads the paired device over the loopback bridge', async (t) => {
  const f = fixture(t, { hosted: true }),
    before = f.config.slice();
  await f.link.connect('windows-ble');
  assert.equal(f.link.kind, 'windows-ble');
  assert.deepEqual(await f.link.read(), before);
  assert(!f.calls.some((op) => [3, 4, 5, 6].includes(op)), 'connection must not write settings');
  await f.link.disconnect();
  assert(!f.active);
});

test('automatic online connect discovers and reads the paired Windows device without configuration writes', async (t) => {
  const f = fixture(t, { hosted: true }),
    before = f.config.slice();
  await autoConnect(f.link, { interactive: true, discover: async () => [] });
  assert.equal(f.link.kind, 'windows-ble');
  assert.deepEqual(await f.link.read(), before);
  assert(!f.calls.some((op) => [3, 4, 5, 6].includes(op)));
  await f.link.disconnect();
});

test('other sites and unsupported older bridges cannot acquire the native session', async (t) => {
  const f = fixture(t, { hosted: true, bridgeVersion: 1 });
  await assert.rejects(f.link.connect('windows-ble'), /更新.*本地桥接/);
  assert.deepEqual(f.calls, []);
  for (const page of [
    { hostname: 'evil.example', origin: 'https://evil.example', pathname: '/ch592f-keydeck/' },
    {
      hostname: 'jasonbrom.github.io',
      origin: 'http://jasonbrom.github.io',
      pathname: '/ch592f-keydeck/',
    },
    { hostname: 'jasonbrom.github.io', origin: 'https://jasonbrom.github.io', pathname: '/other/' },
  ])
    assert.equal(windowsBridgeBase({ interactive: true, page }), null);
});
test('stopped local server clears the connected badge state and rejects configuration access', async (t) => {
  const f = fixture(t, { networkLoss: true });
  await f.link.connect('windows-ble');
  await assert.rejects(f.link.read(), /断开|不可用/);
  assert(!f.link.connected);
  assert(!f.calls.some((op) => [3, 4, 5, 6].includes(op)));
});
test('old running bridge explains that calibration needs a service restart, without losing the session', async (t) => {
  const f = fixture(t, { oldBridge: true });
  await f.link.connect('windows-ble');
  for (const [op, payload] of [
    [17, new Uint8Array()],
    [18, Uint8Array.of(1)],
  ]) {
    await assert.rejects(f.link.request(op, payload), /重新运行 StartConsole.cmd.*仅刷新网页/);
  }
  assert(f.link.connected);
  assert(f.active);
  assert.deepEqual(await f.link.read(), f.config);
  assert(!f.calls.includes(6));
  await f.link.disconnect();
});
