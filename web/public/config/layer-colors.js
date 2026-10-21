import { layerDefaults, validateLayers } from './layer-schema.js';

export function setLayerColor(config, index, hex) {
  if (!Number.isInteger(index) || index < 0 || index > 2 || !/^#[\da-f]{6}$/i.test(hex))
    throw new Error('配置层颜色无效');
  const layers = structuredClone(config.layers || layerDefaults());
  layers.colors[index] = hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16));
  layers.indicator = true;
  config.layers = validateLayers(layers);
}

// This previews the editing layer; the existing save/apply transaction writes
// exactly these RGB bytes to the firmware's independent status indicator.
export function layerIndicatorPreview(config, profile) {
  const settings = config.statusLight;
  return {
    color: [
      ...(config.layers?.indicator
        ? config.layers.colors[profile]
        : settings?.mode === 1
          ? settings.color
          : [20, 110, 160]),
    ],
    brightness: settings?.brightness ?? 100,
  };
}

export function mountLayerColors({ root, getConfig, changed, selectProfile }) {
  root.innerHTML = `<div class="layer-chips">${[0, 1, 2]
    .map(
      (i) =>
        `<div class="layer-chip"><label class="layer-swatch" title="修改配置 ${i + 1} 的指示灯颜色"><input type="color" aria-label="配置 ${i + 1} 的指示灯颜色" data-layer-color="${i}"></label><button type="button" data-layer-profile="${i}">配置 ${i + 1}</button></div>`,
    )
    .join('')}</div>
    <label class="layer-follow"><input type="checkbox" data-layer-follow> 指示灯跟随配置层颜色</label><small>点色块改色 · 测试或保存后在键盘生效</small>`;
  let busy = false,
    current = {};
  const colors = [...root.querySelectorAll('[data-layer-color]')];
  const profiles = [...root.querySelectorAll('[data-layer-profile]')];
  const follow = root.querySelector('[data-layer-follow]');
  for (const [i, input] of colors.entries())
    input.oninput = () => {
      setLayerColor(getConfig(), i, input.value);
      changed();
      render(current);
    };
  for (const [i, button] of profiles.entries()) button.onclick = () => selectProfile(i);
  follow.onchange = () => {
    const config = getConfig();
    config.layers ??= layerDefaults();
    config.layers.indicator = follow.checked;
    changed();
    render(current);
  };
  function render(state = current) {
    current = state;
    const config = getConfig(),
      settings = config.layers || layerDefaults();
    for (let i = 0; i < 3; i++) {
      const hex = '#' + settings.colors[i].map((v) => v.toString(16).padStart(2, '0')).join('');
      if (colors[i].value !== hex) colors[i].value = hex;
      profiles[i].parentElement.style.setProperty('--layer', hex);
      profiles[i].parentElement.classList.toggle('active', i === state.active);
      profiles[i].setAttribute('aria-pressed', String(i === state.editing));
      profiles[i].title = i === state.active ? '设备当前使用此层' : '浏览此层，不切换设备';
      colors[i].disabled = profiles[i].disabled = busy;
    }
    follow.checked = Boolean(config.layers?.indicator);
    follow.disabled = busy;
  }
  render();
  return {
    render,
    setBusy(value) {
      busy = value;
      render();
    },
  };
}
