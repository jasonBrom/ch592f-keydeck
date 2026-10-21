// Keep live input queries out of the configuration transaction queue.
// Foreground USB follows the model frame rate; slower BLE and background
// pages query less often. Always wait for the previous response before retrying.
export class StatusMonitor {
  constructor({
    link,
    onStatus,
    onError = () => {},
    visible = () => !document.hidden,
    now = () => performance.now(),
    schedule = (fn, delay) => globalThis.setTimeout(fn, delay),
    cancel = (id) => globalThis.clearTimeout(id),
  }) {
    Object.assign(this, { link, onStatus, onError, visible, now, schedule, cancel });
    this.active = false;
    this.paused = false;
    this.inFlight = false;
    this.timer = null;
    this.generation = 0;
    this.failures = 0;
  }
  interval() {
    return !this.visible() ? 1000 : this.link.kind === 'usb' ? 16 : 50;
  }
  clear() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
  start() {
    if (this.active) return;
    this.active = true;
    this.generation++;
    this.failures = 0;
    this.wake();
  }
  stop() {
    this.active = false;
    this.generation++;
    this.clear();
  }
  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    this.generation++;
    this.clear();
    if (!paused) this.wake();
  }
  wake() {
    this.clear();
    if (this.active && !this.paused && !this.inFlight && this.link.connected)
      this.timer = this.schedule(() => this.poll(), 0);
  }
  async poll() {
    this.timer = null;
    if (!this.active || this.paused || this.inFlight || !this.link.connected) return;
    this.inFlight = true;
    const generation = this.generation,
      started = this.now();
    try {
      const payload = await this.link.request(9);
      if (this.active && !this.paused && generation === this.generation) {
        this.onStatus(decodeStatus(payload));
        this.failures = 0;
      }
    } catch (error) {
      if (this.active && !this.paused && generation === this.generation) {
        this.failures = Math.min(4, this.failures + 1);
        this.onError(error);
      }
    } finally {
      this.inFlight = false;
      if (this.active && !this.paused && this.link.connected) {
        const period = this.failures
          ? Math.max(this.interval(), Math.min(2000, 250 * 2 ** (this.failures - 1)))
          : this.interval();
        const delay =
          generation !== this.generation
            ? 0
            : this.failures
              ? period
              : Math.max(0, period - (this.now() - started));
        this.timer = this.schedule(() => this.poll(), delay);
      }
    }
  }
}

export function decodeStatus(payload) {
  if (payload.length < 9) throw new Error('设备返回不完整状态');
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    flags: payload[0],
    percent: payload[1],
    profile: payload[2],
    keys: payload[3],
    millivolts: view.getUint16(4, true),
    encoder: view.getInt16(6, true),
    route: payload[8],
    usbMs: payload.length >= 12 ? payload[9] : 0,
    bleUnits: payload.length >= 12 ? view.getUint16(10, true) : 0,
  };
}
export function encoderDelta(current, previous) {
  return previous === null ? 0 : ((current - previous + 32768) & 65535) - 32768;
}

export function chargingStatusText(flags) {
  if (!Number.isInteger(flags) || flags < 0 || flags > 255) return '状态未知';
  // Rev.E exposes active-low STAT only. Neither a high STAT nor a voltage-
  // estimated 100% proves charge completion or the presence of USB power.
  return flags & 4 ? '充电中' : '未在充电';
}
