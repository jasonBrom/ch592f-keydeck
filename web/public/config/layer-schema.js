export const LAYER_CAP = 0x200000;
export const layerDefaults = () => ({
  indicator: true,
  shortcuts: false,
  colors: [
    [32, 190, 170],
    [180, 95, 255],
    [255, 155, 45],
  ],
  fn: 5,
  chords: [33, 34, 36],
});
export function validateLayers(s) {
  if (
    !s ||
    typeof s.indicator !== 'boolean' ||
    typeof s.shortcuts !== 'boolean' ||
    !Number.isInteger(s.fn) ||
    s.fn < 0 ||
    s.fn > 5
  )
    throw Error('配置层设置无效');
  if (
    !Array.isArray(s.colors) ||
    s.colors.length !== 3 ||
    s.colors.some(
      (c) =>
        !Array.isArray(c) ||
        c.length !== 3 ||
        c.some((x) => !Number.isInteger(x) || x < 0 || x > 255),
    )
  )
    throw Error('每个配置层需要一个 RGB 颜色');
  if (
    !Array.isArray(s.chords) ||
    s.chords.length !== 3 ||
    s.chords.some((x) => !Number.isInteger(x) || x < 0 || x > 63)
  )
    throw Error('切层组合无效');
  if (s.shortcuts)
    for (let i = 0; i < 3; i++) {
      const x = s.chords[i];
      if (x && (!(x & (1 << s.fn)) || x === 1 << s.fn))
        throw Error('组合必须包括 Fn 和至少一个其他输入');
      for (let j = 0; j < i; j++) {
        const y = s.chords[j];
        if (x && y && ((x & y) === x || (x & y) === y)) throw Error('切层组合不能重复或互相包含');
      }
    }
  return s;
}
export function encodeLayers(s) {
  const b = new Uint8Array(16);
  if (!s) return b;
  validateLayers(s);
  b.set([
    0xd3,
    Number(s.indicator) | (Number(s.shortcuts) << 1),
    ...s.colors.flat(),
    s.fn,
    ...s.chords,
    0,
  ]);
  return b;
}
export function decodeLayers(b) {
  if (b.length !== 16) throw Error('配置层数据长度错误');
  if (b.every((x) => x === 0)) return undefined;
  if (b[0] !== 0xd3 || b[1] & ~3 || b[15]) throw Error('配置层数据格式错误');
  return validateLayers({
    indicator: Boolean(b[1] & 1),
    shortcuts: Boolean(b[1] & 2),
    colors: Array.from({ length: 3 }, (_, i) => Array.from(b.slice(2 + 3 * i, 5 + 3 * i))),
    fn: b[11],
    chords: Array.from(b.slice(12, 15)),
  });
}
export const layerOffsets = Array.from(
  { length: 16 },
  (_, i) => 130 + 100 * Math.floor(i / 2) + (i & 1),
);
export function effectiveTransitions(c, minor) {
  return minor >= 15 && c.encoderMode === 0
    ? 1
    : minor >= 13 && c.encoderMode === 2
      ? Math.min(2, c.transitions)
      : c.transitions;
}
