import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, encode, encodeForDevice, decode } from '../public/config/schema.js';
import {
  hapticDefaults,
  encodeHaptic,
  decodeHaptic,
  effects,
} from '../public/config/haptic-schema.js';
import { DeviceLink } from '../public/config/transport.js';
test('legacy configuration retains zero extension; advanced effects survive full JSON/device round trip', () => {
  const c = defaults(),
    legacy = encode(c);
  assert(legacy.slice(943).every((x) => x === 0));
  assert.equal(decode(legacy).advancedHaptic, undefined);
  c.advancedHaptic = { ...hapticDefaults(), enabled: true, sustain: -35 };
  const b = encode(c);
  assert.deepEqual(b.slice(0, 943), legacy.slice(0, 943));
  assert.deepEqual(decode(b).advancedHaptic, c.advancedHaptic);
  assert.equal(b[1014], 249);
  assert.deepEqual(encode(decode(b)), b);
  assert.deepEqual(
    effects.map((e) => e.id),
    Array.from({ length: 123 }, (_, i) => i + 1),
  );
});
test('invalid IDs, timing, padding and oversized patterns are rejected before sending', () => {
  const h = hapticDefaults();
  for (const sequence of [[0], [124], [128], Array(9).fill(6)])
    assert.throws(() => encodeHaptic({ ...h, sequence }));
  for (const envelope of [
    [{ amplitude: 101, duration: 10 }],
    [{ amplitude: 50, duration: 3 }],
    [
      { amplitude: 50, duration: 5000 },
      { amplitude: 0, duration: 4 },
    ],
  ])
    assert.throws(() => encodeHaptic({ ...h, envelope }));
  assert.throws(() => encodeHaptic({ ...h, sustain: 3 }));
  assert.throws(() => encodeHaptic({ ...h, events: [127, 0, 0, 0, 0, 0] }));
  const b = encodeHaptic(h);
  b[80] = 1;
  assert.throws(() => decodeHaptic(b));
});
test('disabled advanced feedback retains legacy pulses on 1.2 without changing the draft or other settings', () => {
  const c = defaults();
  c.advancedHaptic = { ...hapticDefaults(), sequence: [122], events: [2, 2, 25, 11, 6, 0] };
  const draft = structuredClone(c),
    raw = encode(c),
    compatible = encodeForDevice(c, 2);
  assert.deepEqual(compatible.slice(0, 943), raw.slice(0, 943));
  assert(compatible.slice(943).every((x) => x === 0));
  assert.equal(decode(compatible).haptic, 85);
  assert.equal(decode(compatible).advancedHaptic, undefined);
  assert.deepEqual(c, draft);
  assert.deepEqual(encodeForDevice(c, 3), raw);
  c.advancedHaptic.enabled = true;
  assert.deepEqual(encodeForDevice(c, 2), encode(c));
  c.haptic = 0;
  assert.equal(encodeForDevice(c, 2)[10], 0);
});
test('draft audition uses bounded ordered RAM upload and stop cleanup after failure', async () => {
  const link = new DeviceLink(),
    calls = [];
  Object.defineProperty(link, 'connected', { value: true });
  link.request = async (op, payload, offset = 0) => {
    calls.push({ op, payload: [...payload], offset });
  };
  const b = encodeHaptic(hapticDefaults());
  await link.previewHaptic(b, 75);
  assert.equal(calls.length, 10);
  assert.deepEqual(calls[0], { op: 14, payload: [0], offset: 0 });
  assert.deepEqual(calls.at(-1), { op: 14, payload: [2, 75], offset: 0 });
  assert(calls.every((c) => c.payload.length <= 12));
  assert.deepEqual(Uint8Array.from(calls.slice(1, -1).flatMap((c) => c.payload.slice(1))), b);
  calls.length = 0;
  link.request = async (op, payload, offset = 0) => {
    calls.push({ op, payload: [...payload], offset });
    if (payload[0] === 1) throw Error('I/O failure');
  };
  await assert.rejects(link.previewHaptic(b, 45), /I\/O failure/);
  assert.deepEqual(calls.at(-1).payload, [3]);
});
