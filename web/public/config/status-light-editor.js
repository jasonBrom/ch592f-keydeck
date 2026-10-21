import { STATUS_LIGHT_CAPABILITY, defaultStatusLight } from './status-light-schema.js';
export function mountStatusLightEditor({ root, getConfig, changed }) {
  root.innerHTML = `<h3>独立指示灯</h3><p class="hint">指示灯可显示连接状态、固定颜色或当前配置层。配对时蓝色闪烁优先。</p><label>颜色模式<select id="statusLightMode"><option value="0">自动 · 显示连接状态</option><option value="1">自定义颜色</option></select></label><label>指示灯亮度 <output id="statusLightBrightnessOut"></output><input id="statusLightBrightness" type="range" min="0" max="100"></label><label id="statusLightColorLabel">指示灯颜色<input id="statusLightColor" type="color"></label><p id="statusLightNotice" class="hint" role="status"></p>`;
  const $ = (id) => root.querySelector('#' + id);
  let state = { connected: false, caps: 0, busy: false };
  function settings() {
    return (getConfig().statusLight ??= defaultStatusLight());
  }
  function render() {
    const s = settings();
    $('statusLightMode').value = s.mode;
    $('statusLightBrightness').value = s.brightness;
    $('statusLightBrightnessOut').textContent = s.brightness + '%';
    $('statusLightColor').value =
      '#' + s.color.map((n) => n.toString(16).padStart(2, '0')).join('');
    $('statusLightColorLabel').hidden = s.mode === 0 || Boolean(getConfig().layers?.indicator);
    $('statusLightColor').dataset.fixedDisabled = String(s.mode === 0);
    $('statusLightMode').disabled = state.busy || Boolean(getConfig().layers?.indicator);
    $('statusLightBrightness').disabled = state.busy;
    $('statusLightColor').disabled = state.busy || s.mode === 0;
    $('statusLightNotice').textContent = getConfig().layers?.indicator
      ? '当前指示灯颜色跟随配置层，在「按键 → 配置层」中修改；此处亮度仍有效。'
      : state.connected && !(state.caps & STATUS_LIGHT_CAPABILITY)
        ? '指示灯设置从 1.5 起支持；升级至 1.6 还可使用电脑断连或挂起熄灯。'
        : s.brightness === 0
          ? '亮度为 0 时日常指示灯关闭；手动配对仍保留蓝色闪烁。'
          : s.mode === 0
            ? 'USB 为青色、蓝牙为紫色；1.6 在未连接时熄灭，旧版本为暗红色。亮度可单独调节。'
            : '连接有效时显示所选颜色；配对时仍以蓝色闪烁，使用同一亮度设置。';
  }
  $('statusLightMode').onchange = () => {
    settings().mode = Number($('statusLightMode').value);
    changed();
    render();
  };
  $('statusLightBrightness').oninput = () => {
    settings().brightness = Number($('statusLightBrightness').value);
    changed();
    render();
  };
  $('statusLightColor').oninput = () => {
    settings().color = $('statusLightColor')
      .value.match(/\w\w/g)
      .map((n) => parseInt(n, 16));
    changed();
  };
  render();
  return {
    render,
    setState(value) {
      state = { ...state, ...value };
      render();
    },
  };
}
