import { mountLayerColors, layerIndicatorPreview } from './layer-colors.js';
import {
  setRotaryMode,
  setDialPrecision,
  setDialTravel,
  rotaryDescription,
} from './rotary-settings.js';
import { autoConnect } from './connection.js';
import { mountHapticBasic } from './haptic-basic.js';
import { mountLayerEditor } from './layer-editor.js';
import { effectiveTransitions, LAYER_CAP } from './layer-schema.js';
import { mountCalibrationEditor } from './haptic-calibration-editor.js';
import { mountHapticEditor } from './haptic-editor.js';
import { defaults, encode, encodeForDevice, decode, validate } from './schema.js';
import { DeviceLink } from './transport.js?v=paired-ble-20261007';
import { windowsBluetoothStatus } from './windows-bluetooth.js';
import { StatusMonitor, encoderDelta } from './status-monitor.js?v=timer-fix-20261007';
import {
  keys,
  media,
  mouse,
  modifiers,
  codeToHID,
  comboText,
  mouseText,
  eventModifiers,
} from './catalog.js';
import { MacroRecorder, macroSummary } from './recorder.js';
import { mountSpecialFunctions, specialFunctionFor } from './special-functions.js';
import { mountStatusLightEditor } from './status-light-editor.js';
import { hasStatusLightSettings, STATUS_LIGHT_CAPABILITY } from './status-light-schema.js';
const $ = (id) => document.getElementById(id),
  link = new DeviceLink();
export { link };
let pairedBLEAvailable = false;
let calibrationEditor = null;
let config = defaults(),
  deviceConfig = null,
  selected = 0,
  macroSlot = 0,
  busy = false,
  dirty = false,
  shortcutRecording = false,
  recorder = null,
  lastEncoder = null,
  encoderPosition = 0,
  lastKeys = -1,
  caps = 0,
  firmwareMinor = null,
  actualUSB = 0,
  expectedReconnect = false;
let editingProfile = 0,
  profileActivationRequested = false,
  currentTab = 'keys';
let picker = { value: 4, mods: 0, commit: null };
const labels = [
  '按键 01',
  '按键 02',
  '按键 03',
  '按键 04',
  '按键 05',
  '旋钮按下',
  '逆时针',
  '顺时针',
];
const pins = ['PA4', 'PA5', 'PA12', 'PB7', 'PB12', 'PB4', 'PA8 / PA9', 'PA8 / PA9'];
const usbMs = (code) => [1, 8, 4, 2, 1][code];
const clone = (x) => JSON.parse(JSON.stringify(x));
function setMessage(text, kind = '') {
  $('message').textContent = text;
  $('message').className = kind;
}
function draftChanged(source = 0) {
  dirty = true;
  renderEditingContext();
  setMessage('草稿已修改；点「试用」测试，或「保存到设备」断电保留。');
  $('draftStatus').textContent = '草稿未保存';
  syncPreview();
  if (source !== 1 && calibrationEditor) calibrationEditor.render();
  if (typeof hapticBasic !== 'undefined') hapticBasic.render();
}
function modelSend(data) {
  $('model').contentWindow?.postMessage({ source: 'c5-console', ...data }, location.origin);
}
const inputButtons = [...document.querySelectorAll('[data-input]')];
const statusMonitor = new StatusMonitor({
  link,
  onStatus: updateDeviceStatus,
  onError: (error) => {
    if (!expectedReconnect) setMessage(error.message, 'error');
  },
});
function setText(id, value) {
  const element = $(id);
  if (element.textContent !== String(value)) element.textContent = value;
}
function updateDeviceStatus(status) {
  const {
    flags,
    percent,
    profile,
    keys: pressed,
    millivolts,
    encoder: enc,
    route,
    usbMs: interval,
    bleUnits,
  } = status;
  setText(
    'battery',
    percent === 255 ? '电量 —' : `电量 ${percent}% · ${(millivolts / 1000).toFixed(2)}V`,
  );
  const previousProfile = deviceConfig?.profile;
  if (deviceConfig) deviceConfig.profile = profile;
  if (!profileActivationRequested) config.profile = profile;
  setText('liveProfile', `配置 ${profile + 1}`);
  setText(
    'liveMode',
    ['Windows 轮盘', '系统音量', '页面滚动', '自定义'][
      deviceConfig?.encoderMode ?? config.encoderMode
    ],
  );
  const rgb = deviceConfig?.layers?.indicator ? deviceConfig.layers.colors[profile] : null;
  $('liveProfile').style.color = rgb ? `rgb(${rgb.join(',')})` : '';
  hapticBasic.status(flags, Boolean(caps & 0x100000));
  setText(
    'lightingSource',
    !(caps & 0x100000)
      ? 'Windows 动态灯光可能覆盖设备背光设置。'
      : flags & 16
        ? '背光由 Windows 动态灯光控制；设备灯效在系统退出接管后生效。'
        : '背光由设备灯效控制。',
  );
  if (previousProfile !== profile) renderEditingContext();
  setText('chargeStatus', flags & 4 ? '充电中' : '未充电 / 已充满');
  setText('activeProfile', `第 ${profile + 1} 层`);
  setText('activeTransport', ['未连接', 'USB', '蓝牙'][route] ?? '未知');
  setText('encoderCount', enc);
  if (caps & 256) {
    actualUSB = interval;
    setText('actualUSB', interval ? `${1000 / interval} Hz / ${interval} ms` : 'USB 未枚举');
    setText('actualBLE', bleUnits ? `${bleUnits * 1.25} ms（主机协商）` : '蓝牙未连接');
  }
  const delta = encoderDelta(enc, lastEncoder);
  lastEncoder = enc;
  encoderPosition += delta;
  if (pressed !== lastKeys || delta) {
    if (pressed !== lastKeys)
      inputButtons.forEach((button) => {
        const index = Number(button.dataset.input);
        button.classList.toggle('physical', index < 6 && Boolean(pressed & (1 << index)));
      });
    lastKeys = pressed;
    modelSend({
      type: 'status',
      keys: pressed,
      encoderPosition,
      transitions: deviceConfig ? effectiveTransitions(deviceConfig, firmwareMinor) : 4,
      connected: true,
    });
  }
}
function syncPreview() {
  modelSend({
    type: 'config',
    brightness: config.brightness,
    effect: config.effect,
    color: config.color,
    indicator: layerIndicatorPreview(config, editingProfile),
  });
}
function showTab(id) {
  currentTab = id;
  $('profilePicker').hidden = id !== 'keys';
  if (recorder && id !== 'macros') stopMacroRecording('切换页面，录制已结束');
  document.querySelectorAll('.panels > [role=tabpanel]').forEach((p) => (p.hidden = p.id !== id));
  document
    .querySelectorAll('[data-tab]')
    .forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
  $('moreSettings').open = false;
  $('settingsPanels').scrollTop = 0;
  renderEditingContext();
}
function options(select, items, value) {
  select.replaceChildren();
  for (const [id, label] of Object.entries(items)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = label;
    select.append(o);
  }
  if (![...select.options].some((o) => Number(o.value) === value)) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = `自定义值 ${value}`;
    select.append(o);
  }
  select.value = value;
}
function binding() {
  return config.profiles[editingProfile][selected];
}
function actionText(a) {
  const preset = specialFunctionFor(a);
  return (
    preset?.label ||
    (a.type === 0
      ? '不执行动作'
      : a.type === 1
        ? comboText(a.value, a.modifiers)
        : a.type === 2
          ? (media[a.value] ?? `多媒体 ${a.value}`)
          : a.type === 3
            ? `滚轮 ${a.value > 0 ? '+' : ''}${a.value}`
            : a.type === 4
              ? `宏 ${a.value + 1}`
              : a.type === 5
                ? `第 ${a.value + 1} 层`
                : a.type === 6
                  ? mouseText(a.value)
                  : a.type === 7
                    ? 'Fn · 切换配置层'
                    : '未知动作')
  );
}
function selectInput(index) {
  selected = index;
  showTab('keys');
  renderBinding();
  document
    .querySelectorAll('[data-input]')
    .forEach((b) => b.classList.toggle('selected', Number(b.dataset.input) === index));
  modelSend({ type: 'select', index });
}
function renderMappings() {
  const list = $('mappingList');
  list.replaceChildren();
  config.profiles[editingProfile].forEach((a, i) => {
    const b = document.createElement('button'),
      l = document.createElement('span'),
      r = document.createElement('span');
    b.classList.toggle('selected', i === selected);
    l.textContent = labels[i];
    r.textContent =
      a.type === 7
        ? 'Fn · 切换配置层'
        : i >= 5 && config.encoderMode === 0
          ? i === 5
            ? '轮盘按压'
            : '轮盘角度'
          : i >= 5 && config.encoderMode === 1
            ? i === 5
              ? '静音'
              : i === 6
                ? '音量 −'
                : '音量 +'
            : i >= 6 && config.encoderMode === 2
              ? '鼠标滚轮'
              : actionText(a);
    b.append(l, r);
    b.onclick = () => selectInput(i);
    list.append(b);
  });
}
function modifierChecks(root, value, onChange, all = false) {
  root.replaceChildren();
  modifiers.slice(0, all ? 8 : 4).forEach(([name, mask]) => {
    const label = document.createElement('label'),
      box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = Boolean(value & mask);
    box.onchange = () => {
      value = box.checked ? value | mask : value & ~mask;
      onChange(value);
    };
    label.append(box, document.createTextNode(name));
    root.append(label);
  });
}
function renderBinding() {
  const a = binding(),
    root = $('bindingFields');
  root.replaceChildren();
  $('inputTitle').textContent = labels[selected];
  $('pinLabel').textContent = pins[selected];
  $('bindingType').value = a.type;
  const isFn = a.type === 7 && config.layers?.shortcuts && selected === config.layers.fn;
  $('bindingType').dataset.fixedDisabled = String(isFn);
  $('bindingType').disabled = busy || isFn;
  const fixed =
    a.type !== 7 &&
    ((selected >= 5 && (config.encoderMode === 0 || config.encoderMode === 1)) ||
      (selected >= 6 && config.encoderMode === 2));
  $('bindingHint').textContent = isFn
    ? '此输入是三层共用的专用 Fn，请在下方配置层设置中修改。'
    : fixed
      ? '当前旋钮模式会覆盖这个输入。要使用此映射，请在旋钮页选择「自定义」。'
      : '键盘和鼠标按键支持按住保持、松开释放。宏按其触发模式执行。';
  if (a.type === 1) {
    const preview = document.createElement('div');
    preview.className = 'binding-preview';
    preview.textContent = comboText(a.value, a.modifiers);
    root.append(preview);
    const commands = document.createElement('div');
    commands.className = 'binding-commands';
    const choose = document.createElement('button');
    choose.textContent = '选择按键 / 组合键';
    choose.onclick = () =>
      openPicker(a.value, a.modifiers, (v, m) => {
        a.value = v;
        a.modifiers = m;
        draftChanged();
        renderBinding();
      });
    const capture = document.createElement('button');
    capture.textContent = '直接按键录入';
    capture.onclick = () => {
      shortcutRecording = true;
      capture.textContent = '请按组合键，Esc 取消';
      capture.focus();
    };
    commands.append(choose, capture);
    root.append(commands);
    const mods = document.createElement('div');
    mods.className = 'modifiers';
    modifierChecks(
      mods,
      a.modifiers,
      (m) => {
        a.modifiers = m;
        draftChanged();
        renderBinding();
      },
      true,
    );
    root.append(mods);
  } else if (a.type && a.type !== 7) {
    const label = document.createElement('label');
    label.textContent = ['', '', '多媒体功能', '滚轮步数', '宏槽', '目标配置层', '鼠标按键'][
      a.type
    ];
    let field;
    if (a.type === 3) {
      field = document.createElement('input');
      field.type = 'number';
      field.min = -127;
      field.max = 127;
      field.value = a.value;
    } else {
      field = document.createElement('select');
      options(
        field,
        a.type === 2
          ? media
          : a.type === 4
            ? Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, `宏 ${i + 1}`]))
            : a.type === 5
              ? { 0: '第 1 层', 1: '第 2 层', 2: '第 3 层' }
              : mouse,
        a.value,
      );
    }
    field.onchange = () => {
      a.value = Number(field.value);
      draftChanged();
      specialEditor.render();
      renderMappings();
    };
    label.append(field);
    root.append(label);
    if (a.type === 4) {
      const edit = document.createElement('button');
      edit.textContent = '编辑这个宏';
      edit.onclick = () => {
        macroSlot = a.value;
        $('macroSlot').value = macroSlot;
        renderMacros();
        showTab('macros');
      };
      root.append(edit);
    }
  }
  specialEditor.render();
  renderMappings();
}
function openPicker(value, mods, commit) {
  picker = { value, mods, commit };
  $('keySearch').value = '';
  modifierChecks(
    $('pickerModifiers'),
    mods,
    (m) => {
      picker.mods = m;
      renderPickerPreview();
    },
    true,
  );
  renderPicker();
  $('keyPicker').showModal();
  $('keySearch').focus();
}
function renderPickerPreview() {
  $('pickerPreview').textContent = comboText(picker.value, picker.mods);
}
function renderPicker() {
  const grid = $('keyGrid'),
    q = $('keySearch').value.trim().toLowerCase();
  grid.replaceChildren();
  for (const [value, label] of Object.entries(keys)) {
    if (q && !`${label} ${value}`.toLowerCase().includes(q)) continue;
    const b = document.createElement('button');
    b.textContent = label;
    b.classList.toggle('selected', Number(value) === picker.value);
    b.onclick = () => {
      picker.value = Number(value);
      renderPicker();
    };
    grid.append(b);
  }
  renderPickerPreview();
}
$('keySearch').oninput = renderPicker;
$('closePicker').onclick = () => $('keyPicker').close();
$('confirmPicker').onclick = () => {
  const commit = picker.commit;
  $('keyPicker').close();
  commit?.(picker.value, picker.mods);
};
function changeMacro(fn) {
  fn(config.macros[macroSlot]);
  draftChanged();
  renderMacros();
}
function renderMacros() {
  const steps = config.macros[macroSlot],
    root = $('macroRows');
  root.replaceChildren();
  $('macroMode').value = config.macroModes[macroSlot];
  const summary = macroSummary(steps);
  $('macroSummary').textContent = `${steps.length} / 16 步 · ${summary.duration} ms`;
  $('macroWarning').textContent =
    summary.warning ||
    (config.macroModes[macroSlot] === 2
      ? '再次触发同一宏可停止循环；断开、切层或应用配置也会停止。'
      : '');
  if (!steps.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-macro';
    empty.textContent = '录制一段操作，或添加组合键开始。';
    root.append(empty);
  }
  steps.forEach((step, index) => {
    const card = document.createElement('div');
    card.className = 'macro-card';
    const head = document.createElement('div');
    head.className = 'macro-card-head';
    const n = document.createElement('span');
    n.className = 'step-no';
    n.textContent = String(index + 1).padStart(2, '0');
    const type = document.createElement('select');
    type.setAttribute('aria-label', `步骤 ${index + 1} 类型`);
    options(
      type,
      {
        0: '等待',
        1: '键盘按下',
        2: '键盘释放',
        3: '多媒体点按',
        4: '鼠标滚轮',
        5: '鼠标按下',
        6: '鼠标释放',
      },
      step.type,
    );
    type.onchange = () =>
      changeMacro(() =>
        Object.assign(step, {
          type: Number(type.value),
          value:
            Number(type.value) >= 5
              ? 1
              : [1, 2].includes(Number(type.value))
                ? 4
                : Number(type.value) === 3
                  ? 233
                  : 0,
          modifiers: 0,
        }),
      );
    const actions = document.createElement('div');
    actions.className = 'step-actions';
    for (const [text, title, run, disable] of [
      [
        '↑',
        '上移',
        () =>
          changeMacro((m) => {
            [m[index - 1], m[index]] = [m[index], m[index - 1]];
          }),
        index === 0,
      ],
      [
        '↓',
        '下移',
        () =>
          changeMacro((m) => {
            [m[index + 1], m[index]] = [m[index], m[index + 1]];
          }),
        index === steps.length - 1,
      ],
      [
        '＋',
        '复制',
        () => changeMacro((m) => m.splice(index + 1, 0, { ...step })),
        steps.length >= 16,
      ],
      ['×', '删除', () => changeMacro((m) => m.splice(index, 1)), false],
    ]) {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      b.setAttribute('aria-label', `${title}步骤 ${index + 1}`);
      b.disabled = disable || Boolean(recorder);
      b.dataset.fixedDisabled = String(disable);
      b.onclick = run;
      actions.append(b);
    }
    head.append(n, type, actions);
    card.append(head);
    const body = document.createElement('div');
    body.className = 'macro-card-body';
    const valLabel = document.createElement('label');
    valLabel.textContent = '动作';
    let value;
    if ([1, 2].includes(step.type)) {
      value = document.createElement('button');
      value.textContent = comboText(step.value, step.modifiers);
      value.onclick = () =>
        openPicker(step.value, step.modifiers, (v, m) =>
          changeMacro(() => {
            step.value = v;
            step.modifiers = m;
          }),
        );
    } else if (step.type === 3 || step.type >= 5) {
      value = document.createElement('select');
      options(value, step.type === 3 ? media : mouse, step.value);
      value.onchange = () => changeMacro(() => (step.value = Number(value.value)));
    } else {
      value = document.createElement('input');
      value.type = 'number';
      value.min = step.type === 4 ? -127 : 0;
      value.max = step.type === 4 ? 127 : 0;
      value.value = step.value;
      value.disabled = step.type === 0;
      value.dataset.fixedDisabled = String(step.type === 0);
      value.onchange = () => changeMacro(() => (step.value = Number(value.value)));
    }
    valLabel.append(value);
    const delayLabel = document.createElement('label');
    delayLabel.textContent = step.type === 0 ? '等待（ms）' : '随后间隔（ms）';
    const delay = document.createElement('input');
    delay.type = 'number';
    delay.min = 0;
    delay.max = 10000;
    delay.value = step.delay;
    delay.onchange = () => changeMacro(() => (step.delay = Number(delay.value)));
    delayLabel.append(delay);
    body.append(valLabel, delayLabel);
    card.append(body);
    root.append(card);
  });
  setControls();
}
function startMacroRecording() {
  if (recorder) {
    stopMacroRecording();
    return;
  }
  if (config.macros[macroSlot].length && !confirm('录制将替换这个宏槽的步骤，继续吗？')) return;
  const fixed = Number($('fixedDelay').value);
  if (!Number.isInteger(fixed) || fixed < 0 || fixed > 10000) {
    setMessage('固定间隔需要为 0–10000 ms 的整数。', 'error');
    return;
  }
  recorder = new MacroRecorder({ timing: $('recordTiming').checked, fixedDelay: fixed });
  $('recordArea').hidden = false;
  $('recordMacro').textContent = '■ 结束录制';
  setControls();
  $('recordArea').focus();
  setMessage('在录制区域输入；Esc 结束。不会向设备发送这些操作。');
}
function stopMacroRecording(reason = '录制已结束') {
  if (!recorder) return;
  const r = recorder;
  recorder = null;
  config.macros[macroSlot] = clone(r.finish(performance.now(), reason));
  $('recordArea').hidden = true;
  $('recordMacro').textContent = '● 开始录制';
  draftChanged();
  renderMacros();
  setMessage(`${r.reason}，${config.macros[macroSlot].length} 步已加入草稿。`);
}
function recordInput(kind, value, pressed, mods = 0) {
  if (!recorder) return;
  const r = recorder;
  r.input(kind, value, pressed, performance.now(), mods);
  $('macroSummary').textContent = `录制中 · ${r.steps.length} / 16 步`;
  if (!r.active) stopMacroRecording(r.reason);
}
$('recordArea').addEventListener('keydown', (e) => {
  if (!recorder) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape') {
    stopMacroRecording();
    return;
  }
  const value = codeToHID[e.code];
  if (value && !e.repeat) recordInput('key', value, true, value >= 224 ? 0 : eventModifiers(e));
});
$('recordArea').addEventListener('keyup', (e) => {
  if (!recorder) return;
  e.preventDefault();
  const value = codeToHID[e.code];
  if (value) recordInput('key', value, false);
});
const mouseMask = (b) => [1, 4, 2, 8, 16][b];
$('recordArea').addEventListener('pointerdown', (e) => {
  if (recorder && mouseMask(e.button)) {
    e.preventDefault();
    $('recordArea').setPointerCapture(e.pointerId);
    recordInput('mouse', mouseMask(e.button), true);
  }
});
$('recordArea').addEventListener('pointerup', (e) => {
  if (recorder && mouseMask(e.button)) {
    e.preventDefault();
    recordInput('mouse', mouseMask(e.button), false);
  }
});
$('recordArea').addEventListener('pointercancel', () =>
  stopMacroRecording('输入已取消，已补全释放'),
);
$('recordArea').oncontextmenu = (e) => e.preventDefault();
$('recordArea').addEventListener('blur', (e) => {
  if (e.relatedTarget !== $('recordMacro')) stopMacroRecording('离开录制区域，已补全释放');
});
window.addEventListener(
  'keydown',
  (e) => {
    if (!shortcutRecording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      shortcutRecording = false;
      renderBinding();
      return;
    }
    const value = codeToHID[e.code];
    if (!value || value >= 224) return;
    Object.assign(binding(), { type: 1, modifiers: eventModifiers(e), value });
    shortcutRecording = false;
    draftChanged();
    renderBinding();
  },
  true,
);
window.addEventListener('blur', () => {
  shortcutRecording = false;
  stopMacroRecording('窗口失去焦点，已补全释放');
  renderBinding();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopMacroRecording('页面已隐藏，已补全释放');
});
function renderEditingContext() {
  const direct = [];
  config.profiles.forEach((p, i) =>
    p.forEach((b, k) => {
      if (b.type === 5) direct.push(`配置 ${i + 1} 的${labels[k]} → 配置 ${b.value + 1}`);
    }),
  );
  $('profileWarning').hidden = !direct.length;
  $('profileWarning').textContent =
    '检测到单键切层绑定：' + direct.join('；') + '。误按会改变整组按键功能，可改用下方 Fn 组合。';
  const active = deviceConfig?.profile;
  $('editingContext').textContent =
    `正在编辑配置 ${editingProfile + 1}；${active === undefined ? '设备未连接' : `设备正在使用配置 ${active + 1}`}。浏览配置层不会切换设备。`;
  if (currentTab !== 'keys')
    $('editingContext').textContent =
      (currentTab === 'macros'
        ? '宏槽三层共用；修改会影响所有引用此宏的按键。'
        : '此页设置三层共用，不随编辑配置层切换。') +
      (active === undefined ? '' : `设备当前使用配置 ${active + 1}。`);
  $('useProfile').textContent =
    profileActivationRequested && config.profile === editingProfile
      ? '保存后以此层启动'
      : '将此层设为启动层';
  layerColorsEditor.render({ active, editing: editingProfile });
  syncPreview();
}
function renderDial() {
  $('dialPrecision').hidden = config.encoderMode !== 0;
  $('dialTravel').value = [1, 2, 4].includes(config.transitions) ? config.transitions : 'custom';
  document
    .querySelectorAll('[data-rotary-mode]')
    .forEach((b) =>
      b.setAttribute('aria-pressed', String(config.encoderMode === Number(b.dataset.rotaryMode))),
    );
  document
    .querySelectorAll('[data-dial-angle]')
    .forEach((b) =>
      b.setAttribute('aria-pressed', String(config.angle === Number(b.dataset.dialAngle))),
    );
  $('dialModeHint').textContent = rotaryDescription(config, firmwareMinor);
  $('rotaryPresetNotice').textContent =
    '修改先进入草稿；底部试用或保存后设备才切换。旋钮用途为三层共用。';
}
function render() {
  $('profile').value = editingProfile;
  renderEditingContext();
  for (const id of [
    'encoderMode',
    'transitions',
    'brightness',
    'effect',
    'idle',
    'haptic',
    'transport',
  ])
    $(id).value = config[id];
  $('usbRate').value = config.usbRate || 4;
  $('bleInterval').value = config.bleInterval || 1;
  $('angle').value = config.angle / 10;
  $('color').value = '#' + config.color.map((x) => x.toString(16).padStart(2, '0')).join('');
  $('brightnessOut').textContent = config.brightness + '%';
  $('hapticOut').textContent = config.haptic + '%';
  renderDial();
  renderBinding();
  renderMacros();
  hapticEditor.render();
  hapticBasic.render();
  calibrationEditor.render();
  layerEditor.render();
  statusLightEditor.render();
  syncPreview();
}
function setControls() {
  statusMonitor.setPaused(busy);
  const locked = busy || Boolean(recorder);
  document
    .querySelectorAll('[data-device]')
    .forEach((b) => (b.disabled = locked || !link.connected));
  for (const id of ['connectDevice', 'connectUSB', 'connectBLE', 'connectPairedBLE'])
    $(id).disabled = locked;
  $('connectDevice').hidden = link.connected;
  $('connectionOptions').hidden = link.connected;
  $('disconnect').hidden = !link.connected;
  $('disconnect').disabled = busy;
  document
    .querySelectorAll('.panels input,.panels select,.panels button,#profile,[data-input]')
    .forEach(
      (e) =>
        (e.disabled =
          locked ||
          (e.hasAttribute('data-device') && !link.connected) ||
          e.dataset.fixedDisabled === 'true'),
    );
  layerColorsEditor.setBusy(locked);
  $('recordMacro').disabled = busy;
  $('addStep').disabled = locked || config.macros[macroSlot].length >= 16;
  $('macroCombo').disabled = locked || config.macros[macroSlot].length > 14;
  $('activateRates').disabled = locked || !link.connected || !(caps & 256);
  statusLightEditor.setState({ connected: link.connected, caps, busy: locked });
  hapticEditor.setState({ connected: link.connected, caps, busy: locked });
  hapticBasic.setState({ connected: link.connected, minor: firmwareMinor, busy: locked });
  layerEditor.setState({ connected: link.connected, caps, busy: locked });
  calibrationEditor.setState({ connected: link.connected, caps, busy: locked });
}
async function operation(fn) {
  if (busy) return;
  stopMacroRecording();
  busy = true;
  setControls();
  $('progress').hidden = false;
  $('progress').value = 0;
  try {
    await fn((p) => ($('progress').value = p));
  } catch (e) {
    setMessage(e.message || String(e), 'error');
  } finally {
    busy = false;
    $('progress').hidden = true;
    setControls();
  }
}
async function readDevice(progress) {
  setMessage('正在读取设备配置…');
  config = decode(await link.read(progress));
  deviceConfig = clone(config);
  editingProfile = config.profile;
  profileActivationRequested = false;
  dirty = false;
  $('draftStatus').textContent = '与设备一致';
  render();
  setMessage('已读取设备当前配置。', 'success');
}
function setInfo(info) {
  link.calibrationCapable = Boolean(
    new DataView(info.buffer, info.byteOffset, info.byteLength).getUint32(8, true) & 0x80000,
  );
  firmwareMinor = info[5];
  $('fwVersion').textContent = `${info[4]}.${info[5]}`;
  caps = new DataView(info.buffer, info.byteOffset, info.byteLength).getUint32(8, true);
  const features = [];
  if (caps & 64) features.push(caps & 2048 ? 'USB / 蓝牙动态灯光' : 'USB 动态灯光');
  if (caps & 128) features.push(caps & 4096 ? 'USB / 蓝牙触觉' : 'USB 触觉');
  $('windowsFeatures').textContent = features.join('；') || '基础 HID';
  $('rateNotice').textContent =
    caps & 256
      ? '保存后设备将启用新设置。USB 会短暂重连，蓝牙实际间隔以主机协商结果为准。'
      : '当前固件不支持回报率，请先刷入本包 R2 固件。';
}
async function connect(kind = 'auto') {
  await operation(async (progress) => {
    expectedReconnect = false;
    setMessage(
      kind === 'windows-ble' ? '正在通过本机服务连接 Windows 已配对设备…' : '正在判断可用连接…',
    );
    try {
      const info =
        kind === 'auto'
          ? await autoConnect(link, {
              onAttempt: (k) =>
                setMessage(k === 'usb' ? '正在连接已授权 USB…' : '正在连接已配对蓝牙…'),
            })
          : await link.connect(kind);
      setInfo(info);
      $('connectionOptions').open = false;
      lastEncoder = null;
      const current = decode(await link.read(progress));
      deviceConfig = clone(current);
      if (!dirty) {
        config = current;
        editingProfile = current.profile;
        profileActivationRequested = false;
        render();
        $('draftStatus').textContent = '与设备一致';
        setMessage('已连接并读取设备配置。', 'success');
      } else setMessage('设备已连接，保留本页未保存草稿。', 'success');
    } catch (e) {
      if (e.needsChoice || kind === 'windows-ble') $('connectionOptions').open = true;
      throw e;
    }
  });
}
function requireCapabilities() {
  calibrationEditor.validateDraft();
  validate(config);
  if ((config.layers || config.profiles.flat().some((b) => b.type === 7)) && !(caps & LAYER_CAP))
    throw Error('RGB 配置层和 Fn 组合需要固件 1.13');
  if (
    !(caps & 0x800000) &&
    (config.advancedHaptic?.tuning || config.advancedHaptic?.events?.includes(126)) &&
    !(caps & 0x80000)
  )
    throw Error('旋钮独立脉冲与高级校准需要固件 1.12');
  if (hasStatusLightSettings(config) && !(caps & STATUS_LIGHT_CAPABILITY))
    throw new Error('指示灯颜色和亮度需要固件 1.5，请先升级固件。');
  if (!(caps & 0x800000) && config.advancedHaptic && !(caps & 0x8000))
    throw new Error('高级触觉需要触觉工作室固件；请升级固件，或在触觉页恢复传统触觉。');
  if (
    !(caps & 512) &&
    (config.profiles.flat().some((b) => b.type === 6) ||
      config.macros.flat().some((s) => s.type >= 5))
  )
    throw new Error('鼠标按键需要 R2 固件，请先升级固件。');
  if (!(caps & 1024) && config.macroModes.some(Boolean))
    throw new Error('重复宏模式需要 R2 固件，请先升级固件。');
  if (!(caps & 256) && (config.usbRate || config.bleInterval))
    throw new Error('回报率设置需要 R2 固件，请先升级固件。');
}
async function saveConfig(persist, progress) {
  if (!profileActivationRequested) {
    const status = await link.request(9);
    config.profile = status[2];
  }
  requireCapabilities();
  const activate = persist && Boolean(caps & 256);
  const usbWillChange = actualUSB > 0 && actualUSB !== usbMs(config.usbRate);
  const bytes = encodeForDevice(config, firmwareMinor);
  setMessage(persist ? '正在写入并保存配置…' : '正在临时应用配置…');
  const tuningStatus = await link.apply(bytes, persist, progress);
  deviceConfig = decode(bytes);
  profileActivationRequested = false;
  dirty = false;
  $('draftStatus').textContent = persist ? '已保存到设备' : '已试用 · 未保存';
  if (tuningStatus && calibrationEditor.applied) calibrationEditor.applied(tuningStatus);
  if (persist && typeof calibrationEditor !== 'undefined' && calibrationEditor)
    calibrationEditor.saved(deviceConfig.advancedHaptic?.tuning);
  if (activate) {
    expectedReconnect = link.kind === 'usb' && usbWillChange;
    try {
      await link.request(11);
    } catch (e) {
      expectedReconnect = false;
      throw new Error('配置已保存，但回报率启用失败：' + e.message);
    }
    setMessage(
      expectedReconnect
        ? '配置已保存，USB 将短暂重连；随后请重新点击「连接设备」。'
        : '配置已保存并校验，已提交回报率设置。实际值请看设备状态。',
      'success',
    );
  } else
    setMessage(
      persist ? '设备已确认保存，配置回读一致。' : '已临时应用。回报率需保存并启用后生效。',
      'success',
    );
}
function download(name, obj) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' }),
    ),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const hapticBasic = mountHapticBasic({
  root: $('hapticBasic'),
  getConfig: () => config,
  changed: draftChanged,
  test: () =>
    operation(async () => {
      await link.request(10, Uint8Array.of(config.haptic));
      setMessage('已试听当前驱动的脉冲。');
    }),
});
const hapticEditor = mountHapticEditor({
  root: $('hapticEditor'),
  getConfig: () => config,
  changed: draftChanged,
  download,
  preview: (block, gain) =>
    operation(async () => {
      if (!(caps & 0x8000)) throw Error('当前固件不支持高级触觉试听');
      await link.previewHaptic(block, gain);
      setMessage('设备已确认开始播放触觉草稿。', 'success');
    }),
  stop: () =>
    operation(async () => {
      await link.request(14, Uint8Array.of(3));
      setMessage('设备已确认停止振动。');
    }),
});
const calibrationRoot = $('calibrationEditor');
calibrationEditor = mountCalibrationEditor({
  root: calibrationRoot,
  link,
  getConfig: () => config,
  changed: () => draftChanged(1),
  operation,
  download,
  refreshHaptic: () => {
    hapticEditor.render();
    hapticBasic.render();
  },
});
const layerEditor = mountLayerEditor({
  root: $('layerEditor'),
  getConfig: () => config,
  changed: draftChanged,
  refresh: () => {
    renderBinding();
    renderEditingContext();
    statusLightEditor.render();
  },
});
const statusLightEditor = mountStatusLightEditor({
  root: $('statusLightEditor'),
  getConfig: () => config,
  changed: draftChanged,
});
const layerColorsEditor = mountLayerColors({
  root: $('layerLegend'),
  getConfig: () => config,
  changed: () => {
    draftChanged();
    layerEditor.render();
    statusLightEditor.render();
  },
  selectProfile: (i) => {
    editingProfile = i;
    showTab('keys');
    $('profile').value = i;
    renderBinding();
    renderEditingContext();
  },
});
const specialEditor = mountSpecialFunctions({
  root: $('specialFunctions'),
  getConfig: () => config,
  getSelected: () => selected,
  getProfile: () => editingProfile,
  changed: draftChanged,
  render: renderBinding,
  isBusy: () =>
    busy || Boolean(recorder) || Boolean(config.layers?.shortcuts && selected === config.layers.fn),
});
$('connectDevice').onclick = () => connect('auto');
$('connectUSB').onclick = () => connect('usb');
$('connectBLE').onclick = () => connect('ble');
$('connectPairedBLE').onclick = () => connect('windows-ble');
$('disconnect').onclick = () => link.disconnect();
link.addEventListener('connect', () => {
  lastKeys = -1;
  lastEncoder = null;
  encoderPosition = 0;
  modelSend({ type: 'status', keys: 0, encoderPosition: 0, connected: true });
  statusMonitor.start();
  $('connectionBadge').textContent =
    link.kind === 'usb'
      ? 'USB 已连接'
      : link.kind === 'windows-ble'
        ? '蓝牙已连接 · Windows'
        : '蓝牙已连接';
  $('connectionBadge').classList.add('on');
  $('liveDot').classList.add('on');
  $('modelState').textContent = '已连接 · 设备输入同步';
  setControls();
});
link.addEventListener('disconnect', () => {
  statusMonitor.stop();
  lastKeys = -1;
  inputButtons.forEach((button) => button.classList.remove('physical'));
  $('connectionBadge').textContent = '未连接';
  $('connectionBadge').classList.remove('on');
  $('liveDot').classList.remove('on');
  $('modelState').textContent = '离线编辑 · 模型预览';
  $('battery').textContent = '电量 —';
  $('liveProfile').textContent = '未连接';
  $('liveMode').textContent = '—';
  $('actualUSB').textContent = $('actualBLE').textContent = '—';
  lastEncoder = null;
  actualUSB = 0;
  caps = 0;
  firmwareMinor = null;
  deviceConfig = null;
  encoderPosition = 0;
  modelSend({ type: 'status', keys: 0, encoderPosition: 0, connected: false });
  setMessage(
    expectedReconnect
      ? '回报率设置已保存，USB 正在重连。请重新点击「连接设备」。'
      : '设备已断开，草稿已保留。',
  );
  setControls();
});
$('read').onclick = () => {
  if (dirty && !confirm('读取会替换尚未写入的草稿，继续吗？')) return;
  operation(readDevice);
};
$('apply').onclick = () => operation((p) => saveConfig(false, p));
$('save').onclick = () => operation((p) => saveConfig(true, p));
$('activateRates').textContent = '保存并启用回报率';
$('activateRates').onclick = () => operation((p) => saveConfig(true, p));
$('bindingType').onchange = () => {
  const type = Number($('bindingType').value);
  Object.assign(binding(), {
    type,
    modifiers: 0,
    value: type === 6 ? 1 : type === 1 ? 4 : type === 2 ? 233 : 0,
  });
  draftChanged();
  renderBinding();
};
document
  .querySelectorAll('[data-input]')
  .forEach((b) => (b.onclick = () => selectInput(Number(b.dataset.input))));
document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
$('firmwareNav').onclick = (e) => {
  e.preventDefault();
  showTab('firmware');
  if (innerWidth < 761) document.querySelector('.editor')?.scrollIntoView();
};
$('profile').onchange = () => {
  editingProfile = Number($('profile').value);
  renderBinding();
  renderEditingContext();
};
$('useProfile').onclick = () => {
  config.profile = editingProfile;
  profileActivationRequested = true;
  draftChanged();
  renderEditingContext();
};
for (const id of [
  'transitions',
  'brightness',
  'effect',
  'idle',
  'haptic',
  'transport',
  'usbRate',
  'bleInterval',
])
  $(id).addEventListener(['brightness', 'haptic'].includes(id) ? 'input' : 'change', () => {
    config[id] = Number($(id).value);
    draftChanged();
    render();
  });
$('dialTravel').addEventListener('change', () => {
  setDialTravel(config, Number($('dialTravel').value));
  draftChanged();
  render();
});
$('encoderMode').addEventListener('change', () => {
  setRotaryMode(config, Number($('encoderMode').value));
  draftChanged();
  render();
});
document.querySelectorAll('[data-rotary-mode]').forEach(
  (b) =>
    (b.onclick = () => {
      setRotaryMode(config, Number(b.dataset.rotaryMode));
      draftChanged();
      render();
    }),
);
$('angle').onchange = () => {
  config.angle = Math.round(Number($('angle').value) * 10);
  draftChanged();
  renderDial();
};
document.querySelectorAll('[data-dial-angle]').forEach(
  (b) =>
    (b.onclick = () => {
      setDialPrecision(config, Number(b.dataset.dialAngle));
      draftChanged();
      render();
    }),
);
$('color').oninput = () => {
  config.color = $('color')
    .value.match(/\w\w/g)
    .map((x) => parseInt(x, 16));
  config.keyColors = Array.from({ length: 5 }, () => [...config.color]);
  draftChanged();
};
$('editEncoder').onclick = () => selectInput(5);
options(
  $('macroSlot'),
  Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, `宏 ${i + 1}`])),
  0,
);
$('macroSlot').onchange = () => {
  macroSlot = Number($('macroSlot').value);
  renderMacros();
};
$('macroMode').onchange = () => {
  config.macroModes[macroSlot] = Number($('macroMode').value);
  draftChanged();
  renderMacros();
};
$('recordMacro').onclick = startMacroRecording;
$('addStep').onclick = () => {
  if (config.macros[macroSlot].length < 16)
    changeMacro((m) => m.push({ type: 0, modifiers: 0, value: 0, delay: 100 }));
};
$('macroCombo').onclick = () => {
  if (config.macros[macroSlot].length > 14) return;
  openPicker(6, 1, (value, mods) =>
    changeMacro((m) =>
      m.push(
        { type: 1, value, modifiers: mods, delay: 50 },
        { type: 2, value, modifiers: mods, delay: 0 },
      ),
    ),
  );
};
$('clearMacro').onclick = () => {
  if (config.macros[macroSlot].length && confirm('清空当前宏槽的步骤吗？'))
    changeMacro((m) => m.splice(0));
};
$('macroExample').onclick = () => {
  if (config.macros[macroSlot].length && !confirm('覆盖这个宏槽的步骤吗？')) return;
  changeMacro((m) =>
    m.splice(
      0,
      m.length,
      { type: 1, modifiers: 1, value: 6, delay: 50 },
      { type: 2, modifiers: 1, value: 6, delay: 0 },
    ),
  );
};
$('testHaptic').onclick = () =>
  operation(async () => {
    await link.request(10, Uint8Array.of(config.haptic));
    setMessage('振动测试已由设备确认。', 'success');
  });
$('export').onclick = () => {
  try {
    validate(config);
    download('C5-RevE-R2-config.json', config);
    setMessage('全部配置已导出。');
  } catch (e) {
    setMessage(e.message, 'error');
  }
};
$('import').onclick = () => $('importFile').click();
$('importFile').onchange = async () => {
  const f = $('importFile').files[0];
  if (!f) return;
  try {
    if (f.size > 65536) throw new Error('配置文件过大');
    config = decode(encode(validate(JSON.parse(await f.text()))));
    draftChanged();
    render();
    setMessage('配置已导入草稿，尚未写入设备。');
  } catch (e) {
    setMessage('导入失败：' + e.message, 'error');
  }
  $('importFile').value = '';
};
$('defaults').onclick = () => {
  if (!confirm('将当前草稿恢复默认？设备不会立即改变。')) return;
  config = defaults();
  dirty = true;
  render();
  setMessage('默认配置已载入草稿。');
};
window.addEventListener('message', (e) => {
  if (
    e.origin !== location.origin ||
    e.source !== $('model').contentWindow ||
    e.data?.source !== 'c5-model'
  )
    return;
  if (e.data.type === 'ready') {
    syncPreview();
    modelSend({
      type: 'status',
      keys: Math.max(0, lastKeys),
      encoderPosition,
      transitions: deviceConfig ? effectiveTransitions(deviceConfig, firmwareMinor) : 4,
      connected: link.connected,
    });
  }
  if (e.data.type === 'interact') {
    $('connectionOptions').open = false;
    $('moreSettings').open = false;
    return;
  }
  if (
    e.data.type === 'select' &&
    Number.isInteger(e.data.index) &&
    e.data.index >= 0 &&
    e.data.index < 8 &&
    !busy &&
    !recorder
  )
    selectInput(e.data.index);
});
$('model').addEventListener('load', syncPreview);
document.addEventListener('visibilitychange', () => statusMonitor.wake());
window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
render();
selectInput(0);
if (location.hash === '#haptics') showTab('haptics');

windowsBluetoothStatus().then((status) => {
  pairedBLEAvailable = status.available === true;
  $('connectionHint').textContent = pairedBLEAvailable
    ? '连接时自动选择已授权 USB 或 Windows 已配对蓝牙。'
    : 'USB 可直接授权；Windows 已连接蓝牙请在连接选项中选择「Windows 已配对」。';
  setControls();
});
window.addEventListener('pagehide', () => {
  if (link.kind === 'windows-ble') link.device?.disconnect(true).catch(() => {});
});
