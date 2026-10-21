import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLayerColor, layerIndicatorPreview } from '../public/config/layer-colors.js';
import { defaults, encode, decode } from '../public/config/schema.js';
import { layerDefaults } from '../public/config/layer-schema.js';

test('quick layer colors use existing firmware bytes while preserving mappings, Fn and startup layer', () => {
  const config = defaults();
  config.layers = layerDefaults();
  config.layers.indicator = false;
  config.profile = 2;
  const before = structuredClone(config);
  setLayerColor(config, 1, '#ee2277');
  assert.equal(config.layers.indicator, true);
  assert.deepEqual(config.layers.colors[1], [238, 34, 119]);
  const roundtrip = decode(encode(config));
  assert.deepEqual(roundtrip.layers.colors[1], [238, 34, 119]);
  assert.deepEqual(config.profiles, before.profiles);
  assert.equal(config.profile, 2);
  assert.deepEqual(config.layers.chords, before.layers.chords);
  assert.equal(config.layers.fn, before.layers.fn);
  assert.equal(config.layers.shortcuts, before.layers.shortcuts);
});

test('preview follows editing layer color and independent indicator brightness, including zero', () => {
  const config = defaults();
  setLayerColor(config, 2, '#12ab67');
  config.statusLight = { mode: 0, color: [1, 2, 3], brightness: 37 };
  assert.deepEqual(layerIndicatorPreview(config, 2), { color: [18, 171, 103], brightness: 37 });
  config.statusLight.brightness = 0;
  assert.equal(layerIndicatorPreview(config, 2).brightness, 0);
  config.layers.indicator = false;
  config.statusLight.mode = 1;
  assert.deepEqual(layerIndicatorPreview(config, 2).color, [1, 2, 3]);
  for (const [index, color] of [
    [3, '#ff0000'],
    [-1, '#ff0000'],
    [0, 'red'],
    [0, '#zz0000'],
  ])
    assert.throws(() => setLayerColor(config, index, color));
});
