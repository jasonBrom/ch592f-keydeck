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
  { discover = connectionCandidates, onAttempt = () => {} } = {},
) {
  const candidates = await discover();
  const failures = [];
  if (['usb', 'ble'].some((kind) => candidates.filter((c) => c.kind === kind).length > 1)) {
    const error = new Error('检测到多台已授权设备，请在「连接选项」中选择目标 C5。');
    error.needsChoice = true;
    throw error;
  }
  for (const candidate of candidates) {
    onAttempt(candidate.kind);
    try {
      return await link.connect(candidate.kind, { device: candidate.device });
    } catch (error) {
      if (error.status === 409) throw error;
      failures.push(error);
    }
  }
  const error = new Error(
    failures.length
      ? failures.at(-1).message
      : '首次连接需要授权。请在「连接选项」中选择 USB 或蓝牙；下次会自动判断。',
  );
  error.needsChoice = true;
  throw error;
}
