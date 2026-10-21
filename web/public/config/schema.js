import { validateLayers, encodeLayers, decodeLayers, layerOffsets } from './layer-schema.js';
import { validateHaptic, encodeHaptic, decodeHaptic, HAPTIC_OFFSET } from './haptic-schema.js';
import {
  defaultStatusLight,
  validateStatusLight,
  encodeStatusLight,
  decodeStatusLight,
  STATUS_LIGHT_OFFSET,
} from './status-light-schema.js';
export const SIZE = 1024;
export const SERVICE = 'c5920001-7a1b-4f3b-9c28-5a72b510e001';
export const COMMAND = 'c5920002-7a1b-4f3b-9c28-5a72b510e001';
export const RESPONSE = 'c5920003-7a1b-4f3b-9c28-5a72b510e001';
export function defaults() {
  return {
    schema: 1,
    profile: 0,
    transport: 0,
    encoderMode: 0,
    brightness: 30,
    effect: 1,
    haptic: 85,
    transitions: 4,
    angle: 180,
    idle: 300,
    color: [22, 138, 176],
    statusLight: defaultStatusLight(),
    batteryScale: 1000000,
    usbRate: 0,
    bleInterval: 0,
    macroModes: Array(8).fill(0),
    profiles: Array.from({ length: 3 }, () => [
      ...[6, 25, 29, 44, 40].map((value, i) => ({ type: 1, modifiers: i < 3 ? 1 : 0, value })),
      { type: 0, modifiers: 0, value: 0 },
      { type: 3, modifiers: 0, value: -1 },
      { type: 3, modifiers: 0, value: 1 },
    ]),
    macros: Array.from({ length: 8 }, () => []),
    keyColors: Array.from({ length: 5 }, () => [22, 138, 176]),
  };
}
function int(v, a, b, name) {
  if (!Number.isInteger(v) || v < a || v > b) throw new Error(`${name} 必须为 ${a}–${b} 的整数`);
  return v;
}
export function validate(c) {
  if (!c || c.schema !== 1) throw new Error('不支持的配置版本');
  c.statusLight ??= defaultStatusLight();
  validateStatusLight(c.statusLight);
  c.usbRate ??= 0;
  c.bleInterval ??= 0;
  c.macroModes ??= Array(8).fill(0);
  if (!Array.isArray(c.macroModes) || c.macroModes.length !== 8)
    throw new Error('宏触发模式必须有八项');
  c.macroModes.forEach((m) => int(m, 0, 2, '宏触发模式'));
  for (const [k, a, b] of [
    ['profile', 0, 2],
    ['transport', 0, 2],
    ['encoderMode', 0, 3],
    ['brightness', 0, 100],
    ['effect', 0, 4],
    ['haptic', 0, 100],
    ['transitions', 1, 4],
    ['angle', 1, 3600],
    ['idle', 0, 3600],
    ['batteryScale', 500000, 1500000],
    ['usbRate', 0, 4],
    ['bleInterval', 0, 3],
  ])
    int(c[k], a, b, k);
  const rgb = (v) => {
    if (!Array.isArray(v) || v.length !== 3) throw new Error('RGB 必须有三个通道');
    v.forEach((n) => int(n, 0, 255, 'RGB'));
  };
  rgb(c.color);
  if (!Array.isArray(c.profiles) || c.profiles.length !== 3) throw new Error('需要三个配置层');
  for (const p of c.profiles) {
    if (!Array.isArray(p) || p.length !== 8) throw new Error('每层需要八个输入');
    for (const b of p) {
      int(b.type, 0, 7, '动作');
      int(b.modifiers, 0, 255, '修饰键');
      const ranges = [
        [0, 0],
        [0, 231],
        [0, 65535],
        [-127, 127],
        [0, 7],
        [0, 2],
        [1, 31],
        [0, 0],
      ];
      int(b.value, ...ranges[b.type], '动作值');
      if (b.type !== 1 && b.modifiers !== 0) throw new Error('非键盘动作不能有修饰键');
    }
  }
  if (!Array.isArray(c.macros) || c.macros.length !== 8) throw new Error('需要八个宏槽');
  for (const m of c.macros) {
    if (!Array.isArray(m) || m.length > 16) throw new Error('每个宏最多16步');
    for (const s of m) {
      int(s.type, 0, 6, '宏动作');
      int(s.modifiers, 0, 255, '宏修饰键');
      int(s.delay, 0, 10000, '延时');
      const r = [
        [0, 0],
        [0, 231],
        [0, 231],
        [0, 65535],
        [-127, 127],
        [1, 31],
        [1, 31],
      ];
      int(s.value, ...r[s.type], '宏值');
      if (![1, 2].includes(s.type) && s.modifiers !== 0)
        throw new Error('宏修饰键只能用于键盘按下/释放');
    }
  }
  if (!Array.isArray(c.keyColors) || c.keyColors.length !== 5) throw new Error('需要五个按键颜色');
  c.keyColors.forEach(rgb);
  validateHaptic(c.advancedHaptic);
  if (c.layers) {
    validateLayers(c.layers);
    if (c.layers.shortcuts && c.profiles.some((p) => p[c.layers.fn].type !== 7))
      throw Error('请先将 Fn 输入在三个配置层设为切换键');
  }
  if (c.profiles.some((p) => p.slice(6).some((b) => b.type === 7)))
    throw Error('Fn 只能绑定实体按键或旋钮按压');
  return c;
}
export function encode(c) {
  validate(c);
  const b = new Uint8Array(SIZE),
    v = new DataView(b.buffer);
  b.set([
    67,
    53,
    67,
    70,
    1,
    c.profile,
    c.transport,
    c.encoderMode,
    c.brightness,
    c.effect,
    c.haptic,
    c.transitions,
  ]);
  v.setUint16(12, c.angle, true);
  v.setUint16(14, c.idle, true);
  b.set(c.color, 16);
  v.setUint32(20, c.batteryScale, true);
  b[19] = c.usbRate;
  b[24] = c.bleInterval;
  b.set(encodeStatusLight(c.statusLight), STATUS_LIGHT_OFFSET);
  c.profiles.flat().forEach((a, i) => {
    const o = 32 + i * 4;
    b[o] = a.type;
    b[o + 1] = a.modifiers;
    v.setUint16(o + 2, a.value & 65535, true);
  });
  c.macros.forEach((m, i) => {
    const o = 128 + i * 100;
    b[o] = m.length;
    b[o + 1] = c.macroModes[i];
    m.forEach((s, j) => {
      const q = o + 4 + j * 6;
      b[q] = s.type;
      b[q + 1] = s.modifiers;
      v.setUint16(q + 2, s.value & 65535, true);
      v.setUint16(q + 4, s.delay, true);
    });
  });
  const layers = encodeLayers(c.layers);
  layerOffsets.forEach((o, i) => (b[o] = layers[i]));
  c.keyColors.forEach((c, i) => b.set(c, 928 + i * 3));
  b.set(encodeHaptic(c.advancedHaptic), HAPTIC_OFFSET);
  return b;
}
export function decode(b) {
  if (b.length !== SIZE || b[0] !== 67 || b[1] !== 53 || b[2] !== 67 || b[3] !== 70 || b[4] !== 1)
    throw new Error('设备配置格式不匹配');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength),
    c = defaults();
  [c.profile, c.transport, c.encoderMode, c.brightness, c.effect, c.haptic, c.transitions] =
    b.slice(5, 12);
  c.angle = v.getUint16(12, true);
  c.idle = v.getUint16(14, true);
  c.color = Array.from(b.slice(16, 19));
  c.batteryScale = v.getUint32(20, true);
  c.usbRate = b[19];
  c.bleInterval = b[24];
  c.statusLight = decodeStatusLight(b.slice(STATUS_LIGHT_OFFSET, STATUS_LIGHT_OFFSET + 7));
  for (let i = 0; i < 24; i++) {
    const o = 32 + i * 4,
      type = b[o];
    c.profiles[Math.floor(i / 8)][i % 8] = {
      type,
      modifiers: b[o + 1],
      value: type === 3 ? v.getInt16(o + 2, true) : v.getUint16(o + 2, true),
    };
  }
  for (let i = 0; i < 8; i++) {
    const o = 128 + i * 100;
    if (b[o] > 16) throw new Error('设备宏长度错误');
    c.macroModes[i] = b[o + 1];
    c.macros[i] = Array.from({ length: b[o] }, (_, j) => {
      const q = o + 4 + j * 6,
        type = b[q];
      return {
        type,
        modifiers: b[q + 1],
        value: type === 4 ? v.getInt16(q + 2, true) : v.getUint16(q + 2, true),
        delay: v.getUint16(q + 4, true),
      };
    });
  }
  c.keyColors = Array.from({ length: 5 }, (_, i) => Array.from(b.slice(928 + i * 3, 931 + i * 3)));
  const h = decodeHaptic(b.slice(HAPTIC_OFFSET));
  if (h) c.advancedHaptic = h;
  const layers = decodeLayers(Uint8Array.from(layerOffsets, (o) => b[o]));
  if (layers) c.layers = layers;
  return validate(c);
}
// Firmware 1.2 treats a disabled HP1 block as mute. Send the legacy zero
// extension on that version; keep the editor draft intact for JSON export.
export function encodeForDevice(c, firmwareMinor) {
  if (
    firmwareMinor < 13 &&
    (c.layers ||
      c.profiles.flat().some((b) => b.type === 7) ||
      c.advancedHaptic?.events?.some((id, i) => i !== 2 && id === 126))
  )
    throw Error('配置层组合与此短脉冲绑定需要固件 1.13');
  if ((c.advancedHaptic?.tuning || c.advancedHaptic?.events?.includes(126)) && firmwareMinor < 12)
    throw Error('高级调校参数需要固件 1.12');
  const b = encode(c);
  if (firmwareMinor === 2 && c.advancedHaptic && !c.advancedHaptic.enabled)
    b.fill(0, HAPTIC_OFFSET);
  return b;
}
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export function frame(op, seq, payload = new Uint8Array(), offset = 0) {
  if (payload.length > 12) throw new Error('配置分包过长');
  const b = new Uint8Array(20);
  b.set([0xc5, 1, op, seq, payload.length, 0, offset & 255, offset >> 8]);
  b.set(payload, 8);
  return b;
}
export function parseFrame(bytes) {
  if (bytes.length < 20 || bytes[0] !== 0xc5 || bytes[1] !== 1 || bytes[4] > 12)
    throw new Error('无效设备回复');
  return {
    op: bytes[2],
    seq: bytes[3],
    status: bytes[5],
    offset: bytes[6] | (bytes[7] << 8),
    payload: bytes.slice(8, 8 + bytes[4]),
  };
}
