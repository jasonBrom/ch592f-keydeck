// Same-origin loopback transport to Windows' existing paired C5 GATT link.
export async function windowsBluetoothStatus() {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return { available: false };
  try {
    const response = await fetch('/api/windows-ble/status', {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return { available: false };
    const status = await response.json();
    return status.available === true && typeof status.token === 'string'
      ? status
      : { available: false };
  } catch {
    return { available: false };
  }
}
export class WindowsBluetooth extends EventTarget {
  constructor() {
    super();
    this.session = null;
    this.token = null;
  }
  async post(action, body = {}, keepalive = false) {
    let response, data;
    try {
      response = await fetch('/api/windows-ble/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-C5-Token': this.token },
        body: JSON.stringify({ ...body, session: this.session }),
        keepalive,
        signal: keepalive ? undefined : AbortSignal.timeout(35000),
      });
      data = await response.json();
    } catch {
      if (this.session) {
        this.session = null;
        this.dispatchEvent(new Event('disconnect'));
      }
      throw new Error(
        '本地蓝牙服务不可用，操作结果未知。请重新启动 StartConsole.cmd、连接并读取设备配置。',
      );
    }
    if (!response.ok) {
      if (response.status === 410) {
        this.session = null;
        this.dispatchEvent(new Event('disconnect'));
      }
      if (
        action === 'frame' &&
        body.frame?.[2] >= 15 &&
        body.frame?.[2] <= 18 &&
        data.error === '无效的 C5 配置请求。'
      )
        throw new Error(
          '本地蓝牙服务仍在使用旧版命令列表。请关闭当前控制台窗口，重新运行 StartConsole.cmd，再连接设备；仅刷新网页不会重载服务。',
        );
      const error = new Error(data.error || 'Windows 蓝牙连接失败');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  async connect() {
    const status = await windowsBluetoothStatus();
    if (!status.available)
      throw new Error('请用 StartConsole.cmd 启动本地控制台，启用 Windows 蓝牙管理。');
    this.token = status.token;
    const data = await this.post('connect');
    this.session = data.session;
    this.name = data.name;
  }
  async send(frame) {
    const data = await this.post('frame', { frame: Array.from(frame) });
    return new Uint8Array(data.frame);
  }
  async disconnect(keepalive = false) {
    if (this.session) {
      try {
        await this.post('disconnect', {}, keepalive);
      } finally {
        this.session = null;
      }
    }
  }
}
