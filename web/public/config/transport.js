import { settleSavedTuning } from './haptic-tuning.js';
import { SIZE, SERVICE, COMMAND, RESPONSE, crc32, frame, parseFrame } from './schema.js';
import { WindowsBluetooth } from './windows-bluetooth.js';
const ERR = [
  '成功',
  '帧格式错误',
  '参数超范围',
  '配置事务忙或已失效；请重新连接，或等待 30 秒后重试',
  'CRC校验失败',
  '设备拒绝此配置',
  '设备存储或外设错误',
  '设备暂不支持',
];
export class DeviceLink extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.kind = null;
    this.seq = 0;
    this.pending = null;
    this.queue = Promise.resolve();
    this.generation = 0;
  }
  get connected() {
    return Boolean(this.device && this.kind);
  }
  async connect(kind, { device: authorizedDevice } = {}) {
    if (this.connected) await this.disconnect();
    if (!globalThis.isSecureContext) throw new Error('请通过 HTTPS 或 localhost 打开配置页');
    this.generation++;
    this.kind = kind;
    try {
      if (kind === 'usb') {
        if (!navigator.hid) throw new Error('此浏览器不支持 WebHID，请用桌面版 Chrome / Edge');
        const ds = authorizedDevice
          ? [authorizedDevice]
          : await navigator.hid.requestDevice({ filters: [{ usagePage: 0xff60, usage: 0x61 }] });
        if (!ds.length) throw new Error('未选择设备');
        this.device = ds[0];
        await this.device.open();
        this.device.addEventListener(
          'inputreport',
          (this.onUSB = (e) => {
            if (e.reportId === 0x20)
              this.receive(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
          }),
        );
        navigator.hid.addEventListener(
          'disconnect',
          (this.onLost = (e) => {
            if (e.device === this.device) this.lost();
          }),
        );
      } else if (kind === 'windows-ble') {
        this.device = new WindowsBluetooth();
        await this.device.connect();
        this.device.addEventListener('disconnect', (this.onLost = () => this.lost()));
        const bridge = this.device;
        this.tx = {
          writeValueWithResponse: async (bytes) => this.receive(await bridge.send(bytes)),
        };
      } else {
        if (!navigator.bluetooth)
          throw new Error('此浏览器不支持网页蓝牙配置，请用桌面版 Chrome / Edge');
        try {
          // Separate filter objects are alternatives. Name matching also discovers
          // C5 when the platform does not expose its advertised custom service UUID.
          this.device =
            authorizedDevice ||
            (await navigator.bluetooth.requestDevice({
              filters: [{ services: [SERVICE] }, { name: 'C5 Rev.E' }],
              optionalServices: [SERVICE],
            }));
        } catch (e) {
          if (e.name === 'NotFoundError')
            throw new Error(
              '未选择蓝牙设备。若列表找不到 C5 Rev.E，请在正常开机时长按 BOOT 约 2 秒，看到蓝色闪烁后再搜索；不要按 RESET。',
            );
          throw e;
        }
        this.device.addEventListener('gattserverdisconnected', (this.onLost = () => this.lost()));
        const s = await this.device.gatt.connect();
        let service;
        try {
          service = await s.getPrimaryService(SERVICE);
        } catch (e) {
          if (e.name === 'NotFoundError')
            throw new Error(
              '已找到蓝牙设备，但没有 C5 网页配置服务。请确认选择 C5 Rev.E，且已刷入支持网页配置的固件。',
            );
          throw e;
        }
        this.tx = await service.getCharacteristic(COMMAND);
        this.rx = await service.getCharacteristic(RESPONSE);
        this.rx.addEventListener(
          'characteristicvaluechanged',
          (this.onBLE = (e) =>
            this.receive(
              new Uint8Array(
                e.target.value.buffer,
                e.target.value.byteOffset,
                e.target.value.byteLength,
              ),
            )),
        );
        await this.rx.startNotifications();
      }
      this.kind = kind;
      const info = await this.request(1);
      if (
        info.length < 12 ||
        new TextDecoder().decode(info.slice(0, 4)) !== 'C5RE' ||
        info[4] !== 1 ||
        (info[6] | (info[7] << 8)) !== SIZE
      )
        throw new Error('连接到的设备不是兼容的 C5 Rev.E 固件');
      this.noHaptics = Boolean(
        new DataView(info.buffer, info.byteOffset, info.byteLength).getUint32(8, true) & 0x800000,
      );
      this.info = info;
      this.calibrationCapable = Boolean(
        new DataView(info.buffer, info.byteOffset, info.byteLength).getUint32(8, true) & 0x80000,
      );
      this.dispatchEvent(new Event('connect'));
      return info;
    } catch (e) {
      await this.disconnect();
      throw e;
    }
  }
  receive(bytes) {
    let r;
    try {
      r = parseFrame(bytes);
    } catch {
      return;
    }
    const p = this.pending;
    if (!p || r.seq !== p.seq || r.op !== (p.op | 0x80) || r.offset !== p.offset) return;
    clearTimeout(p.timer);
    this.pending = null;
    if (r.status) p.reject(new Error(ERR[r.status] || `设备错误 ${r.status}`));
    else p.resolve(r.payload);
  }
  request(op, payload = new Uint8Array(), offset = 0) {
    const generation = this.generation;
    const run = async () => {
      if (generation !== this.generation || !this.connected) throw new Error('设备已断开');
      const seq = (this.seq = (this.seq + 1) & 255);
      const b = frame(op, seq, payload, offset);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => {
            if (this.pending?.seq === seq) {
              this.pending = null;
              reject(new Error('设备未确认，操作结果未知；请重新读取设备配置'));
            }
          },
          op === 6 ? 8000 : 3500,
        );
        this.pending = { op, seq, offset, resolve, reject, timer };
        const send =
          this.kind === 'usb'
            ? (() => {
                const p = new Uint8Array(63);
                p.set(b);
                return this.device.sendReport(0x20, p);
              })()
            : this.tx.writeValueWithResponse(b);
        Promise.resolve(send).catch((e) => {
          if (this.pending?.seq === seq) {
            clearTimeout(timer);
            this.pending = null;
            reject(e);
          }
        });
      });
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
  async read(progress = () => {}) {
    const out = new Uint8Array(SIZE);
    for (let o = 0; o < SIZE; o += 12) {
      const n = Math.min(12, SIZE - o),
        p = await this.request(2, Uint8Array.of(n), o);
      if (p.length !== n) throw new Error('设备返回不完整配置');
      out.set(p, o);
      progress((o + n) / SIZE);
    }
    return out;
  }
  async previewHaptic(block, gain) {
    if (block.length !== 81 || !Number.isInteger(gain) || gain < 0 || gain > 100)
      throw new Error('触觉试听参数无效');
    await this.request(14, Uint8Array.of(0));
    try {
      for (let o = 0; o < 81; o += 11) {
        const chunk = block.slice(o, o + 11),
          p = new Uint8Array(chunk.length + 1);
        p[0] = 1;
        p.set(chunk, 1);
        await this.request(14, p, o);
      }
      await this.request(14, Uint8Array.of(2, gain));
    } catch (e) {
      if (this.connected) await this.request(14, Uint8Array.of(3)).catch(() => {});
      throw e;
    }
  }
  async apply(bytes, persist, progress = () => {}) {
    if (bytes.length !== SIZE) throw new Error('配置长度错误');
    const h = new Uint8Array(6),
      v = new DataView(h.buffer);
    v.setUint16(0, SIZE, true);
    v.setUint32(2, crc32(bytes), true);
    await this.request(3, h);
    try {
      for (let o = 0; o < SIZE; o += 12) {
        await this.request(4, bytes.slice(o, o + 12), o);
        progress((Math.min(o + 12, SIZE) / SIZE) * 0.85);
      }
      await this.request(5);
      progress(0.9);
      const tuningStatus = this.noHaptics ? undefined : await settleSavedTuning(this, bytes);
      if (persist) await this.request(6);
      const read = await this.read();
      if (read.some((x, i) => x !== bytes[i])) throw new Error('回读配置与写入内容不同');
      progress(1);
      return tuningStatus;
    } catch (e) {
      if (this.connected) await this.request(7).catch(() => {});
      throw e;
    }
  }
  lost() {
    this.cleanup();
    this.dispatchEvent(new Event('disconnect'));
  }
  cleanup() {
    this.generation++;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('设备连接已断开'));
      this.pending = null;
    }
    if (this.onUSB) this.device?.removeEventListener('inputreport', this.onUSB);
    if (this.kind === 'usb' && this.onLost)
      navigator.hid?.removeEventListener('disconnect', this.onLost);
    if (this.onBLE) this.rx?.removeEventListener('characteristicvaluechanged', this.onBLE);
    if (this.onLost)
      this.device?.removeEventListener(
        this.kind === 'windows-ble' ? 'disconnect' : 'gattserverdisconnected',
        this.onLost,
      );
    this.device = null;
    this.kind = null;
    this.tx = null;
    this.rx = null;
  }
  async disconnect() {
    const d = this.device,
      k = this.kind;
    this.cleanup();
    if (k === 'usb' && d?.opened) await d.close().catch(() => {});
    else if (k === 'windows-ble') await d?.disconnect().catch(() => {});
    else if (d?.gatt?.connected) d.gatt.disconnect();
    this.dispatchEvent(new Event('disconnect'));
  }
}
