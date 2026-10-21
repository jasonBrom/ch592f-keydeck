import { effectiveTransitions } from './layer-schema.js';
export function setRotaryMode(config, mode) {
  if (!Number.isInteger(mode) || mode < 0 || mode > 3) throw Error('旋钮用途无效');
  config.encoderMode = mode;
  if (mode === 0) {
    config.transitions = 4;
    config.angle = 100;
  } else if (mode === 2) config.transitions = 1;
  else if (mode === 1) config.transitions = 4;
  return config;
}
export function setDialPrecision(config, angle) {
  if (!Number.isInteger(angle) || angle < 1 || angle > 3600) throw Error('轮盘角度无效');
  config.angle = angle;
  return config;
}
export function setDialTravel(config, edges) {
  if (![1, 2, 4].includes(edges)) throw Error('轮盘转动幅度无效');
  config.transitions = edges;
  config.angle = 100;
  return config;
}
export function rotaryDescription(config, minor) {
  const edges = effectiveTransitions(config, minor),
    label = edges === 1 ? '每个有效边沿立即响应' : `每 ${edges} 个有效边沿响应`;
  if (config.encoderMode === 2)
    return `直接发送鼠标滚轮，适合浏览网页；${label}。Windows 鼠标滚动行数仍会影响每次移动距离。`;
  if (config.encoderMode === 0 && minor >= 15)
    return `Windows 原生轮盘：每个边沿精细上报约 ${(config.angle / 10 / config.transitions).toFixed(2)}°，触觉仍每 ${config.transitions} 个边沿一格。按住旋钮可选 Windows 菜单中的滚动、音量等工具；应用和系统决定滚动及选项阈值。`;
  if (config.encoderMode === 0)
    return `发送 Windows 原生轮盘角度，${label}，每次 ${(config.angle / 10).toFixed(1)}°。按住旋钮可选 Windows 菜单内的滚动、音量等工具；应用和系统决定滚动及选项阈值。下方直接鼠标滚轮是另一种独立模式。`;
  return config.encoderMode === 1
    ? `发送系统音量键；${label}，按下静音。`
    : `使用按键页的旋钮映射；${label}。`;
}
