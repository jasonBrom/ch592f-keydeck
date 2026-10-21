// A bounded, pure event recorder. It always reserves space to release every held input.
export class MacroRecorder {
  constructor({ limit = 16, timing = true, fixedDelay = 50 } = {}) {
    this.limit = limit;
    this.timing = timing;
    this.fixedDelay = fixedDelay;
    this.steps = [];
    this.held = new Map();
    this.lastTime = null;
    this.active = true;
    this.reason = '';
  }
  append(step, time) {
    if (this.steps.length && this.lastTime !== null)
      this.steps.at(-1).delay = this.timing
        ? Math.max(0, Math.min(10000, Math.round(time - this.lastTime)))
        : this.fixedDelay;
    this.steps.push({ ...step, delay: 0 });
    this.lastTime = time;
  }
  input(kind, value, pressed, time, mods = 0) {
    if (!this.active) return false;
    const id = kind + ':' + value;
    if (pressed) {
      if (this.held.has(id)) return true;
      if (this.steps.length + this.held.size + 2 > this.limit) {
        this.finish(time, '已到 16 步上限，已自动补全释放');
        return false;
      } // Explicit modifier steps retain left/right identity and release timing.
      const explicitModifiers = [...this.held.values()].filter(
        (s) => s.type === 1 && s.value >= 224 && s.value <= 231,
      );
      if (kind === 'key' && value < 224)
        for (const modifier of explicitModifiers) {
          const family = (modifier.value - 224) % 4;
          mods &= ~((1 << family) | (1 << (family + 4)));
        }
      const s = { type: kind === 'mouse' ? 5 : 1, value, modifiers: mods };
      this.held.set(id, s);
      this.append(s, time);
    } else {
      const s = this.held.get(id);
      if (!s) return true;
      this.append({ ...s, type: kind === 'mouse' ? 6 : 2 }, time);
      this.held.delete(id);
    }
    return true;
  }
  finish(time, reason = '录制已结束') {
    if (!this.active) return this.steps;
    for (const s of this.held.values()) this.append({ ...s, type: s.type === 5 ? 6 : 2 }, time);
    this.held.clear();
    this.active = false;
    this.reason = reason;
    return this.steps;
  }
}
export function macroSummary(steps) {
  const held = new Set();
  let mouseHeld = 0,
    warning = '';
  for (const s of steps) {
    const id = s.value + ':' + s.modifiers;
    if (s.type === 1) held.add(id);
    if (s.type === 2) {
      if (!held.has(id)) warning = '包含没有对应按下的释放步骤';
      held.delete(id);
    }
    if (s.type === 5) mouseHeld |= s.value;
    if (s.type === 6) {
      if ((mouseHeld & s.value) !== s.value) warning = '包含没有对应按下的释放步骤';
      mouseHeld &= ~s.value;
    }
  }
  if (held.size || mouseHeld) warning = '包含未配对释放；固件将在每轮结束时释放宏按键';
  return { duration: steps.reduce((n, s) => n + s.delay, 0), warning };
}
