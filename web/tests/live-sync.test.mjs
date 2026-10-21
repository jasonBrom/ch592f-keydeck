import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StatusMonitor, decodeStatus, encoderDelta } from '../public/config/status-monitor.js';
import { followInput } from '../public/input-motion.js';
import { DeviceLink } from '../public/config/transport.js';
import { frame, parseFrame } from '../public/config/schema.js';

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
class Clock {
  now = 0;
  next = 0;
  tasks = new Map();
  schedule = (fn, delay) => {
    const id = ++this.next;
    this.tasks.set(id, { fn, at: this.now + delay });
    return id;
  };
  cancel = (id) => this.tasks.delete(id);
  async advance(ms) {
    const end = this.now + ms;
    for (let count = 0; ; count++) {
      assert(count < 10000, 'unbounded query loop');
      const task = [...this.tasks].sort((a, b) => a[1].at - b[1].at)[0];
      if (!task || task[1].at > end) break;
      this.now = task[1].at;
      this.tasks.delete(task[0]);
      task[1].fn();
      await flush();
    }
    this.now = end;
    await flush();
  }
}
function packet(encoder = 0, keys = 0) {
  const p = Uint8Array.of(5, 73, 2, keys, 0x87, 0x0f, 0, 0, 1, 2, 12, 0);
  new DataView(p.buffer).setInt16(6, encoder, true);
  return p;
}
function fixture({ kind = 'usb', latency = 2, request } = {}) {
  const clock = new Clock(),
    samples = [],
    errors = [],
    sent = [];
  const link = {
    connected: true,
    kind,
    request: (op) => {
      assert.equal(op, 9);
      sent.push(clock.now);
      return request
        ? request(clock)
        : new Promise((resolve) => clock.schedule(() => resolve(packet()), latency));
    },
  };
  const visibility = { shown: true };
  const monitor = new StatusMonitor({
    link,
    onStatus: (s) => samples.push(s),
    onError: (e) => errors.push(e),
    visible: () => visibility.shown,
    now: () => clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  return { clock, link, monitor, visibility, samples, errors, sent };
}

test('default browser timers receive the window/global receiver when polling resumes and stops', () => {
  const originalSchedule = globalThis.setTimeout,
    originalCancel = globalThis.clearTimeout;
  const pending = new Map();
  let next = 0;
  try {
    // Browsers reject a timer method invoked with StatusMonitor as its receiver.
    // Node's timers are more permissive, so enforce the browser rule here.
    globalThis.setTimeout = function (fn, delay) {
      assert.equal(this, globalThis);
      const id = ++next;
      pending.set(id, { fn, delay });
      return id;
    };
    globalThis.clearTimeout = function (id) {
      assert.equal(this, globalThis);
      pending.delete(id);
    };
    const monitor = new StatusMonitor({
      link: { connected: true, kind: 'usb' },
      onStatus() {},
      visible: () => true,
    });
    monitor.setPaused(true);
    monitor.start();
    assert.equal(pending.size, 0);
    monitor.setPaused(false);
    assert.equal(pending.size, 1);
    assert.equal([...pending.values()][0].delay, 0);
    monitor.stop();
    assert.equal(pending.size, 0);
  } finally {
    globalThis.setTimeout = originalSchedule;
    globalThis.clearTimeout = originalCancel;
  }
});

test('status decoding honors offsets, signed count and legacy nine-byte payloads', () => {
  const container = new Uint8Array(18);
  container.set(packet(-32768, 33), 3);
  assert.deepEqual(decodeStatus(container.subarray(3, 15)), {
    flags: 5,
    percent: 73,
    profile: 2,
    keys: 33,
    millivolts: 3975,
    encoder: -32768,
    route: 1,
    usbMs: 2,
    bleUnits: 12,
  });
  assert.equal(decodeStatus(packet().slice(0, 9)).usbMs, 0);
  assert.throws(() => decodeStatus(new Uint8Array(8)), /不完整状态/);
  assert.equal(encoderDelta(-32768, 32767), 1);
  assert.equal(encoderDelta(32767, -32768), -1);
  assert.equal(encoderDelta(250, null), 0);
  assert.equal(encoderDelta(-10, 10), -20);
});
test('USB samples at 16 ms start-to-start including transport latency', async () => {
  const f = fixture();
  f.monitor.start();
  await f.clock.advance(1000);
  assert.equal(f.sent.length, 63);
  assert.deepEqual(f.sent.slice(0, 4), [0, 16, 32, 48]);
  assert.equal(f.errors.length, 0);
  f.monitor.stop();
  await f.clock.advance(1000);
  assert.equal(f.sent.length, 63);
});
test('BLE and hidden tabs query less often; returning to foreground queries immediately', async () => {
  const f = fixture({ kind: 'ble' });
  f.monitor.start();
  await f.clock.advance(110);
  assert.deepEqual(f.sent, [0, 50, 100]);
  f.visibility.shown = false;
  f.monitor.wake();
  await f.clock.advance(1100);
  assert.deepEqual(f.sent.slice(3), [110, 1110]);
  f.visibility.shown = true;
  f.monitor.wake();
  await f.clock.advance(0);
  assert.equal(f.sent.at(-1), 1210);
});
test('slow replies never create overlapping or queued status requests', async () => {
  const f = fixture({ latency: 90 });
  f.monitor.start();
  await f.clock.advance(250);
  assert.deepEqual(f.sent, [0, 90, 180]);
  assert.equal(f.samples.length, 2);
  assert.equal(f.monitor.inFlight, true);
});
test('configuration pause cancels polling and resumes without stale samples', async () => {
  const f = fixture({ latency: 50 });
  f.monitor.start();
  await f.clock.advance(1);
  f.monitor.setPaused(true);
  await f.clock.advance(1000);
  assert.equal(f.sent.length, 1);
  assert.equal(f.samples.length, 0);
  f.monitor.setPaused(false);
  await f.clock.advance(50);
  assert.equal(f.sent[1], 1001);
  assert.equal(f.samples.length, 1);
});
test('disconnect and reconnect discard old generation responses', async () => {
  const f = fixture({ latency: 40 });
  f.monitor.start();
  await f.clock.advance(1);
  f.monitor.stop();
  f.monitor.start();
  await f.clock.advance(40);
  assert.equal(f.samples.length, 0);
  assert.deepEqual(f.sent, [0, 40]);
  await f.clock.advance(40);
  assert.equal(f.samples.length, 1);
});
test('timeouts back off after the reply failure instead of retrying in a tight loop', async () => {
  const f = fixture({
    request: (clock) =>
      new Promise((resolve, reject) => clock.schedule(() => reject(Error('timeout')), 3500)),
  });
  f.monitor.start();
  await f.clock.advance(3500);
  assert.equal(f.errors.length, 1);
  assert.deepEqual(f.sent, [0]);
  await f.clock.advance(249);
  assert.equal(f.sent.length, 1);
  await f.clock.advance(1);
  assert.deepEqual(f.sent, [0, 3750]);
  await f.clock.advance(3500 + 499);
  assert.equal(f.sent.length, 2);
  await f.clock.advance(1);
  assert.equal(f.sent[2], 7750);
});
test('short presses and every detent arrive in the next query rather than a half-second batch', async () => {
  const clock = new Clock(),
    samples = [];
  const link = {
    connected: true,
    kind: 'usb',
    request: async () =>
      packet(Math.floor(clock.now / 16), clock.now >= 100 && clock.now < 135 ? 1 : 0),
  };
  const monitor = new StatusMonitor({
    link,
    onStatus: (s) => samples.push({ at: clock.now, ...s }),
    visible: () => true,
    now: () => clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  monitor.start();
  await clock.advance(200);
  const press = samples.find((s) => s.keys === 1);
  assert(press.at - 100 <= 16);
  assert(samples.some((s) => s.at > 135 && s.keys === 0));
  for (let i = 1; i < samples.length; i++)
    assert.equal(encoderDelta(samples[i].encoder, samples[i - 1].encoder), 1);
  monitor.stop();
});
test('real DeviceLink gives a paused monitor no chance to interrupt configuration writes', async () => {
  const clock = new Clock(),
    link = new DeviceLink(),
    sent = [];
  link.kind = 'usb';
  link.device = {
    sendReport: async (id, bytes) => {
      const request = parseFrame(bytes);
      sent.push(request.op);
      clock.schedule(
        () =>
          link.receive(
            frame(
              request.op | 0x80,
              request.seq,
              request.op === 9 ? packet() : new Uint8Array(),
              request.offset,
            ),
          ),
        2,
      );
    },
    removeEventListener() {},
  };
  const monitor = new StatusMonitor({
    link,
    onStatus: () => {},
    visible: () => true,
    now: () => clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  monitor.start();
  await clock.advance(1);
  monitor.setPaused(true);
  const first = link.request(3, new Uint8Array(6)),
    second = link.request(4, Uint8Array.of(1));
  await clock.advance(20);
  await Promise.all([first, second]);
  assert.deepEqual(sent, [9, 3, 4]);
  monitor.setPaused(false);
  await clock.advance(3);
  assert.deepEqual(sent, [9, 3, 4, 9]);
  monitor.stop();
});
test('live motion responds quickly and converges equally at 30/60/144 fps', () => {
  for (const fps of [30, 60, 144]) {
    let angle = 0;
    const duration = 12 / fps;
    for (let i = 0; i < 12; i++) angle = followInput(angle, Math.PI, 1 / fps, 0.018);
    assert(Math.abs(angle - Math.PI * (1 - Math.exp(-duration / 0.018))) < 1e-10);
  }
  assert(followInput(0, 1, 0.036, 0.012) > 0.95);
  assert(followInput(0, 1, 0.054, 0.018) > 0.95);
  assert.equal(followInput(5, 10, 0, 0.018), 5);
  assert.equal(followInput(5, 10, -1, 0.018), 5);
});
