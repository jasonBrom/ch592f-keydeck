import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeEnvironment } from '../public/config/environment.js';
import { DeviceLink } from '../public/config/transport.js';
import { defaults, encode } from '../public/config/schema.js';
import { hapticDefaults } from '../public/config/haptic-schema.js';
import { tuningDefaults } from '../public/config/haptic-tuning.js';

test('online, local and unsupported environments describe only available connection methods', () => {
  const online = describeEnvironment({
    hostname: 'example.github.io',
    secure: true,
    hid: true,
    bluetooth: false,
  });
  assert(!online.local);
  assert.match(online.text, /在线控制台/);
  assert.match(online.text, /USB \/ WebHID/);
  assert(!online.text.includes('蓝牙 / Web Bluetooth'));
  assert.match(online.text, /本地控制台/);
  assert(
    describeEnvironment({ hostname: 'localhost', secure: true, hid: true, bluetooth: true }).local,
  );
  assert.match(describeEnvironment({ hostname: 'example.com', secure: false }).text, /HTTPS/);
  assert.match(describeEnvironment({ hostname: 'example.com', secure: true }).text, /离线编辑/);
});

test('motorless transport saves calibrated haptic configs without requesting absent calibration hardware', async () => {
  const config = defaults();
  config.advancedHaptic = hapticDefaults();
  config.advancedHaptic.tuning = tuningDefaults();
  const bytes = encode(config),
    link = new DeviceLink(),
    calls = [];
  link.noHaptics = true;
  link.calibrationCapable = false;
  link.request = async (op, payload, offset) => {
    calls.push(op);
    assert(![17, 18].includes(op));
  };
  link.read = async () => bytes.slice();
  assert.equal(await link.apply(bytes, true), undefined);
  assert(calls.includes(6));
  assert.equal(calls.filter((x) => x === 4).length, 86);
});

test('motorless write still refuses persistence on apply failure or corrupted readback', async () => {
  const bytes = encode(defaults()),
    link = new DeviceLink();
  let saved = false;
  link.noHaptics = true;
  link.request = async (op) => {
    if (op === 5) throw Error('rejected');
    if (op === 6) saved = true;
  };
  await assert.rejects(link.apply(bytes, true), /rejected/);
  assert(!saved);
  link.request = async () => {};
  link.read = async () => {
    const copy = bytes.slice();
    copy[4] ^= 1;
    return copy;
  };
  await assert.rejects(link.apply(bytes, true), /回读配置/);
});
