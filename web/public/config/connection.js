import { windowsBluetoothStatus } from './windows-bluetooth.js';
export async function connectionCandidates({
  hid = globalThis.navigator?.hid,
  bluetooth = globalThis.navigator?.bluetooth,
  nativeStatus = windowsBluetoothStatus,
} = {}) {
  const results = await Promise.allSettled([
    hid?.getDevices?.() || [],
    nativeStatus(),
    bluetooth?.getDevices?.() || [],
  ]);
  const value = (i) => (results[i].status === 'fulfilled' ? results[i].value : null);
  const usb = (value(0) || []).filter((d) =>
    d.collections?.some((c) => c.usagePage === 0xff60 && c.usage === 0x61),
  );
  const ble = (value(2) || []).filter((d) => d.name === 'C5 Rev.E');
  return [
    ...usb.map((device) => ({ kind: 'usb', device })),
    ...(value(1)?.available ? [{ kind: 'windows-ble' }] : []),
    ...ble.map((device) => ({ kind: 'ble', device })),
  ];
}
export async function autoConnect(
  link,
  {
    discover = connectionCandidates,
    onAttempt = () => {},
    interactive = false,
    bridgeStatus = windowsBluetoothStatus,
  } = {},
) {
  const candidates = await discover();
  const failures = [];
  // Probe the online loopback bridge only after a connect click, and only
  // after USB has failed. An available USB must not trigger a network prompt.
  for (const kind of ['usb', 'windows-ble', 'ble']) {
    const choices = candidates.filter((candidate) => candidate.kind === kind);
    if (kind === 'windows-ble' && !choices.length && interactive) {
      onAttempt('detect-windows-ble');
      try {
        const status = await bridgeStatus({ interactive: true });
        if (status.available) choices.push({ kind });
      } catch {
        /* Continue to browser-granted Bluetooth or manual selection. */
      }
    }
    if (choices.length > 1) {
      const error = new Error('检测到多台已授权设备，请在「手动选择」中选择目标 C5。');
      error.needsChoice = true;
      throw error;
    }
    for (const candidate of choices) {
      onAttempt(candidate.kind);
      try {
        return await link.connect(candidate.kind, { device: candidate.device });
      } catch (error) {
        if (error.status === 409) throw error;
        failures.push(error);
      }
    }
  }
  const error = new Error(
    failures.length
      ? failures.at(-1).message
      : '首次连接需要授权，或设备尚未就绪。请在「手动选择」中选择 USB 或浏览器蓝牙；使用 Windows 已配对蓝牙时，请先启动本地服务。',
  );
  error.needsChoice = true;
  throw error;
}
