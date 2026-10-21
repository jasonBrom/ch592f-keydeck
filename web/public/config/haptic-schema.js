import { validateTuning, encodeTuning, decodeTuning } from './haptic-tuning.js';
// DRV2605L SLOS854D §12.1.2: public effect IDs and functional labels only.
// ROM samples are neither read out nor reproduced by the web editor.
export const HAPTIC_CAP = 0x8000,
  HAPTIC_OFFSET = 943,
  HAPTIC_SIZE = 81;
export const eventNames = [
  '五个按键按下',
  '旋钮按下',
  '旋钮转动',
  '切换配置层',
  '宏开始',
  '单次宏完成',
];
export const effects = [];
function add(id, label, category) {
  effects.push({ id, label, category });
}
const first = [
  '强点击 · 100%',
  '强点击 · 60%',
  '强点击 · 30%',
  '锐利点击 · 100%',
  '锐利点击 · 60%',
  '锐利点击 · 30%',
  '柔和碰撞 · 100%',
  '柔和碰撞 · 60%',
  '柔和碰撞 · 30%',
  '双点击 · 100%',
  '双点击 · 60%',
  '三点击 · 100%',
  '柔和杂振 · 60%',
  '强蜂鸣 · 100%',
  '提醒 · 750 ms',
  '提醒 · 1000 ms',
];
first.forEach((label, i) => add(i + 1, label, i < 12 ? '点击' : i < 14 ? '蜂鸣' : '提醒'));
for (const [start, name, levels] of [
  [17, '强点击', [100, 80, 60, 30]],
  [21, '中等点击', [100, 80, 60]],
  [24, '清脆刻度', [100, 80, 60]],
  [27, '短双强点击', [100, 80, 60, 30]],
  [31, '短双中等点击', [100, 80, 60]],
  [34, '短双清脆刻度', [100, 80, 60]],
  [37, '长双强点击', [100, 80, 60, 30]],
  [41, '长双中等点击', [100, 80, 60]],
  [44, '长双清脆刻度', [100, 80, 60]],
  [47, '蜂鸣', [100, 80, 60, 40, 20]],
  [58, '过渡点击', [100, 80, 60, 40, 20, 10]],
  [64, '过渡低鸣', [100, 80, 60, 40, 20, 10]],
])
  levels.forEach((level, i) =>
    add(start + i, `${name} · ${level}%`, start === 47 ? '蜂鸣' : start === 64 ? '低鸣' : '点击'),
  );
['强脉冲', '中等脉冲', '锐利脉冲'].forEach((name, i) =>
  [100, 60].forEach((level, j) => add(52 + i * 2 + j, `${name} · ${level}%`, '脉冲')),
);
for (const [start, up, ceiling] of [
  [70, false, 100],
  [82, true, 100],
  [94, false, 50],
  [106, true, 50],
])
  for (let i = 0; i < 12; i++)
    add(
      start + i,
      `${up ? '渐强' : '渐弱'} · ${i < 6 ? '平滑' : '锐利'} · ${['长', '中', '短'][Math.floor((i % 6) / 2)]} ${(i % 2) + 1} · ${up ? '0→' + ceiling : ceiling + '→0'}%`,
      '渐变',
    );
add(118, '持续蜂鸣 · 需停止命令', '蜂鸣');
[50, 40, 30, 20, 10].forEach((level, i) => add(119 + i, `平滑低鸣 · ${level}%`, '低鸣'));
effects.sort((a, b) => a.id - b.id);
export const effectName = (id) => effects.find((e) => e.id === id)?.label || '未知效果';
export function hapticDefaults() {
  return {
    enabled: false,
    mode: 0,
    sequence: [4],
    envelope: [
      { amplitude: 100, duration: 12 },
      { amplitude: 0, duration: 20 },
    ],
    events: [4, 4, 24, 10, 4, 0],
    turnInterval: 40,
    sustain: 0,
    timeout: 5000,
  };
}
const integer = (v, min, max, label) => {
  if (!Number.isInteger(v) || v < min || v > max)
    throw new Error(`${label}需要 ${min}–${max} 的整数`);
};
export function validateHaptic(h) {
  if (h == null) return h;
  if (typeof h.enabled !== 'boolean') throw new Error('触觉启用状态无效');
  integer(h.mode, 0, 1, '编辑模式');
  if (!Array.isArray(h.sequence) || h.sequence.length < 1 || h.sequence.length > 8)
    throw new Error('效果序列需要 1–8 槽（间隔也占槽）');
  h.sequence.forEach((id) => {
    integer(id, 1, 255, '序列值');
    if (id === 128 || (id < 128 && id > 123))
      throw new Error('序列效果 ID 需要 1–123；间隔需要 10–1270 ms');
  });
  if (!Array.isArray(h.envelope) || h.envelope.length < 1 || h.envelope.length > 16)
    throw new Error('RTP 曲线需要 1–16 段');
  h.envelope.forEach((s) => {
    integer(s.amplitude, 0, 100, 'RTP 幅度');
    integer(s.duration, 4, 5000, '分段时长');
  });
  if (h.envelope.reduce((n, s) => n + s.duration, 0) > 5000)
    throw new Error('RTP 总时长不能超过 5000 ms');
  if (!Array.isArray(h.events) || h.events.length !== 6) throw new Error('需要六个触觉事件绑定');
  h.events.forEach((id, i) => integer(id, 0, 126, '事件效果'));
  integer(h.turnInterval, 20, 500, '旋钮最小触觉间隔');
  integer(h.sustain, -100, 100, 'ROM 持续时间偏移');
  if (h.sustain % 5) throw new Error('ROM 时间偏移需要为 5 ms 的倍数');
  integer(h.timeout, 100, 15000, '最长播放时间');
  if (h.timeout % 100) throw new Error('最长播放时间需要为 100 ms 的倍数');
  if (h.tuning != null) validateTuning(h.tuning);
  return h;
}
export function encodeHaptic(h) {
  const b = new Uint8Array(HAPTIC_SIZE);
  if (h == null) return b;
  validateHaptic(h);
  const v = new DataView(b.buffer);
  b.set([72, 80, 49, Number(h.enabled), h.mode, h.sequence.length, h.envelope.length]);
  b.set(h.sequence, 7);
  h.envelope.forEach((s, i) => {
    b[15 + i * 3] = s.amplitude;
    v.setUint16(16 + i * 3, s.duration, true);
  });
  b.set(h.events, 63);
  v.setUint16(69, h.turnInterval, true);
  b[71] = (h.sustain / 5) & 255;
  b[72] = h.timeout / 100;
  b.set(encodeTuning(h.tuning), 73);
  return b;
}
export function decodeHaptic(b) {
  if (b.length !== 81) throw new Error('触觉配置长度无效');
  if (b.every((x) => x === 0)) return null;
  if (
    b[0] !== 72 ||
    b[1] !== 80 ||
    b[2] !== 49 ||
    b[3] > 1 ||
    b[5] < 1 ||
    b[5] > 8 ||
    b[6] < 1 ||
    b[6] > 16 ||
    b.slice(7 + b[5], 15).some(Boolean) ||
    b.slice(15 + 3 * b[6], 63).some(Boolean)
  )
    throw new Error('触觉配置格式无效');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tuning = decodeTuning(b.slice(73));
  return validateHaptic({
    ...(tuning ? { tuning } : {}),
    enabled: Boolean(b[3]),
    mode: b[4],
    sequence: Array.from(b.slice(7, 7 + b[5])),
    envelope: Array.from({ length: b[6] }, (_, i) => ({
      amplitude: b[15 + i * 3],
      duration: v.getUint16(16 + i * 3, true),
    })),
    events: Array.from(b.slice(63, 69)),
    turnInterval: v.getUint16(69, true),
    sustain: v.getInt8(71) * 5,
    timeout: b[72] * 100,
  });
}
export const envelopePresets = {
  短点击: [
    { amplitude: 100, duration: 12 },
    { amplitude: 0, duration: 20 },
  ],
  强反馈: [
    { amplitude: 100, duration: 80 },
    { amplitude: 0, duration: 20 },
  ],
  细刻度: [
    { amplitude: 65, duration: 6 },
    { amplitude: 30, duration: 6 },
    { amplitude: 0, duration: 10 },
  ],
  柔和确认: [
    { amplitude: 35, duration: 8 },
    { amplitude: 55, duration: 8 },
    { amplitude: 25, duration: 8 },
    { amplitude: 0, duration: 12 },
  ],
  成功双点: [
    { amplitude: 45, duration: 10 },
    { amplitude: 0, duration: 25 },
    { amplitude: 70, duration: 12 },
    { amplitude: 25, duration: 8 },
    { amplitude: 0, duration: 12 },
  ],
  渐强: Array.from({ length: 12 }, (_, i) => ({
    amplitude: Math.round(((i + 1) * 100) / 12),
    duration: 12,
  })).concat({ amplitude: 0, duration: 12 }),
};
