import test from 'node:test';
import assert from 'node:assert/strict';
import { autoConnect, connectionCandidates } from '../public/config/connection.js';
import { defaults, encode, decode, encodeForDevice } from '../public/config/schema.js';
import {
  layerDefaults,
  validateLayers,
  layerOffsets,
  effectiveTransitions,
} from '../public/config/layer-schema.js';
import { hapticDefaults } from '../public/config/haptic-schema.js';
import { setFeedback } from '../public/config/haptic-basic.js';
test('automatic connection prefers granted C5 USB and never opens a chooser or writes settings', async () => {
  const device = { collections: [{ usagePage: 0xff60, usage: 0x61 }] },
    other = { collections: [{ usagePage: 1, usage: 6 }] };
  const options = {
    hid: { getDevices: async () => [other, device] },
    bluetooth: { getDevices: async () => [{ name: 'C5 Rev.E' }] },
    nativeStatus: async () => ({ available: true }),
  };
  const candidates = await connectionCandidates(options);
  assert.deepEqual(
    candidates.map((c) => c.kind),
    ['usb', 'windows-ble', 'ble'],
  );
  const calls = [];
  const info = await autoConnect(
    {
      connect: async (kind, arg) => {
        calls.push([kind, arg.device]);
        return 'INFO';
      },
    },
    { discover: () => connectionCandidates(options) },
  );
  assert.equal(info, 'INFO');
  assert.deepEqual(calls, [['usb', device]]);
});
test('automatic connection falls back from unavailable USB but respects an occupied native session', async () => {
  const calls = [];
  const discover = async () => [{ kind: 'usb' }, { kind: 'windows-ble' }, { kind: 'ble' }];
  const info = await autoConnect(
    {
      connect: async (kind) => {
        calls.push(kind);
        if (kind === 'usb') throw Error('unavailable');
        return 'ok';
      },
    },
    { discover },
  );
  assert.equal(info, 'ok');
  assert.deepEqual(calls, ['usb', 'windows-ble']);
  const busy = Object.assign(Error('另一网页正在管理 C5'), { status: 409 });
  calls.length = 0;
  await assert.rejects(
    autoConnect(
      {
        connect: async (kind) => {
          calls.push(kind);
          throw busy;
        },
      },
      { discover },
    ),
    /另一网页/,
  );
  assert.deepEqual(calls, ['usb']);
  await assert.rejects(
    autoConnect({}, { discover: async () => [] }),
    (error) => error.needsChoice && /首次连接需要授权/.test(error.message),
  );
});
test('automatic connection asks for a choice when multiple C5 devices are authorized', async () => {
  let attempts = 0;
  const link = {
    connect: async () => {
      attempts++;
    },
  };
  for (const kind of ['usb', 'ble'])
    await assert.rejects(
      autoConnect(link, { discover: async () => [{ kind }, { kind }] }),
      (e) => e.needsChoice && /多台/.test(e.message),
    );
  assert.equal(attempts, 0);
});

test('a granted USB connects before any online bridge prompt even if several browser BLE grants exist', async () => {
  let probes = 0;
  const calls = [];
  const usb = { id: 'usb' };
  await autoConnect(
    { connect: async (kind, options) => calls.push([kind, options.device]) },
    {
      interactive: true,
      discover: async () => [
        { kind: 'usb', device: usb },
        { kind: 'ble', device: {} },
        { kind: 'ble', device: {} },
      ],
      bridgeStatus: async () => {
        probes++;
        throw Error('USB should have connected first');
      },
    },
  );
  assert.equal(probes, 0);
  assert.deepEqual(calls, [['usb', usb]]);
});

test('automatic connect click discovers Windows paired access before browser Bluetooth', async () => {
  const calls = [],
    probes = [];
  const result = await autoConnect(
    {
      connect: async (kind) => {
        calls.push(kind);
        return 'INFO';
      },
    },
    {
      interactive: true,
      discover: async () => [{ kind: 'ble', device: {} }],
      bridgeStatus: async (options) => {
        probes.push(options);
        return { available: true };
      },
    },
  );
  assert.equal(result, 'INFO');
  assert.deepEqual(probes, [{ interactive: true }]);
  assert.deepEqual(calls, ['windows-ble']);
});

test('unavailable Windows bridge falls back to granted Bluetooth and never runs during passive discovery', async () => {
  const device = { name: 'C5 Rev.E' },
    calls = [];
  await autoConnect(
    { connect: async (kind, options) => calls.push([kind, options.device]) },
    {
      interactive: true,
      discover: async () => [{ kind: 'ble', device }],
      bridgeStatus: async () => ({ available: false }),
    },
  );
  assert.deepEqual(calls, [['ble', device]]);
  await assert.rejects(
    autoConnect(
      {},
      {
        discover: async () => [],
        bridgeStatus: async () => assert.fail('Passive discovery must not request loopback access'),
      },
    ),
    (error) => error.needsChoice,
  );
});

test('an occupied Windows bridge never falls through to a competing browser BLE session', async () => {
  const calls = [];
  await assert.rejects(
    autoConnect(
      {
        connect: async (kind) => {
          calls.push(kind);
          throw Object.assign(Error('另一网页正在管理 C5'), { status: 409 });
        },
      },
      {
        interactive: true,
        discover: async () => [{ kind: 'ble', device: {} }],
        bridgeStatus: async () => ({ available: true }),
      },
    ),
    /另一网页/,
  );
  assert.deepEqual(calls, ['windows-ble']);
});
test('layer settings roundtrip in reserved bytes without changing macro steps or key mappings', () => {
  const c = defaults();
  c.macros[0] = [
    { type: 1, modifiers: 1, value: 6, delay: 50 },
    { type: 2, modifiers: 1, value: 6, delay: 0 },
  ];
  const before = encode(c);
  c.layers = layerDefaults();
  const bytes = encode(c);
  assert.deepEqual(decode(bytes).layers, c.layers);
  assert.deepEqual(decode(bytes).macros, c.macros);
  for (let i = 0; i < 1024; i++) if (!layerOffsets.includes(i)) assert.equal(bytes[i], before[i]);
  assert.throws(() => encodeForDevice(c, 12), /1.13/);
  assert.deepEqual(encodeForDevice(c, 13), bytes);
  c.layers.shortcuts = true;
  assert.throws(() => encode(c), /Fn/);
  for (const profile of c.profiles) profile[5] = { type: 7, modifiers: 0, value: 0 };
  assert.deepEqual(decode(encode(c)), c);
  assert.throws(() => validateLayers({ ...c.layers, chords: [33, 35, 36] }), /包含/);
  assert.throws(() => validateLayers({ ...c.layers, chords: [1, 34, 36] }), /Fn/);
});
test('daily haptics preserve unrelated bindings and waveform resources', () => {
  const c = defaults();
  c.advancedHaptic = {
    ...hapticDefaults(),
    enabled: true,
    events: [11, 22, 33, 44, 55, 0],
    sequence: [7, 8],
  };
  const mappings = structuredClone(c.profiles);
  setFeedback(c, 2, 126, 13);
  assert.deepEqual(c.advancedHaptic.events, [11, 22, 126, 44, 55, 0]);
  assert.deepEqual(c.advancedHaptic.sequence, [7, 8]);
  assert.deepEqual(c.profiles, mappings);
  const legacy = defaults();
  setFeedback(legacy, 2, 4, 13);
  assert.deepEqual(legacy.advancedHaptic.events, [126, 126, 4, 0, 0, 0]);
  assert.throws(() => encodeForDevice(legacy, 12), /1.13/);
  assert.doesNotThrow(() => encodeForDevice(legacy, 13));
  const old = defaults();
  assert.throws(() => setFeedback(old, 2, 4, 12), /1.13/);
  assert.equal(old.advancedHaptic, undefined);
});
test('scroll preview uses the same effective resolution as firmware 1.13', () => {
  const c = defaults();
  for (let mode = 0; mode < 4; mode++) {
    c.encoderMode = mode;
    assert.equal(effectiveTransitions(c, 13), mode === 2 ? 2 : 4);
    assert.equal(effectiveTransitions(c, 12), 4);
  }
});
