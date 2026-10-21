import { link } from './console.js';
import { describeEnvironment } from './environment.js';

const $ = (id) => document.getElementById(id);
const environment = describeEnvironment({
  hostname: location.hostname,
  secure: isSecureContext,
  hid: Boolean(navigator.hid),
  bluetooth: Boolean(navigator.bluetooth),
});
$('environmentNotice').textContent = environment.text;
const guide = document.createElement('a');
guide.href = 'help.html';
guide.target = '_blank';
guide.rel = 'noopener';
guide.textContent = '连接帮助 ↗';
$('environmentNotice').append(guide);

$('toggleModel').onclick = () => {
  const showing = $('model').hidden;
  if (showing && !$('model').src) $('model').src = $('model').dataset.src;
  $('model').hidden = !showing;
  $('deviceStage').hidden = showing;
  $('toggleModel').setAttribute('aria-pressed', String(showing));
  $('toggleModel').textContent = showing ? '按键视图 ↙' : '3D 视图 ↗';
};

function syncVariant() {
  const motorless = link.connected && Boolean(link.noHaptics);
  $('hapticControls').disabled = motorless;
  $('noHapticsNotice').hidden = !motorless;
  const tab = document.querySelector('[data-tab="haptics"]');
  tab.textContent = motorless ? '触觉 · 未搭载' : '触觉';
}
link.addEventListener('connect', syncVariant);
link.addEventListener('disconnect', syncVariant);

// Follow native tab semantics, including keyboard-only navigation.
const tabs = [...document.querySelectorAll('.tabs > [role="tab"]')];
function syncTabs() {
  const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') || tabs[0];
  for (const tab of tabs) {
    tab.tabIndex = tab === selected ? 0 : -1;
    tab.setAttribute('aria-controls', tab.dataset.tab);
  }
}
for (const tab of tabs) {
  tab.addEventListener('click', syncTabs);
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let index = tabs.indexOf(tab);
    index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[index].click();
    tabs[index].focus();
  });
}
new MutationObserver(syncTabs).observe(document.querySelector('.tabs'), {
  subtree: true,
  attributes: true,
  attributeFilter: ['aria-selected'],
});
syncTabs();
