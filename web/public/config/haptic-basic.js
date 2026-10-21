import { hapticDefaults } from './haptic-schema.js';
import { tuningDefaults } from './haptic-tuning.js';
export function setFeedback(config, index, id, minor) {
  if (index !== 2 && id === 126 && minor !== null && minor < 13)
    throw Error('保留标准短脉冲需要固件 1.13，请先升级固件');
  if (!config.advancedHaptic?.enabled) {
    if (minor !== null && minor < 13)
      throw Error('此简化设置需要固件 1.13；旧固件可在高级效果中编辑');
    config.advancedHaptic ??= hapticDefaults();
    config.advancedHaptic.enabled = true;
    config.advancedHaptic.events = [126, 126, 126, 0, 0, 0];
  }
  config.advancedHaptic.events[index] = id;
}
export function mountHapticBasic({ root, getConfig, changed, test }) {
  let minor = null,
    busy = false,
    connected = false;
  root.innerHTML = `<div class="section-title"><h3>日常触觉</h3><span class="pill">先在这里调整</span></div><p id="hapticSource" class="source-note">连接后显示当前控制来源。</p>
 <div class="settings-card"><label>强度 <output id="hapticOut"></output><input id="haptic" type="range" min="0" max="100"></label>
 <div class="two"><label>旋转反馈<select id="simpleTurn"><option value="126">短促脉冲</option><option value="4">锐利点击</option><option value="24">轻刻度</option><option value="0">关闭</option><option value="custom" disabled>自定义效果（高级）</option></select></label><label>短脉冲时长<select id="simplePulse"><option value="18">18 ms · 更短</option><option value="24">24 ms · 标准</option><option value="36">36 ms · 更明显</option><option value="custom" disabled>自定义（高级）</option></select></label></div>
 <details><summary>按键与旋钮按压</summary><div class="two"><label>按键反馈<select id="simpleKey"></select></label><label>旋钮按压<select id="simplePress"></select></label></div></details>
 <button id="testHaptic" data-device>试听已应用的脉冲</button><p class="hint">修改先留在草稿，底部「测试」生效，「保存」断电保留。自定义波形和马达参数在下方高级设置中。</p></div>`;
  const $ = (id) => root.querySelector('#' + id);
  for (const id of ['simpleKey', 'simplePress']) $(id).innerHTML = $('simpleTurn').innerHTML;
  function render() {
    const c = getConfig(),
      h = c.advancedHaptic;
    for (const [id, index] of [
      ['simpleKey', 0],
      ['simplePress', 1],
      ['simpleTurn', 2],
    ]) {
      const value = h?.enabled ? h.events[index] : 126;
      $(id).value = [0, 4, 24, 126].includes(value) ? String(value) : 'custom';
      $(id).disabled = busy;
    }
    const pulse = h?.tuning?.pulseMs || 24;
    $('simplePulse').value = [18, 24, 36].includes(pulse) ? String(pulse) : 'custom';
    $('simplePulse').disabled = busy;
    $('haptic').value = c.haptic;
    $('hapticOut').textContent = c.haptic + '%';
    $('testHaptic').disabled = busy || !connected;
  }
  for (const [id, index] of [
    ['simpleKey', 0],
    ['simplePress', 1],
    ['simpleTurn', 2],
  ])
    $(id).onchange = () => {
      try {
        setFeedback(getConfig(), index, Number($(id).value), minor);
        changed();
      } catch (e) {
        $('hapticSource').textContent = e.message;
      }
      render();
    };
  $('simplePulse').onchange = () => {
    const c = getConfig();
    if (minor !== null && minor < 12) {
      $('hapticSource').textContent = '可调脉冲需要固件 1.12 或以上';
      render();
      return;
    }
    c.advancedHaptic ??= hapticDefaults();
    c.advancedHaptic.tuning = {
      ...tuningDefaults(),
      ...c.advancedHaptic.tuning,
      pulseMs: Number($('simplePulse').value),
    };
    changed();
    render();
  };
  $('testHaptic').onclick = test;
  render();
  return {
    render,
    setState(s) {
      ({ busy, connected, minor } = s);
      render();
    },
    status(flags, supported) {
      $('hapticSource').textContent = !connected
        ? '连接后显示当前控制来源。'
        : !supported
          ? '设备固件尚不能报告控制来源；Windows 轮盘可能接管旋转反馈。'
          : flags & 8
            ? '旋转反馈由 Windows 控制；按键反馈仍使用设备设置。'
            : '旋转反馈由设备配置控制。';
    },
  };
}
