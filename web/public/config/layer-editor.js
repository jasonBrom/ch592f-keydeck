import { LAYER_CAP, layerDefaults, validateLayers } from './layer-schema.js';
const names = ['按键 01', '按键 02', '按键 03', '按键 04', '按键 05', '旋钮按压'];
const color = (c) => '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
export function mountLayerEditor({ root, getConfig, changed, refresh = () => {} }) {
  let busy = false,
    caps = 0,
    connected = false;
  root.innerHTML = `<details class="settings-card"><summary>配置层 · RGB 指示与切换组合</summary><p class="hint">三层各自保存一套按键映射。浏览编辑层不会切换设备正在使用的层。</p>
 <label class="check-label"><input id="layerIndicator" type="checkbox"> 用独立 RGB 指示灯显示当前层</label><div class="three">${[0, 1, 2].map((i) => `<label>配置 ${i + 1}<input id="layerColor${i}" type="color"></label>`).join('')}</div>
 <label class="check-label"><input id="layerShortcuts" type="checkbox"> 启用 Fn 组合切层</label><label>专用 Fn 输入<select id="layerFn">${names.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select></label>
 <p class="hint">启用时会将所选输入在三层都设为专用 Fn，替换它原来的功能；关闭后该输入设为不执行动作，可重新绑定。先按住 Fn，再按目标组合；组合操作不发送普通按键，切层后松开再操作。</p>
 ${[0, 1, 2].map((i) => `<fieldset class="chord-row"><legend>切到配置 ${i + 1}</legend>${names.map((n, k) => `<label><input id="layerChord${i}_${k}" type="checkbox">${n}</label>`).join('')}</fieldset>`).join('')}
 <button id="useProfile">将此层设为启动层</button><p class="hint">选择启动层后仍需底部保存；更换 Fn 会重置三组组合，可继续自定义。</p><p id="layerNotice" class="hint" role="status"></p></details>`;
  const $ = (id) => root.querySelector('#' + id);
  function render() {
    const s = getConfig().layers || layerDefaults();
    $('layerIndicator').checked = Boolean(getConfig().layers?.indicator);
    $('layerShortcuts').checked = Boolean(getConfig().layers?.shortcuts);
    $('layerFn').value = s.fn;
    for (let i = 0; i < 3; i++) {
      $('layerColor' + i).value = color(s.colors[i]);
      for (let k = 0; k < 6; k++) {
        $(`layerChord${i}_${k}`).checked = Boolean(s.chords[i] & (1 << k));
        $(`layerChord${i}_${k}`).disabled = busy || k === s.fn;
      }
    }
    root.querySelectorAll('input,select').forEach((e) => {
      if (!e.id.startsWith('layerChord')) e.disabled = busy;
    });
    $('layerNotice').textContent =
      connected && !(caps & LAYER_CAP)
        ? 'RGB 配置层与 Fn 组合需要固件 1.13。'
        : s.shortcuts
          ? '仅 Fn 组合切层；普通按键不会自动切层。已有「切换配置层」单键绑定仍会生效，可在按键映射中检查。'
          : '可先选择颜色；启用后保存到设备。';
  }
  function update() {
    try {
      const c = getConfig(),
        s = structuredClone(c.layers || layerDefaults()),
        oldFn = s.fn;
      s.indicator = $('layerIndicator').checked;
      s.shortcuts = $('layerShortcuts').checked;
      s.fn = Number($('layerFn').value);
      for (let i = 0; i < 3; i++) {
        s.colors[i] = $('layerColor' + i)
          .value.slice(1)
          .match(/../g)
          .map((x) => parseInt(x, 16));
        let mask = 0;
        for (let k = 0; k < 6; k++) if ($(`layerChord${i}_${k}`).checked) mask |= 1 << k;
        const others = mask & ~(1 << oldFn) & ~(1 << s.fn);
        s.chords[i] = others ? others | (1 << s.fn) : 0;
      }
      if (s.fn !== oldFn)
        s.chords = names
          .map((_, i) => i)
          .filter((i) => i !== s.fn)
          .slice(0, 3)
          .map((i) => (1 << s.fn) | (1 << i));
      validateLayers(s);
      if (c.layers?.shortcuts && !s.shortcuts)
        for (const p of c.profiles)
          if (p[oldFn].type === 7) p[oldFn] = { type: 0, modifiers: 0, value: 0 };
      if (s.fn !== oldFn)
        for (const p of c.profiles)
          if (p[oldFn].type === 7) p[oldFn] = { type: 0, modifiers: 0, value: 0 };
      if (s.shortcuts) for (const p of c.profiles) p[s.fn] = { type: 7, modifiers: 0, value: 0 };
      c.layers = s;
      changed();
      refresh();
      render();
    } catch (e) {
      $('layerNotice').textContent = e.message;
    }
  }
  root.querySelectorAll('input,select').forEach((e) => (e.onchange = update));
  render();
  return {
    render,
    setState(s) {
      ({ busy, caps, connected } = s);
      render();
    },
  };
}
