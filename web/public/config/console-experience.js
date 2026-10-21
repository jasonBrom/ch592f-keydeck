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

const connectionMenu = $('connectionOptions');
const connectionSummary = connectionMenu.querySelector('summary');
function closeConnectionMenu(restoreFocus = false) {
  connectionMenu.open = false;
  if (restoreFocus) connectionSummary.focus();
}
$('closeConnectionOptions').onclick = () => closeConnectionMenu(true);
document.addEventListener('pointerdown', (event) => {
  if (!connectionMenu.contains(event.target)) closeConnectionMenu();
  const more = $('moreSettings');
  if (!more.contains(event.target)) more.open = false;
});
function expandPreview(expanded) {
  document.body.classList.toggle('preview-expanded', expanded);
  $('expandPreview').setAttribute('aria-pressed', String(expanded));
  $('expandPreview').textContent = expanded ? '返回设置 ↙' : '放大预览 ↗';
}
$('expandPreview').onclick = () =>
  expandPreview(!document.body.classList.contains('preview-expanded'));
for (const button of document.querySelectorAll('[data-model-view]'))
  button.onclick = () =>
    $('model').contentWindow?.postMessage(
      {
        source: 'c5-console',
        type: 'view',
        action: button.dataset.modelView,
      },
      location.origin,
    );
function escapeWorkspace() {
  if (connectionMenu.open) closeConnectionMenu(true);
  $('moreSettings').open = false;
  if (document.body.classList.contains('preview-expanded')) {
    expandPreview(false);
    $('expandPreview').focus();
  }
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') escapeWorkspace();
});
window.addEventListener('message', (event) => {
  if (
    event.source !== $('model').contentWindow ||
    event.origin !== location.origin ||
    event.data?.source !== 'c5-model'
  )
    return;
  if (event.data.type === 'escape') escapeWorkspace();
});

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
