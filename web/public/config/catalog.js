// USB HID Usage Tables 1.4, pages 0x07 (Keyboard) and 0x0C (Consumer).
export const keys = {
  0: '无键',
  40: 'Enter',
  41: 'Esc',
  42: 'Backspace',
  43: 'Tab',
  44: 'Space',
  45: '−',
  46: '=',
  47: '[',
  48: ']',
  49: '\\',
  50: 'Non-US #',
  51: ';',
  52: "'",
  53: '`',
  54: ',',
  55: '.',
  56: '/',
  57: 'Caps Lock',
  70: 'Print Screen',
  71: 'Scroll Lock',
  72: 'Pause',
  73: 'Insert',
  74: 'Home',
  75: 'Page Up',
  76: 'Delete',
  77: 'End',
  78: 'Page Down',
  79: '→',
  80: '←',
  81: '↓',
  82: '↑',
  83: 'Num Lock',
  84: '数字区 /',
  85: '数字区 *',
  86: '数字区 −',
  87: '数字区 +',
  88: '数字区 Enter',
  98: '数字区 0',
  99: '数字区 .',
  100: 'Non-US \\',
  101: 'Menu',
  103: '数字区 =',
  224: '左 Ctrl',
  225: '左 Shift',
  226: '左 Alt',
  227: '左 Win / Cmd',
  228: '右 Ctrl',
  229: '右 Shift',
  230: '右 Alt',
  231: '右 Win / Cmd',
};
for (let i = 0; i < 26; i++) keys[4 + i] = String.fromCharCode(65 + i);
for (let i = 0; i < 9; i++) {
  keys[30 + i] = String(i + 1);
  keys[89 + i] = '数字区 ' + (i + 1);
}
keys[39] = '0';
for (let i = 0; i < 12; i++) {
  keys[58 + i] = 'F' + (i + 1);
  keys[104 + i] = 'F' + (i + 13);
}
export const media = {
  0: '无',
  181: '下一首',
  182: '上一首',
  183: '停止',
  205: '播放 / 暂停',
  226: '静音',
  233: '音量 +',
  234: '音量 −',
  111: '屏幕亮度 +',
  112: '屏幕亮度 −',
  402: '计算器',
  545: '浏览器搜索',
  547: '浏览器主页',
  548: '浏览器后退',
  549: '浏览器前进',
  551: '浏览器刷新',
};
export const mouse = {
  1: '鼠标左键',
  2: '鼠标右键',
  4: '鼠标中键',
  8: '鼠标后退键',
  16: '鼠标前进键',
};
export const modifiers = [
  ['Ctrl', 1],
  ['Shift', 2],
  ['Alt', 4],
  ['Win / Cmd', 8],
  ['右 Ctrl', 16],
  ['右 Shift', 32],
  ['右 Alt', 64],
  ['右 Win', 128],
];
export const codeToHID = {
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  Space: 44,
  Minus: 45,
  Equal: 46,
  BracketLeft: 47,
  BracketRight: 48,
  Backslash: 49,
  Semicolon: 51,
  Quote: 52,
  Backquote: 53,
  Comma: 54,
  Period: 55,
  Slash: 56,
  CapsLock: 57,
  PrintScreen: 70,
  ScrollLock: 71,
  Pause: 72,
  Insert: 73,
  Home: 74,
  PageUp: 75,
  Delete: 76,
  End: 77,
  PageDown: 78,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  NumLock: 83,
  NumpadDivide: 84,
  NumpadMultiply: 85,
  NumpadSubtract: 86,
  NumpadAdd: 87,
  NumpadEnter: 88,
  Numpad0: 98,
  NumpadDecimal: 99,
  IntlBackslash: 100,
  ContextMenu: 101,
  NumpadEqual: 103,
  ControlLeft: 224,
  ShiftLeft: 225,
  AltLeft: 226,
  MetaLeft: 227,
  ControlRight: 228,
  ShiftRight: 229,
  AltRight: 230,
  MetaRight: 231,
};
for (let i = 0; i < 26; i++) codeToHID['Key' + String.fromCharCode(65 + i)] = 4 + i;
for (let i = 1; i <= 9; i++) {
  codeToHID['Digit' + i] = 29 + i;
  codeToHID['Numpad' + i] = 88 + i;
}
codeToHID.Digit0 = 39;
for (let i = 1; i <= 24; i++) codeToHID['F' + i] = i <= 12 ? 57 + i : 91 + i;
export function modifierText(mask) {
  return modifiers
    .filter(([, m]) => mask & m)
    .map(([n]) => n)
    .join(' + ');
}
export function mouseText(mask) {
  return Object.entries(mouse)
    .filter(([m]) => mask & Number(m))
    .map(([, s]) => s)
    .join(' + ');
}
export function comboText(value, mods = 0) {
  return [modifierText(mods), keys[value] ?? `HID ${value}`].filter(Boolean).join(' + ');
}
export function eventModifiers(e) {
  return (e.ctrlKey ? 1 : 0) | (e.shiftKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);
}
