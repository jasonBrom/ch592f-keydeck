import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, encode, decode } from '../public/config/schema.js';
import {
  setRotaryMode,
  setDialPrecision,
  setDialTravel,
  rotaryDescription,
} from '../public/config/rotary-settings.js';
import { effectiveTransitions } from '../public/config/layer-schema.js';
test('web scrolling selects direct mouse input and responds at one edge without changing mappings or haptics', () => {
  const c = defaults(),
    before = encode(c);
  setRotaryMode(c, 2);
  const after = encode(c);
  assert.equal(c.encoderMode, 2);
  assert.equal(c.transitions, 1);
  for (let i = 0; i < 1024; i++) if (![7, 11].includes(i)) assert.equal(after[i], before[i]);
  assert.deepEqual(decode(after), c);
  assert.match(rotaryDescription(c, 14), /每个有效边沿立即响应/);
});
test('dial menu mode separates physical travel from the 10-degree logical menu tick', () => {
  const c = defaults(),
    profiles = structuredClone(c.profiles);
  setRotaryMode(c, 2);
  setRotaryMode(c, 0);
  assert.equal(c.transitions, 4);
  assert.equal(c.angle, 100);
  assert.deepEqual(c.profiles, profiles);
  for (const edges of [1, 2, 4]) {
    setDialTravel(c, edges);
    assert.equal(c.transitions, edges);
    assert.equal(c.angle, 100);
  }
  assert.throws(() => setDialTravel(c, 3));
  assert.match(rotaryDescription(c, 14), /10.0°/);
  assert.match(rotaryDescription(c, 14), /应用和系统决定/);
});
test('precision changes retain all non-precision settings and mode changes avoid fast volume output', () => {
  const c = defaults();
  setRotaryMode(c, 0);
  for (const angle of [10, 25, 45, 100]) {
    setDialPrecision(c, angle);
    assert.equal(c.transitions, 4);
    assert.equal(c.angle, angle);
  }
  setRotaryMode(c, 1);
  assert.equal(c.transitions, 4);
  setRotaryMode(c, 3);
  assert.equal(c.transitions, 4);
  assert.throws(() => setRotaryMode(c, 4));
  assert.throws(() => setDialPrecision(c, 0));
});
test('firmware 1.15 fine sampling does not change the selected physical haptic travel', () => {
  const c = defaults();
  setRotaryMode(c, 0);
  assert.equal(effectiveTransitions(c, 14), 4);
  assert.equal(effectiveTransitions(c, 15), 1);
  assert.equal(c.transitions, 4);
  assert.match(rotaryDescription(c, 15), /2.50°/);
  assert.match(rotaryDescription(c, 15), /每 4 个边沿一格/);
  c.encoderMode = 3;
  assert.equal(effectiveTransitions(c, 15), 4);
});
