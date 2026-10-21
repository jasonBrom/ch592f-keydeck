import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaults, encode, decode } from '../public/config/schema.js';
import {
  defaultStatusLight,
  hasStatusLightSettings,
  decodeStatusLight,
} from '../public/config/status-light-schema.js';
import { mountStatusLightEditor } from '../public/config/status-light-editor.js';
test('legacy config/JSON remain byte compatible and custom lamp fields roundtrip independently', () => {
  const c = defaults(),
    legacy = encode(c);
  assert.deepEqual(Array.from(legacy.slice(25, 32)), Array(7).fill(0));
  delete c.statusLight;
  assert.deepEqual(encode(c), legacy);
  assert.deepEqual(decode(legacy).statusLight, defaultStatusLight());
  c.statusLight = { mode: 1, brightness: 37, color: [0, 128, 255] };
  const bytes = encode(c);
  assert.deepEqual(Array.from(bytes.slice(25, 32)), [0x4c, 1, 37, 0, 128, 255, 0]);
  assert.deepEqual(decode(bytes).statusLight, c.statusLight);
  assert.deepEqual(decode(bytes).keyColors, defaults().keyColors);
  assert.equal(decode(bytes).brightness, 30);
  assert(hasStatusLightSettings(c));
  for (const brightness of [0, 100]) {
    c.statusLight.brightness = brightness;
    assert.equal(decode(encode(c)).statusLight.brightness, brightness);
  }
  c.statusLight = { ...defaultStatusLight(), brightness: 50 };
  assert.equal(decode(encode(c)).statusLight.mode, 0);
});
test('malformed lamp settings and reserved bytes are rejected', () => {
  for (const invalid of [
    { mode: 2 },
    { brightness: 101 },
    { brightness: -1 },
    { brightness: 0.5 },
    { color: [0, 256, 0] },
    { color: [0, 0] },
    { color: null },
  ]) {
    const c = defaults();
    Object.assign(c.statusLight, invalid);
    assert.throws(() => encode(c));
  }
  const bytes = encode({
    ...defaults(),
    statusLight: { mode: 1, brightness: 50, color: [1, 2, 3] },
  });
  for (const [offset, value] of [
    [25, 1],
    [26, 2],
    [27, 101],
    [31, 1],
  ]) {
    const bad = bytes.slice();
    bad[offset] = value;
    assert.throws(() => decode(bad));
  }
  assert.throws(() => decodeStatusLight(new Uint8Array(6)));
});
test('editor updates lamp draft only, handles zero brightness and reports old firmware', () => {
  const nodes = new Map(),
    node = (id) => {
      if (!nodes.has(id))
        nodes.set(id, { value: '', dataset: {}, hidden: false, disabled: false, textContent: '' });
      return nodes.get(id);
    };
  const root = { querySelector: (selector) => node(selector.slice(1)) },
    c = defaults();
  let changes = 0;
  const editor = mountStatusLightEditor({ root, getConfig: () => c, changed: () => changes++ });
  assert(node('statusLightColorLabel').hidden);
  node('statusLightMode').value = '1';
  node('statusLightMode').onchange();
  assert(!node('statusLightColorLabel').hidden);
  node('statusLightColor').value = '#8040ff';
  node('statusLightColor').oninput();
  assert.deepEqual(c.statusLight.color, [128, 64, 255]);
  node('statusLightBrightness').value = '0';
  node('statusLightBrightness').oninput();
  assert.equal(node('statusLightBrightnessOut').textContent, '0%');
  assert.match(node('statusLightNotice').textContent, /关闭/);
  assert.equal(changes, 3);
  assert.equal(c.brightness, 30);
  assert.deepEqual(c.color, [22, 138, 176]);
  editor.setState({ connected: true, caps: 0xffff, busy: true });
  assert(node('statusLightMode').disabled);
  assert.match(node('statusLightNotice').textContent, /1\.5/);
  editor.setState({ caps: 0x1ffff, busy: false });
  assert(!node('statusLightMode').disabled);
  assert.match(node('statusLightNotice').textContent, /关闭/);
});
