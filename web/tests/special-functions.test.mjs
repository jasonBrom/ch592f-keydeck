import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  specialFunctions,
  specialBinding,
  specialFunctionFor,
  loadAudioKeys,
} from '../public/config/special-functions.js';
import { defaults, encode, decode } from '../public/config/schema.js';

test('five audio bindings encode correctly and preserve the other layers, dial and effects', () => {
  const config = defaults();
  config.profile = 1;
  config.angle = 50;
  config.encoderMode = 0;
  config.haptic = 63;
  const before = encode(config);
  loadAudioKeys(config);
  const after = encode(config);
  const expected = Uint8Array.of(
    2,
    0,
    234,
    0,
    2,
    0,
    233,
    0,
    2,
    0,
    226,
    0,
    1,
    12,
    14,
    0,
    2,
    0,
    205,
    0,
  );
  assert.deepEqual(after.slice(64, 84), expected);
  const restored = after.slice();
  restored.set(before.slice(64, 84), 64);
  assert.deepEqual(restored, before);
  assert.deepEqual(decode(after).profiles[1].slice(0, 5), config.profiles[1].slice(0, 5));
});
test('special functions are valid existing firmware actions with explicit microphone scope', () => {
  const config = defaults(),
    ids = new Set();
  for (const preset of specialFunctions) {
    assert(!ids.has(preset.id));
    ids.add(preset.id);
    const action = specialBinding(preset.id);
    config.profiles[0][0] = action;
    assert.deepEqual(decode(encode(config)).profiles[0][0], action);
    assert.equal(specialFunctionFor(action), preset);
    action.value = 0;
    assert.notDeepEqual(action, preset.action);
  }
  const mic = specialFunctions.find((p) => p.id === 'windows_mic');
  assert.deepEqual(mic.action, { type: 1, modifiers: 12, value: 14 });
  assert(mic.hint.includes('仅在 Windows 支持'));
  assert.equal(specialFunctionFor({ type: 1, modifiers: 0, value: 14 }), undefined);
  assert.throws(() => specialBinding('unknown'), /请选择/);
});
test('audio presets edit the browsed layer and preserve a reserved Fn input', () => {
  const config = defaults();
  config.profile = 0;
  config.layers = { shortcuts: true, fn: 1 };
  config.profiles[2][1] = { type: 7, modifiers: 0, value: 0 };
  const first = structuredClone(config.profiles[0]);
  loadAudioKeys(config, 2);
  assert.deepEqual(config.profiles[0], first);
  assert.equal(config.profile, 0);
  assert.equal(config.profiles[2][1].type, 7);
  assert.deepEqual(config.profiles[2][0], specialBinding('volume_down'));
});
