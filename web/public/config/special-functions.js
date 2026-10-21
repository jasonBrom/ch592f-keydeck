// Presets use the existing keyboard/consumer actions; no new firmware format.
const media = (id, label, value, hint = '通过系统多媒体控制发送，USB 和蓝牙均可使用。') => ({
  id,
  label,
  group: '声音与播放',
  action: { type: 2, modifiers: 0, value },
  hint,
});
const shortcut = (id, label, modifiers, value, hint) => ({
  id,
  label,
  group: 'Windows 快捷功能',
  action: { type: 1, modifiers, value },
  hint,
});
export const specialFunctions = [
  media('volume_down', '音量减', 234),
  media('volume_up', '音量加', 233),
  media('speaker_mute', '扬声器静音 / 取消', 226),
  shortcut(
    'windows_mic',
    '麦克风静音 / 取消（Windows）',
    12,
    14,
    '发送 Win + Alt + K；仅在 Windows 支持此快捷键的应用中切换麦克风，例如受支持的会议应用。',
  ),
  media('play_pause', '播放 / 暂停', 205),
  media('next_track', '下一首', 181),
  media('previous_track', '上一首', 182),
  media('stop_playback', '停止播放', 183),
  {
    ...media('brightness_up', '屏幕亮度加', 111, '需要系统和显示器支持亮度控制。'),
    group: '屏幕与工具',
  },
  {
    ...media('brightness_down', '屏幕亮度减', 112, '需要系统和显示器支持亮度控制。'),
    group: '屏幕与工具',
  },
  { ...media('calculator', '打开计算器', 402), group: '屏幕与工具' },
  shortcut('screenshot', '区域截图', 10, 22, '发送 Win + Shift + S，打开 Windows 截图工具。'),
  shortcut('show_desktop', '显示 / 返回桌面', 8, 7, '发送 Win + D，切换桌面显示。'),
  shortcut('task_manager', '打开任务管理器', 3, 41, '发送 Ctrl + Shift + Esc。'),
];
export function specialFunctionFor(action) {
  return specialFunctions.find(
    (p) =>
      p.action.type === action.type &&
      p.action.modifiers === action.modifiers &&
      p.action.value === action.value,
  );
}
export function specialBinding(id) {
  const preset = specialFunctions.find((p) => p.id === id);
  if (!preset) throw new Error('请选择一个特殊功能');
  return { ...preset.action };
}
export function loadAudioKeys(config, profile = config.profile) {
  const ids = ['volume_down', 'volume_up', 'speaker_mute', 'windows_mic', 'play_pause'];
  ids.forEach((id, i) => {
    if (config.layers?.shortcuts && config.layers.fn === i) return;
    config.profiles[profile][i] = specialBinding(id);
  });
  return config;
}
export function mountSpecialFunctions({
  root,
  getConfig,
  getSelected,
  getProfile = () => getConfig().profile,
  changed,
  render,
  isBusy = () => false,
}) {
  const select = root.querySelector('select'),
    hint = root.querySelector('[data-special-hint]');
  const bind = root.querySelector('[data-special-bind]'),
    audio = root.querySelector('[data-audio-keys]');
  const groups = new Map();
  for (const preset of specialFunctions) {
    if (!groups.has(preset.group)) {
      const group = document.createElement('optgroup');
      group.label = preset.group;
      select.append(group);
      groups.set(preset.group, group);
    }
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    groups.get(preset.group).append(option);
  }
  function updateHint() {
    const preset = specialFunctions.find((p) => p.id === select.value);
    hint.textContent = preset?.hint || '选择音量、静音、麦克风或其他功能，再绑定到当前按键。';
    bind.dataset.fixedDisabled = String(!preset);
    bind.disabled = !preset || isBusy();
    select.disabled = audio.disabled = isBusy();
  }
  select.onchange = updateHint;
  bind.onclick = () => {
    const config = getConfig();
    config.profiles[getProfile()][getSelected()] = specialBinding(select.value);
    changed();
    render();
  };
  audio.onclick = () => {
    loadAudioKeys(getConfig(), getProfile());
    changed();
    render();
  };
  return {
    render() {
      const config = getConfig(),
        selected = getSelected();
      root.hidden = selected >= 5;
      select.value = specialFunctionFor(config.profiles[getProfile()][selected])?.id || '';
      updateHint();
    },
  };
}
