import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clockwiseAngle, LiveRotation } from '../public/input-motion.js';
import { encoderDelta } from '../public/config/status-monitor.js';
import { Vector3 } from '../public/three.module.js';

test('clockwise signal moves the marker clockwise when viewed down the shaft', () => {
  const marker = new Vector3(1, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), clockwiseAngle(5));
  assert(Math.abs(marker.x) < 1e-12);
  assert(Math.abs(marker.z - 1) < 1e-12);
  for (const transitions of [1, 2, 3, 4]) {
    assert(Math.abs(clockwiseAngle(80 / transitions, transitions) + 2 * Math.PI) < 1e-12);
  }
});

test('live positions survive repeats, counter wrap, mode changes and reconnects', () => {
  const rotation = new LiveRotation();
  let target = 0.7,
    position = 0,
    previous = 32765;
  target = rotation.update(true, position, target);
  for (const count of [32766, 32767, -32768, -32767, -32766]) {
    position += encoderDelta(count, previous);
    previous = count;
    target = rotation.update(true, position, target);
  }
  assert(Math.abs(target - (0.7 - Math.PI / 2)) < 1e-12);
  for (let i = 0; i < 100; i++) assert.equal(rotation.update(true, position, target), target);
  // Changing edge resolution does not reinterpret old movement or snap the cap.
  assert.equal(rotation.update(true, position, target, 1), target);
  assert(
    Math.abs(rotation.update(true, position + 4, target, 1) - (target - Math.PI / 10)) < 1e-12,
  );
  target = rotation.update(false, 0, target);
  assert.equal(rotation.update(true, 0, target), target);
  assert.equal(rotation.update(true, NaN, target), target);
});

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function between(start, end) {
  const a = app.indexOf(start),
    b = app.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `missing app source section ${start}`);
  return app.slice(a, b);
}
function model() {
  const messages = [],
    events = new Map(),
    context = vm.createContext({
      clockwiseAngle,
      LiveRotation,
      location: { origin: 'http://localhost:8792' },
      renderer: {
        domElement: {
          addEventListener: (type, fn) => events.set(type, fn),
          hasPointerCapture: () => false,
        },
      },
      window: {
        parent: { postMessage: (data, origin) => messages.push({ data, origin }) },
        addEventListener: (type, fn) => events.set(type, fn),
      },
      controls: { enabled: true, autoRotate: false },
      document: { querySelector: () => null },
      $: () => ({ setAttribute() {} }),
      readyToPlay: () => true,
      pick: () => ({ knob: true }),
      modelEvent() {
        throw Error('live input invoked preview action');
      },
    });
  vm.runInContext(
    'let deviceInput=false,activePointer=null,viewPointer=null,viewTween=null,time=1,knobHeld=false;const heldKeys=new Set(),pulses=Array(5).fill(0),liveRotation=new LiveRotation(),state={knobTarget:0};',
    context,
  );
  vm.runInContext(between('function keyUp(i){', 'function pressKey(i){'), context);
  vm.runInContext(between('function releaseInteractions(){', 'const ray='), context);
  vm.runInContext(
    between("renderer.domElement.addEventListener('wheel'", "addEventListener('blur'"),
    context,
  );
  vm.runInContext(
    between(" addEventListener('keyup'", ' syncKnob();setFinish').replace(
      'addEventListener(',
      'window.addEventListener(',
    ),
    context,
  );
  vm.runInContext(app.slice(app.lastIndexOf("window.addEventListener('message'")), context);
  return {
    context,
    events,
    messages,
    read: (expression) => vm.runInContext(expression, context),
    status: (data) =>
      events.get('message')({
        source: context.window.parent,
        origin: context.location.origin,
        data: { source: 'c5-console', type: 'status', ...data },
      }),
  };
}

test('embedded model forwards scroll to the console without rotating the preview', () => {
  const m = model();
  let prevented = 0;
  m.events.get('wheel')({
    deltaY: 1,
    deltaMode: 1,
    preventDefault() {
      prevented++;
    },
    stopImmediatePropagation() {},
  });
  assert.equal(prevented, 1);
  assert.equal(m.read('state.knobTarget'), 0);
  const scroll = m.messages.filter((m) => m.data.type === 'scroll');
  assert.equal(scroll.length, 1);
  assert.equal(scroll[0].origin, 'http://localhost:8792');
  assert.equal(scroll[0].data.deltaY, 1);
  assert.equal(scroll[0].data.deltaMode, 1);
});

test('actual model handlers ignore duplicate HID wheel/key releases and preserve held inputs on blur', () => {
  const m = model();
  m.status({ connected: true, encoderPosition: 1, keys: 33 });
  const angle = m.read('state.knobTarget');
  let prevented = 0;
  m.events.get('wheel')({
    deltaY: -1,
    preventDefault() {
      prevented++;
    },
    stopImmediatePropagation() {},
  });
  m.events.get('keyup')({ code: 'Space' });
  m.events.get('keyup')({ code: 'Digit1' });
  m.read('releaseInteractions()');
  assert.equal(prevented, 1);
  assert.equal(m.read('state.knobTarget'), angle);
  assert.equal(m.read('heldKeys.has(0)'), true);
  assert.equal(m.read('knobHeld'), true);
  m.status({ connected: true, encoderPosition: 1, keys: 33 });
  assert.equal(m.read('state.knobTarget'), angle);
  m.status({ connected: true, encoderPosition: 0, keys: 0 });
  assert.equal(m.read('state.knobTarget'), 0);
  assert.equal(m.read('heldKeys.size'), 0);
  assert.equal(m.read('knobHeld'), false);
  m.status({ connected: false, encoderPosition: 0, keys: 0 });
  assert.equal(m.read('deviceInput'), false);
});
