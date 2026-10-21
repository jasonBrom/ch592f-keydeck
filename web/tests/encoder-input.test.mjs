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
    zooms = [],
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
      zoomModel: (factor) => zooms.push(factor),
      setView: (view) => zooms.push(view),
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
    zooms,
    read: (expression) => vm.runInContext(expression, context),
    status: (data) =>
      events.get('message')({
        source: context.window.parent,
        origin: context.location.origin,
        data: { source: 'c5-console', type: 'status', ...data },
      }),
  };
}

test('embedded wheel zooms the model without scrolling the settings or changing rotary input', () => {
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
  assert.equal(scroll.length, 0);
  assert(m.zooms[0] > 1, 'wheel down should zoom out');
  assert.equal(m.messages.at(-1).origin, 'http://localhost:8792');
  assert.equal(m.messages.at(-1).data.type, 'interact');
});

test('model view commands honor parent identity and origin and leave keyboard state untouched', () => {
  const m = model(),
    handler = m.events.get('message');
  const command = (action) => ({
    source: m.context.window.parent,
    origin: m.context.location.origin,
    data: { source: 'c5-console', type: 'view', action },
  });
  handler({ ...command('in'), origin: 'https://evil.example' });
  handler({ ...command('in'), source: {} });
  handler(command('unknown'));
  assert.deepEqual(m.zooms, []);
  for (const action of ['in', 'out', 'reset']) handler(command(action));
  assert.deepEqual(m.zooms, [0.8, 1.25, 'iso']);
  assert.equal(m.read('state.knobTarget'), 0);
});

test('actual camera zoom preserves its target and clamps near and far distances', async () => {
  const { Vector3 } = await import('../public/three.module.js');
  const camera = { position: new Vector3(0, 0, 100) };
  const controls = { target: new Vector3(), minDistance: 32, maxDistance: 1000, update() {} };
  const context = vm.createContext({ camera, controls });
  vm.runInContext(
    'let viewTween={};' + between('function zoomModel(factor){', 'function createAnnotations(){'),
    context,
  );
  context.zoomModel(0.8);
  assert.equal(camera.position.z, 80);
  context.zoomModel(0.0001);
  assert.equal(camera.position.z, 32);
  context.zoomModel(1000);
  assert.equal(camera.position.z, 1000);
  context.zoomModel(NaN);
  context.zoomModel(-1);
  assert.equal(camera.position.z, 1000);
  assert.equal(controls.target.length(), 0);
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
