import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { StatusMonitor, chargingStatusText } from '../public/config/status-monitor.js';
import { defaults, encode, decode } from '../public/config/schema.js';
import { effectiveTransitions } from '../public/config/layer-schema.js';
import { encoderDelta } from '../public/config/status-monitor.js';

const source = readFileSync(new URL('../public/config/console.js', import.meta.url), 'utf8');
function helper(name) {
  const token = 'function ' + name + '(',
    at = source.indexOf(token);
  assert(at >= 0);
  const start = source.slice(at - 6, at) === 'async ' ? at - 6 : at;
  let depth = 0,
    quote = null,
    escaped = false;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw Error('unclosed helper ' + name);
}
function fixture() {
  const nodes = new Map(),
    messages = [];
  const node = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        disabled: false,
        hidden: false,
        textContent: '',
        dataset: {},
        style: {},
        hasAttribute: (name) =>
          name === 'data-device' && ['read', 'apply', 'save', 'activateRates'].includes(id),
      });
    return nodes.get(id);
  };
  const editable = ['brightness', 'encoderMode', 'profile', 'bindingType', 'mappingButton'].map(
      node,
    ),
    device = ['read', 'apply', 'save'].map(node);
  node('model').contentWindow = { postMessage: (message) => messages.push(message) };
  let connected = false,
    encoder = 0,
    keys = 0;
  const link = {
    kind: 'usb',
    get connected() {
      return connected;
    },
    async connect(kind = 'usb') {
      this.kind = kind;
      connected = true;
      context.statusMonitor.start();
      context.setControls();
      return Uint8Array.of(67, 53, 82, 69, 1, 1, 0, 4, 255, 63, 0, 0);
    },
    read: async () => encode(defaults()),
    request: async () => {
      const p = Uint8Array.of(1, 73, 0, keys, 0, 0, 0, 0, 1, 1, 0, 0);
      new DataView(p.buffer).setInt16(6, encoder, true);
      return p;
    },
  };
  const context = vm.createContext({
    $: node,
    document: {
      querySelectorAll: (selector) => (selector === '[data-device]' ? device : editable),
    },
    location: { origin: 'http://localhost:8792' },
    link,
    config: defaults(),
    deviceConfig: null,
    busy: false,
    editingProfile: 0,
    profileActivationRequested: false,
    firmwareMinor: 1,
    pairedBLEAvailable: false,
    recorder: null,
    dirty: false,
    caps: 0,
    actualUSB: 0,
    expectedReconnect: false,
    macroSlot: 0,
    lastEncoder: null,
    encoderPosition: 0,
    lastKeys: -1,
    inputButtons: [],
    decode,
    autoConnect: (device) => device.connect('usb'),
    encoderDelta,
    chargingStatusText,
    effectiveTransitions,
    renderEditingContext() {},
    hapticBasic: { setState() {}, status() {} },
    hapticEditor: { setState() {} },
    calibrationEditor: { setState() {} },
    layerEditor: { setState() {} },
    layerColorsEditor: { setBusy() {} },
    statusLightEditor: { setState() {} },
    clone: (x) => JSON.parse(JSON.stringify(x)),
    stopMacroRecording() {},
    render() {},
  });
  vm.runInContext(
    [
      'setMessage',
      'modelSend',
      'setText',
      'updateDeviceStatus',
      'setControls',
      'operation',
      'readDevice',
      'setInfo',
      'connect',
    ]
      .map(helper)
      .join('\n'),
    context,
  );
  context.statusMonitor = new StatusMonitor({
    link,
    onStatus: context.updateDeviceStatus,
    visible: () => true,
  });
  return {
    context,
    node,
    messages,
    editable,
    device,
    input: (e, k) => {
      encoder = e;
      keys = k;
    },
    disconnect: () => {
      connected = false;
    },
  };
}

test('real connect/operation/control helpers unlock the editor and deliver live input after config read', async () => {
  const f = fixture();
  try {
    const connecting = f.context.connect('usb');
    assert(f.editable.every((e) => e.disabled));
    await connecting;
    assert.equal(f.context.busy, false);
    assert(f.editable.every((e) => !e.disabled));
    assert(f.device.every((e) => !e.disabled));
    assert.equal(f.node('progress').hidden, true);
    assert.equal(f.context.statusMonitor.paused, false);
    assert.equal(f.node('message').textContent, '已连接并读取设备配置。');
    f.input(10, 0);
    f.context.statusMonitor.clear();
    await f.context.statusMonitor.poll();
    f.input(11, 33);
    f.context.statusMonitor.clear();
    await f.context.statusMonitor.poll();
    const status = f.messages.filter((m) => m.type === 'status').at(-1);
    assert.equal(status.keys, 33);
    assert.equal(status.encoderPosition, 1);
    assert.equal(status.connected, true);
    // Save/read errors must unlock the same controls and resume input polling.
    await f.context.operation(async () => {
      throw Error('read failure');
    });
    assert(f.editable.every((e) => !e.disabled));
    assert.equal(f.context.statusMonitor.paused, false);
    assert.equal(f.node('message').textContent, 'read failure');
    f.disconnect();
    f.context.setControls();
    assert(f.editable.every((e) => !e.disabled));
    assert(f.device.every((e) => e.disabled));
  } finally {
    f.context.statusMonitor.stop();
  }
});
test('each automatic or manual connection reads once and displays device settings instead of the offline draft', async () => {
  for (const kind of ['auto', 'usb', 'ble', 'windows-ble']) {
    const f = fixture();
    let reads = 0,
      renders = 0,
      writes = 0;
    const device = defaults();
    device.profile = 2;
    device.brightness = 73;
    device.profiles[2][0] = { type: 1, modifiers: 2, value: 28 };
    const expected = decode(encode(device));
    f.context.config.brightness = 5;
    f.context.dirty = true;
    f.context.editingProfile = 1;
    f.context.profileActivationRequested = true;
    f.context.render = () => renders++;
    f.context.link.read = async (progress) => {
      reads++;
      progress(0.5);
      return encode(device);
    };
    f.context.link.apply = async () => writes++;
    try {
      // A second click while the first connection is busy must not queue a read.
      await Promise.all([f.context.connect(kind), f.context.connect(kind)]);
      assert.equal(reads, 1, kind);
      assert.equal(renders, 1, kind);
      assert.equal(writes, 0, kind);
      assert.deepEqual(f.context.config, expected, kind);
      assert.deepEqual(f.context.deviceConfig, expected, kind);
      assert.equal(f.context.editingProfile, 2, kind);
      assert.equal(f.context.profileActivationRequested, false, kind);
      assert.equal(f.context.dirty, false, kind);
      assert.equal(f.node('draftStatus').textContent, '与设备一致', kind);
      assert.equal(f.node('message').textContent, '已连接并读取设备配置。', kind);
    } finally {
      f.context.statusMonitor.stop();
    }
  }
});

test('a failed initial read keeps the current draft and reports failure without retrying or writing', async () => {
  const f = fixture();
  let reads = 0;
  f.context.config.brightness = 9;
  f.context.dirty = true;
  f.context.link.read = async () => {
    reads++;
    throw Error('设备配置读取失败');
  };
  f.context.link.apply = () => assert.fail('Connecting must never write settings');
  try {
    await f.context.connect('windows-ble');
    assert.equal(reads, 1);
    assert.equal(f.context.config.brightness, 9);
    assert.equal(f.context.dirty, true);
    assert.equal(f.context.deviceConfig, null);
    assert.equal(f.node('message').textContent, '设备配置读取失败');
    assert.equal(f.context.busy, false);
    assert.equal(f.node('progress').hidden, true);
    assert.equal(f.node('read').disabled, false);
  } finally {
    f.context.statusMonitor.stop();
  }
});

test('editing another layer does not select it for the device and live layer changes preserve the editing view', () => {
  const f = fixture();
  try {
    vm.runInContext(helper('binding'), f.context);
    f.context.selected = 0;
    f.context.editingProfile = 1;
    f.context.config.profiles[1][0] = { type: 1, modifiers: 0, value: 4 };
    assert.equal(f.context.binding().value, 4);
    assert.equal(f.context.config.profile, 0);
    f.context.deviceConfig = defaults();
    const status = {
      flags: 1,
      percent: 70,
      profile: 2,
      keys: 0,
      millivolts: 3900,
      encoder: 0,
      route: 1,
      usbMs: 1,
      bleUnits: 0,
    };
    f.context.updateDeviceStatus(status);
    assert.equal(f.context.editingProfile, 1);
    assert.equal(f.context.config.profile, 2);
    assert.equal(f.context.deviceConfig.profile, 2);
    f.context.profileActivationRequested = true;
    f.context.updateDeviceStatus({ ...status, profile: 0 });
    assert.equal(f.context.config.profile, 2);
    assert.equal(f.context.editingProfile, 1);
  } finally {
    f.context.statusMonitor.stop();
  }
});
test('render synchronizes the rotary mode selector after reads and preset changes', () => {
  const f = fixture();
  try {
    Object.assign(f.context, {
      renderDial() {},
      renderBinding() {},
      renderMacros() {},
      syncPreview() {},
    });
    for (const name of [
      'hapticEditor',
      'hapticBasic',
      'calibrationEditor',
      'layerEditor',
      'statusLightEditor',
    ])
      f.context[name].render = () => {};
    vm.runInContext(helper('render'), f.context);
    for (const mode of [2, 0, 1, 3]) {
      f.context.config.encoderMode = mode;
      f.node('encoderMode').value = 99;
      f.context.render();
      assert.equal(f.node('encoderMode').value, mode);
    }
  } finally {
    f.context.statusMonitor.stop();
  }
});

test('charging display uses STAT without mistaking Bluetooth, USB or 100 percent for a full-charge signal', () => {
  const f = fixture();
  try {
    for (const percent of [6, 100, 255])
      for (const flags of [0, 1, 2, 3, 4, 5, 6, 7]) {
        f.context.updateDeviceStatus({
          flags,
          percent,
          profile: 0,
          keys: 0,
          millivolts: 3530,
          encoder: 0,
          route: 2,
          usbMs: 0,
          bleUnits: 6,
        });
        assert.equal(f.node('chargeStatus').textContent, flags & 4 ? '充电中' : '未在充电');
      }
    assert.equal(chargingStatusText(undefined), '状态未知');
  } finally {
    f.context.statusMonitor.stop();
  }
});
