// TI DRV2605L SLOS854D 8.5.2, 8.6.20–28; AAC0809 supplier voltage envelope.
export const TUNING_CAP = 0x80000;
export const tuningDefaults = () => ({
  driveTime: 24,
  startupBoost: true,
  brakeStabilizer: true,
  twicePerCycle: false,
  brakeFactor: 3,
  loopGain: 1,
  sampleTime: 3,
  blanking: 1,
  idiss: 1,
  ratedMv: 900,
  clampCode: 66,
  calTime: 3,
  zeroCross: 0,
  pulseMs: 24,
});
const integer = (v, a, b, name) => {
  if (!Number.isInteger(v) || v < a || v > b) throw Error(`${name}需要 ${a}–${b} 的整数`);
};
export function validateTuning(t) {
  if (!t || typeof t !== 'object') throw Error('调校参数无效');
  for (const [k, a, b] of [
    ['driveTime', 23, 26],
    ['brakeFactor', 0, 7],
    ['loopGain', 0, 3],
    ['sampleTime', 0, 3],
    ['blanking', 0, 15],
    ['idiss', 0, 15],
    ['ratedMv', 100, 900],
    ['clampCode', 7, 66],
    ['calTime', 0, 3],
    ['zeroCross', 0, 3],
    ['pulseMs', 4, 120],
  ])
    integer(t[k], a, b, k);
  for (const k of ['startupBoost', 'brakeStabilizer', 'twicePerCycle'])
    if (typeof t[k] !== 'boolean') throw Error(`${k}需要布尔值`);
  if (t.ratedMv % 10) throw Error('额定电压需要 10 mV 步进');
  if ((t.clampCode * 21.22) ** 2 < 2 * t.ratedMv ** 2)
    throw Error('峰值钳位必须覆盖所选额定电压的正弦峰值');
  return t;
}
export function encodeTuning(t) {
  const b = new Uint8Array(8);
  if (t == null) return b;
  validateTuning(t);
  b.set([
    0xc1,
    t.driveTime |
      (Number(t.startupBoost) << 5) |
      (Number(t.brakeStabilizer) << 6) |
      (Number(t.twicePerCycle) << 7),
    t.brakeFactor | (t.loopGain << 3) | (t.sampleTime << 5),
    t.blanking | (t.idiss << 4),
    t.ratedMv / 10,
    t.clampCode,
    t.calTime | (t.zeroCross << 2),
    t.pulseMs,
  ]);
  return b;
}
export function decodeTuning(b) {
  if (b.length !== 8) throw Error('调校参数长度错误');
  if (b.every((x) => x === 0)) return undefined;
  if (b[0] !== 0xc1 || b[2] & 128 || b[6] & 240) throw Error('未知的调校参数格式');
  return validateTuning({
    driveTime: b[1] & 31,
    startupBoost: Boolean(b[1] & 32),
    brakeStabilizer: Boolean(b[1] & 64),
    twicePerCycle: Boolean(b[1] & 128),
    brakeFactor: b[2] & 7,
    loopGain: (b[2] >> 3) & 3,
    sampleTime: (b[2] >> 5) & 3,
    blanking: b[3] & 15,
    idiss: b[3] >> 4,
    ratedMv: b[4] * 10,
    clampCode: b[5],
    calTime: b[6] & 3,
    zeroCross: (b[6] >> 2) & 3,
    pulseMs: b[7],
  });
}
export function ratedCode(t) {
  validateTuning(t);
  return Math.floor(
    ((t.ratedMv / 1000) * Math.sqrt(1 - ((4 * (150 + 50 * t.sampleTime) + 300) * 180) / 1e6)) /
      0.02058,
  );
}
export async function readCalibration(link) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = await link.request(17),
      b = await link.request(17, new Uint8Array(), 1),
      c = await link.request(17, new Uint8Array(), 2),
      end = await link.request(17);
    if ([a, b, c, end].some((p) => p.length !== 12) || a[0] !== 1)
      throw Error('调校状态回复格式错误');
    if (
      a[6] !== b[0] ||
      a[6] !== c[0] ||
      a[6] !== end[6] ||
      a[1] !== end[1] ||
      a[2] !== end[2] ||
      a[5] !== end[5]
    )
      continue;
    const t = decodeTuning(c.slice(1, 9));
    if (!t) throw Error('设备返回空调校参数');
    return {
      phase: a[1],
      fault: a[2],
      chipStatus: a[3],
      job: a[4],
      result: a[5],
      generation: a[6],
      canUndo: Boolean(a[7] & 1),
      busy: Boolean(a[7] & 4),
      comp: a[8],
      bemf: a[9],
      bemfGain: a[10],
      pulseMs: a[11],
      registers: Array.from(b.slice(1, 10)),
      supplyMv: c[9] ? (b[10] * 5600) / 255 : null,
      frequency: c[9] && b[11] ? 1e6 / (b[11] * 98.46) : null,
      lastJobStatus: c[10],
      tuning: t,
    };
  }
  throw Error('读取期间校准状态发生变化，请重新读取');
}
export async function runCalibration(
  link,
  t,
  { action = 0, onStatus = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  await link.request(
    18,
    action === 0 ? Uint8Array.of(0, ...encodeTuning(t)) : Uint8Array.of(action),
  );
  for (let elapsed = 0; elapsed < 6000; elapsed += 150) {
    await sleep(150);
    const s = await readCalibration(link);
    onStatus(s);
    if (!s.busy) {
      if (s.phase !== 3 || s.result !== 2)
        throw Error(
          s.result === 3 || s.result === 6
            ? '校准失败，已恢复上一次可用参数'
            : '芯片校准／诊断未通过，请检查状态与安装',
        );
      return s;
    }
  }
  await link.request(18, Uint8Array.of(2)).catch(() => {});
  throw Error('校准等待超时，已请求停止；请重新读取状态');
}
export async function settleSavedTuning(
  link,
  bytes,
  { sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  if (bytes[1016] !== 0xc1 && !link.calibrationCapable) return;
  const expected = bytes[1016] === 0xc1 ? bytes.slice(1016, 1024) : encodeTuning(tuningDefaults());
  for (let elapsed = 0; elapsed < 6000; elapsed += 150) {
    const s = await readCalibration(link);
    if (!s.busy) {
      if (s.phase !== 3 || s.fault || encodeTuning(s.tuning).some((b, i) => b !== expected[i]))
        throw Error('配置已在 RAM 更新，但驱动校准未通过；请读取调校状态，暂未写入 Flash');
      return s;
    }
    await sleep(150);
  }
  await link.request(18, Uint8Array.of(2)).catch(() => {});
  throw Error('配置校准等待超时，暂未写入 Flash；请重新读取设备');
}
