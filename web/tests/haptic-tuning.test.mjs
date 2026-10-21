import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tuningDefaults,
  encodeTuning,
  decodeTuning,
  validateTuning,
  ratedCode,
  readCalibration,
  runCalibration,
  settleSavedTuning,
} from '../public/config/haptic-tuning.js';
import { defaults, encode, decode, encodeForDevice } from '../public/config/schema.js';
import { hapticDefaults } from '../public/config/haptic-schema.js';
import { mountCalibrationEditor } from '../public/config/haptic-calibration-editor.js';
test('tuning packs into existing eight bytes and roundtrips without changing mappings or legacy data', () => {
  const c = defaults(),
    original = encode(c),
    t = tuningDefaults();
  assert.deepEqual([...encodeTuning(t)], [0xc1, 0x78, 0x6b, 0x11, 90, 66, 3, 24]);
  c.advancedHaptic = { ...hapticDefaults(), tuning: t };
  c.advancedHaptic.events[2] = 126;
  const bytes = encode(c);
  assert.deepEqual(bytes.slice(0, 943), original.slice(0, 943));
  assert.deepEqual(decode(bytes).advancedHaptic, c.advancedHaptic);
  assert.deepEqual(decodeTuning(encodeTuning(t)), t);
  assert.equal(decodeTuning(new Uint8Array(8)), undefined);
  assert.throws(() => encodeForDevice(c, 11), /1.12/);
  assert.deepEqual(encodeForDevice(c, 12), bytes);
});
test('voltage policy recalculates rated code across sample times and bounds AAC0809 tolerance', () => {
  for (let sampleTime = 0; sampleTime < 4; sampleTime++)
    for (let ratedMv = 100; ratedMv <= 900; ratedMv += 10) {
      const t = { ...tuningDefaults(), sampleTime, ratedMv },
        code = ratedCode(t);
      for (let hz = 160; hz <= 180; hz++)
        assert(
          (code * 0.02058) / Math.sqrt(1 - ((4 * (150 + sampleTime * 50) + 300) * hz) / 1e6) <=
            ratedMv / 1000 + 1e-12,
        );
      assert.deepEqual(decodeTuning(encodeTuning(t)), t);
    }
  assert.equal(ratedCode(tuningDefaults()), 37);
  for (const change of [
    { ratedMv: 910 },
    { ratedMv: 899 },
    { clampCode: 67 },
    { clampCode: 59 },
    { driveTime: 22 },
    { driveTime: 27 },
    { pulseMs: 121 },
    { loopGain: 4 },
    { sampleTime: 4 },
    { brakeStabilizer: 1 },
  ])
    assert.throws(() => validateTuning({ ...tuningDefaults(), ...change }));
  for (const [index, bits] of [
    [0, 0xff],
    [2, 0x80],
    [6, 0x10],
  ]) {
    const b = encodeTuning(tuningDefaults());
    b[index] |= bits;
    assert.throws(() => decodeTuning(b));
  }
});
function fakeLink({ busyReads = 0, result = 2, phase = 3 } = {}) {
  let tuning = tuningDefaults(),
    reads = 0;
  const calls = [];
  return {
    calls,
    async request(op, p = new Uint8Array(), page = 0) {
      calls.push({ op, p: [...p], page });
      if (op === 18) {
        if (p[0] === 0) tuning = decodeTuning(p.slice(1));
        return new Uint8Array();
      }
      const b = new Uint8Array(12),
        busy = reads < busyReads;
      if (page === 0) {
        b.set([
          1,
          busy ? 2 : phase,
          0,
          0xe0,
          1,
          busy ? 1 : result,
          7,
          busy ? 4 : 0,
          81,
          103,
          3,
          tuning.pulseMs,
        ]);
        reads++;
      } else if (page === 1)
        b.set([
          7,
          ratedCode(tuning),
          tuning.clampCode,
          0xb7,
          0x98,
          0x75,
          0x88,
          0x30,
          0x80,
          60,
          0,
          0,
        ]);
      else {
        b[0] = 7;
        b.set(encodeTuning(tuning), 1);
      }
      return b;
    },
  };
}
test('calibration waits for the actual finished state and reports restored failures', async () => {
  const link = fakeLink();
  const t = { ...tuningDefaults(), pulseMs: 18 };
  const s = await runCalibration(link, t, { sleep: async () => {} });
  assert.equal(s.tuning.pulseMs, 18);
  assert.deepEqual(link.calls[0].p, [0, ...encodeTuning(t)]);
  await assert.rejects(
    runCalibration(fakeLink({ result: 3 }), t, { sleep: async () => {} }),
    /已恢复/,
  );
  const failed = fakeLink({ result: 4, phase: 4 });
  await assert.rejects(runCalibration(failed, t, { sleep: async () => {} }), /未通过/);
  const forever = fakeLink({ busyReads: 1e6 });
  await assert.rejects(runCalibration(forever, t, { sleep: async () => {} }), /超时/);
  assert.deepEqual(forever.calls.at(-1).p, [2]);
});
test('flash save is gated on driver readiness and exact active tuning readback', async () => {
  const c = defaults();
  c.advancedHaptic = { ...hapticDefaults(), tuning: tuningDefaults() };
  const bytes = encode(c);
  await settleSavedTuning(fakeLink(), bytes, { sleep: async () => {} });
  bytes[1023] = 18;
  await assert.rejects(
    settleSavedTuning(fakeLink(), bytes, { sleep: async () => {} }),
    /暂未写入 Flash/,
  );
  const broken = fakeLink({ phase: 4, result: 4 });
  await assert.rejects(
    settleSavedTuning(broken, encode(c), { sleep: async () => {} }),
    /暂未写入 Flash/,
  );
  let called = false;
  await settleSavedTuning(
    {
      request() {
        called = true;
      },
    },
    encode(defaults()),
  );
  assert.equal(called, false);
  const reset = fakeLink();
  reset.calibrationCapable = true;
  await settleSavedTuning(reset, encode(defaults()));
  assert(reset.calls.length >= 4);
});
function editorDOM() {
  const nodes = new Map();
  const root = {
    set innerHTML(html) {
      for (const m of html.matchAll(/<(button|input|select|p|pre|div)[^>]*id="([^"]+)"[^>]*>/g)) {
        const tag = m[0],
          attrs = new Set([...tag.matchAll(/\s([\w-]+)(?:=|[\s>])/g)].map((x) => x[1]));
        nodes.set(m[2], {
          value: tag.match(/value="([^"]*)"/)?.[1] || '',
          checked: false,
          disabled: false,
          textContent: '',
          classList: { toggle() {} },
          hasAttribute: (k) => attrs.has(k),
          click() {
            this.onclick?.();
          },
        });
      }
    },
    querySelector: (s) => nodes.get(s.slice(1)),
    querySelectorAll: () =>
      [...nodes.values()].filter(
        (n) => n.hasAttribute('data-cal-device') || n.onclick || n.onchange,
      ),
  };
  return { nodes, root };
}
test('calibration uses the shared draft and never changes event bindings or saves automatically', async () => {
  const { nodes, root } = editorDOM(),
    c = defaults();
  c.advancedHaptic = { ...hapticDefaults(), events: [11, 22, 33, 44, 55, 0] };
  const before = encode(c).slice(0, 943),
    events = c.advancedHaptic.events.slice(),
    link = fakeLink();
  let changes = 0;
  const editor = mountCalibrationEditor({
    root,
    link,
    getConfig: () => c,
    changed: () => changes++,
    operation: (fn) => fn(),
    download() {},
  });
  assert(nodes.get('calAuto').disabled);
  editor.setState({ connected: true, caps: 0x80000, busy: false });
  await nodes.get('calRead').onclick();
  assert.equal(c.advancedHaptic.tuning.pulseMs, 24);
  nodes.get('cal_pulseMs').value = 18;
  nodes.get('cal_pulseMs').onchange();
  assert.equal(c.advancedHaptic.tuning.pulseMs, 18);
  assert.deepEqual(c.advancedHaptic.events, events);
  assert.deepEqual(encode(c).slice(0, 943), before);
  assert(changes >= 2);
  assert(!link.calls.some((x) => x.op === 6));
  assert.equal(nodes.has('calSave'), false);
  editor.validateDraft();
  nodes.get('cal_pulseMs').value = 200;
  assert.throws(() => editor.validateDraft());
  editor.setState({ connected: false, caps: 0, busy: false });
  assert(nodes.get('calAuto').disabled);
});
test('global save confirmation and calibration success have separate persistence states', async () => {
  const { nodes, root } = editorDOM(),
    c = defaults(),
    link = fakeLink();
  const editor = mountCalibrationEditor({
    root,
    link,
    getConfig: () => c,
    changed() {},
    operation: (fn) => fn(),
    download() {},
  });
  editor.setState({ connected: true, caps: 0x80000, busy: false });
  await nodes.get('calRead').onclick();
  assert.doesNotMatch(nodes.get('calPersistence').textContent, /已确认保存/);
  editor.saved(c.advancedHaptic.tuning);
  assert.match(nodes.get('calPersistence').textContent, /设备已确认保存并回读一致/);
  nodes.get('cal_pulseMs').value = 18;
  nodes.get('cal_pulseMs').onchange();
  assert.doesNotMatch(nodes.get('calPersistence').textContent, /设备已确认保存/);
});
test('calibration failure does not adopt failed driver settings into the draft', async () => {
  const { nodes, root } = editorDOM(),
    c = defaults(),
    link = fakeLink({ result: 3 });
  const editor = mountCalibrationEditor({
    root,
    link,
    getConfig: () => c,
    changed() {},
    operation: (fn) => fn(),
    download() {},
  });
  editor.setState({ connected: true, caps: 0x80000, busy: false });
  await assert.rejects(nodes.get('calAuto').onclick(), /已恢复/);
  assert.equal(c.advancedHaptic, undefined);
  assert.doesNotMatch(nodes.get('calPersistence').textContent, /设备已确认保存/);
});
