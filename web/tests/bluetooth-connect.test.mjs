import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeviceLink } from '../public/config/transport.js';
import {
  SERVICE,
  COMMAND,
  RESPONSE,
  defaults,
  encode,
  frame,
  parseFrame,
} from '../public/config/schema.js';

function fixture(
  t,
  { chooseError, missingService = false, wrongIdentity = false, noHaptics = false } = {},
) {
  const originals = ['navigator', 'isSecureContext'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const config = encode(defaults()),
    calls = [],
    rx = new EventTarget(),
    device = new EventTarget();
  let chooserOptions,
    disconnected = 0,
    notifications = false;
  rx.startNotifications = async () => {
    notifications = true;
  };
  const tx = {
    writeValueWithResponse: async (bytes) => {
      assert(notifications, 'INFO sent before notifications were ready');
      const request = parseFrame(bytes);
      calls.push(request.op);
      const info = Uint8Array.of(wrongIdentity ? 0 : 67, 53, 82, 69, 1, 2, 0, 4, 255, 255, 0, 0);
      if (noHaptics) {
        info[5] = 15;
        info[10] = 0x80;
      }
      const payload =
        request.op === 1 ? info : config.slice(request.offset, request.offset + request.payload[0]);
      assert([1, 2].includes(request.op), 'discovery wrote configuration');
      const reply = frame(request.op | 128, request.seq, payload, request.offset);
      queueMicrotask(() => {
        const buffer = new Uint8Array(24);
        buffer.set(reply, 3);
        const event = new Event('characteristicvaluechanged');
        rx.value = new DataView(buffer.buffer, 3, reply.length);
        rx.dispatchEvent(event);
      });
    },
  };
  const service = {
    getCharacteristic: async (uuid) => {
      assert([COMMAND, RESPONSE].includes(uuid));
      return uuid === COMMAND ? tx : rx;
    },
  };
  device.name = 'C5 Rev.E';
  device.gatt = {
    connected: false,
    connect: async () => {
      device.gatt.connected = true;
      return {
        getPrimaryService: async (uuid) => {
          assert.equal(uuid, SERVICE);
          if (missingService) throw new DOMException('missing service', 'NotFoundError');
          return service;
        },
      };
    },
    disconnect: () => {
      disconnected++;
      device.gatt.connected = false;
    },
  };
  const bluetooth = {
    requestDevice: async (options) => {
      chooserOptions = options;
      if (chooseError) throw chooseError;
      return device;
    },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { bluetooth } });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  return {
    link: new DeviceLink(),
    config,
    calls,
    get options() {
      return chooserOptions;
    },
    get disconnected() {
      return disconnected;
    },
  };
}

test('INFO distinguishes the motorless build before notifying the console', async (t) => {
  const f = fixture(t, { noHaptics: true });
  let observed;
  f.link.addEventListener('connect', () => {
    observed = f.link.noHaptics;
  });
  await f.link.connect('ble');
  assert.equal(f.link.noHaptics, true);
  assert.equal(observed, true);
  assert.equal(f.link.calibrationCapable, false);
  await f.link.disconnect();
});

test('name-discovered C5 connects to the permitted service and reads without changing configuration', async (t) => {
  const f = fixture(t),
    before = f.config.slice();
  await f.link.connect('ble');
  assert.deepEqual(f.options, {
    filters: [{ services: [SERVICE] }, { name: 'C5 Rev.E' }],
    optionalServices: [SERVICE],
  });
  assert(f.link.connected);
  assert.equal(f.link.kind, 'ble');
  assert.deepEqual(await f.link.read(), before);
  assert.deepEqual(f.config, before);
  assert.deepEqual(new Set(f.calls), new Set([1, 2]));
  await f.link.disconnect();
  assert.equal(f.disconnected, 1);
  assert(!f.link.connected);
});
test('empty or cancelled chooser gives discovery instructions and leaves the link disconnected', async (t) => {
  const f = fixture(t, { chooseError: new DOMException('User cancelled', 'NotFoundError') });
  await assert.rejects(f.link.connect('ble'), /未选择蓝牙设备.*BOOT.*不要按 RESET/);
  assert(!f.link.connected);
  assert.equal(f.calls.length, 0);
  assert.equal(f.disconnected, 0);
});
test('matching device name does not bypass the configuration service requirement', async (t) => {
  const f = fixture(t, { missingService: true });
  await assert.rejects(f.link.connect('ble'), /已找到蓝牙设备.*没有 C5 网页配置服务/);
  assert(!f.link.connected);
  assert.equal(f.calls.length, 0);
  assert.equal(f.disconnected, 1);
});
test('matching name and service still require compatible INFO identity before configuration access', async (t) => {
  const f = fixture(t, { wrongIdentity: true });
  await assert.rejects(f.link.connect('ble'), /不是兼容的 C5 Rev.E 固件/);
  assert(!f.link.connected);
  assert.deepEqual(f.calls, [1]);
  assert.equal(f.disconnected, 1);
});
