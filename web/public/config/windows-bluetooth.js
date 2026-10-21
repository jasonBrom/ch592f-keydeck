// Local discovery is silent; the official online console probes loopback only
// after the user explicitly chooses Windows paired-device management.
export function windowsBridgeBase({ interactive = false, page = globalThis.location } = {}) {
  if (['localhost', '127.0.0.1'].includes(page?.hostname)) return '';
  if (
    interactive &&
    page?.origin === 'https://jasonbrom.github.io' &&
    page?.pathname?.startsWith('/ch592f-keydeck/')
  )
    return 'http://127.0.0.1:8792';
  return null;
}

export async function windowsBluetoothStatus({ interactive = false } = {}) {
  const base = windowsBridgeBase({ interactive });
  if (base === null) return { available: false };
  try {
    const response = await fetch(base + '/api/windows-ble/status', {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      ...(base ? { mode: 'cors', targetAddressSpace: 'loopback' } : {}),
      signal: AbortSignal.timeout(interactive ? 30000 : 1500),
    });
    if (!response.ok) return { available: false };
    const status = await response.json();
    return status.available === true &&
      typeof status.token === 'string' &&
      (!base || status.bridgeVersion >= 2)
      ? status
      : {
          available: false,
          reason: status.reason || (base ? '请更新并重新启动本地桥接服务。' : ''),
        };
  } catch {
    return { available: false };
  }
}
export class WindowsBluetooth extends EventTarget {
  constructor() {
    super();
    this.session = null;
    this.token = null;
    this.base = '';
  }
  async post(action, body = {}, keepalive = false) {
    let response, data;
    try {
      response = await fetch(this.base + '/api/windows-ble/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-C5-Token': this.token },
        body: JSON.stringify({ ...body, session: this.session }),
        keepalive,
        credentials: 'omit',
        redirect: 'error',
        ...(this.base ? { mode: 'cors', targetAddressSpace: 'loopback' } : {}),
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
    this.base = windowsBridgeBase({ interactive: true });
    const status = await windowsBluetoothStatus({ interactive: true });
    if (!status.available)
      throw new Error(
        status.reason ||
          '请先运行最新版 web/StartConsole.cmd，保持服务运行，再点击「Windows 已配对」。若浏览器询问本机网络访问，请允许；也可直接打开 http://localhost:8792/ 管理。',
      );
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
