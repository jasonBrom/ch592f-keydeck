export const STATUS_LIGHT_CAPABILITY = 0x10000;
export const STATUS_LIGHT_OFFSET = 25;
export function defaultStatusLight() {
  return { mode: 0, brightness: 100, color: [22, 138, 176] };
}
export function validateStatusLight(s) {
  if (!s || !Number.isInteger(s.mode) || s.mode < 0 || s.mode > 1) throw Error('指示灯模式无效');
  if (!Number.isInteger(s.brightness) || s.brightness < 0 || s.brightness > 100)
    throw Error('指示灯亮度必须为 0–100 的整数');
  if (
    !Array.isArray(s.color) ||
    s.color.length !== 3 ||
    s.color.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    throw Error('指示灯 RGB 必须为三个 0–255 的整数');
  return s;
}
export function hasStatusLightSettings(c) {
  const s = validateStatusLight(c.statusLight ?? defaultStatusLight()),
    d = defaultStatusLight();
  return (
    s.mode !== d.mode || s.brightness !== d.brightness || s.color.some((v, i) => v !== d.color[i])
  );
}
export function encodeStatusLight(s) {
  s = validateStatusLight(s ?? defaultStatusLight());
  const bytes = new Uint8Array(7);
  if (hasStatusLightSettings({ statusLight: s }))
    bytes.set([0x4c, s.mode, s.brightness, ...s.color, 0]);
  return bytes;
}
export function decodeStatusLight(bytes) {
  if (bytes.length !== 7) throw Error('指示灯配置长度不匹配');
  if (bytes.every((n) => n === 0)) return defaultStatusLight();
  if (bytes[0] !== 0x4c || bytes[6] !== 0) throw Error('指示灯配置格式不匹配');
  return validateStatusLight({
    mode: bytes[1],
    brightness: bytes[2],
    color: Array.from(bytes.slice(3, 6)),
  });
}
