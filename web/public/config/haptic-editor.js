import {
  effects,
  effectName,
  eventNames,
  hapticDefaults,
  validateHaptic,
  encodeHaptic,
  HAPTIC_CAP,
  envelopePresets,
} from './haptic-schema.js';
export function mountHapticEditor({ root, getConfig, changed, preview, stop, download }) {
  let selected = 4,
    tab = 'library',
    filter = '',
    category = '',
    connected = false,
    caps = 0,
    busy = false;
  const $ = (id) => root.querySelector('#' + id);
  const current = () => getConfig().advancedHaptic || hapticDefaults();
  root.innerHTML = `<div class="section-title"><h3>触觉工作室</h3><span class="mono">DRV2605L · LRA</span></div>
 <p class="hint">浏览芯片内置效果，组合节奏，或直接编辑幅度与时长。试听当前草稿后，再临时应用或保存到设备。</p>
 <label class="haptic-switch"><input type="checkbox" id="hapticEnabled"> 使用高级触觉与事件绑定</label>
 <p class="hint">关闭高级模式仍使用标准脉冲反馈；1.12 默认 24 ms 并支持独立调校；1.11 为 80 ms，更早为 18 ms；增益 0% 关闭本地触觉。</p>
 <p class="hint" id="hapticCompatibility" role="status"></p>
 <div class="haptic-tabs" role="tablist" aria-label="触觉编辑方式">
 <button role="tab" data-haptic-tab="library" aria-controls="hapticLibrary" aria-selected="true">效果库</button>
 <button role="tab" data-haptic-tab="sequence" aria-controls="hapticSequence" aria-selected="false">效果序列</button>
 <button role="tab" data-haptic-tab="envelope" aria-controls="hapticEnvelope" aria-selected="false">RTP 曲线</button>
 <button role="tab" data-haptic-tab="events" aria-controls="hapticEvents" aria-selected="false">事件绑定</button></div>
 <section id="hapticLibrary" role="tabpanel"><div class="two"><label>查找效果<input id="hapticSearch" type="search" placeholder="名称或 ID，例如刻度、26"></label><label>类型<select id="hapticCategory"><option value="">全部 123 个效果</option>${['点击', '蜂鸣', '提醒', '脉冲', '低鸣', '渐变'].map((x) => `<option>${x}</option>`).join('')}</select></label></div>
 <div id="hapticEffectList" class="haptic-effect-list" role="group" aria-label="芯片内置效果"></div>
 <div class="haptic-selection"><strong id="hapticSelectedName"></strong><div class="haptic-actions"><button id="hapticPreviewROM" data-device data-advanced>试听此效果</button><button id="hapticAddEffect">加入序列</button></div></div>
 <p class="hint">内置效果的强度由效果 ID 决定。ROM 波形不能改写；序列图只表示播放顺序。<a href="https://www.ti.com/lit/ds/symlink/drv2605l.pdf" target="_blank" rel="noopener">TI 效果表 ↗</a></p></section>
 <section id="hapticSequence" role="tabpanel" hidden><div class="section-title"><h4>最多 8 槽，间隔也占一槽</h4><span id="hapticSequenceCount" class="mono"></span></div><div id="hapticSequenceTimeline" class="haptic-sequence-timeline" aria-label="效果序列顺序"></div><div id="hapticSequenceRows"></div>
 <div class="haptic-actions"><button id="hapticAddROM">＋ 内置效果</button><button id="hapticAddWait">＋ 间隔</button><button id="hapticPreviewSequence" data-device data-advanced>试听序列</button></div>
 <label>持续段时间偏移（ms，5 ms 步进）<input id="hapticSustain" type="number" min="-100" max="100" step="5"></label><p class="hint">偏移应用于 ROM 效果的正向持续段。闭环模式由芯片自动管理起振与制动；实际效果需试听。</p></section>
 <section id="hapticEnvelope" role="tabpanel" hidden><div class="section-title"><h4>自定义幅度曲线</h4><span id="hapticEnvelopeCount" class="mono"></span></div><div class="haptic-actions" id="hapticPresets"></div>
 <div class="haptic-curve-wrap"><svg id="hapticCurve" role="img" aria-label="RTP 幅度指令曲线"></svg></div><p class="hint">上下拖动曲线中的分段可调整幅度；表格可精确修改时长。0% 是静默。显示的是幅度指令，实际马达加速度取决于校准和安装。</p>
 <div id="hapticEnvelopeRows"></div><div class="haptic-actions"><button id="hapticAddSegment">＋ 分段</button><button id="hapticPreviewEnvelope" data-device data-advanced>试听曲线</button></div></section>
 <section id="hapticEvents" role="tabpanel" hidden><h4>操作对应的触觉</h4><div id="hapticEventRows"></div><label>旋钮触觉最小间隔（ms）<input id="hapticTurnInterval" type="number" min="20" max="500" step="1"></label><p class="hint">间隔内的旋钮触觉会合并，正在播放时不排队；输入格数仍正常发送。Windows 接管轮盘自动触觉时，旋转使用系统设置。</p><p class="hint">「单次宏完成」表示固件执行完所有步骤；宏取消或循环的每一轮不会触发。保存成功、软件数值边界需要额外的设备或应用事件。</p></section>
 <div class="rule"></div><div><label>最长单次播放（ms）<input id="hapticTimeout" type="number" min="100" max="15000" step="100"></label></div>
 <div class="haptic-actions"><button id="hapticStop" data-device data-advanced>■ 停止振动</button><button id="hapticExport">导出触觉</button><button id="hapticImport">导入触觉</button><input id="hapticImportFile" type="file" accept=".json,application/json" hidden><button id="hapticLegacy">恢复传统触觉</button></div><p class="hint">仅调旋转请使用下方「旋钮触觉调校」；80 ms 长振方案用于对比，容易掩盖短促格感。曲线总时长上限 5000 ms。试听只上传到 RAM，不改按键配置；保存后自定义曲线由设备本地播放，关闭网页仍有效。增益为 0 时本地触觉关闭；ROM 的非零强度请通过效果 ID 选择。</p>`;
  function make(tag, text, props = {}) {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    Object.assign(e, props);
    return e;
  }
  function selectOptions(select, entries, value) {
    select.replaceChildren(
      ...entries.map(([id, label]) => make('option', label, { value: String(id) })),
    );
    select.value = String(value);
  }
  const effectEntries = () => effects.map((e) => [e.id, `#${e.id} ${e.label}`]);
  function modify(fn) {
    const h = structuredClone(current());
    try {
      fn(h);
      validateHaptic(h);
      getConfig().advancedHaptic = h;
      changed();
      render();
    } catch (e) {
      render();
      notice(e.message, true);
    }
  }
  function notice(text, error = false) {
    $('hapticCompatibility').textContent = text;
    $('hapticCompatibility').classList.toggle('haptic-error', error);
  }
  function showTab(name) {
    tab = name;
    for (const b of root.querySelectorAll('[data-haptic-tab]'))
      b.setAttribute('aria-selected', String(b.dataset.hapticTab === tab));
    for (const [name, id] of [
      ['library', 'hapticLibrary'],
      ['sequence', 'hapticSequence'],
      ['envelope', 'hapticEnvelope'],
      ['events', 'hapticEvents'],
    ])
      $(id).hidden = name !== tab;
    if (tab === 'envelope') drawCurve();
  }
  function renderLibrary() {
    const entries = effects.filter(
      (e) =>
        (!category || e.category === category) &&
        (!filter || `${e.id} ${e.label}`.toLowerCase().includes(filter.toLowerCase())),
    );
    $('hapticEffectList').replaceChildren(
      ...entries.map((e) => {
        const button = make('button');
        button.type = 'button';
        button.dataset.effectId = e.id;
        button.setAttribute('aria-pressed', String(e.id === selected));
        button.append(
          make('span', String(e.id).padStart(3, '0'), { className: 'mono' }),
          make('span', e.label),
        );
        button.onclick = () => {
          selected = e.id;
          renderLibrary();
        };
        return button;
      }),
    );
    if (!entries.length)
      $('hapticEffectList').append(make('p', '没有匹配的效果。', { className: 'hint' }));
    $('hapticSelectedName').textContent = `#${selected} ${effectName(selected)}`;
    $('hapticAddEffect').disabled = busy || current().sequence.length >= 8;
  }
  function rowActions(list, index, onEdit, minimum, maximum) {
    const actions = make('div', '', { className: 'step-actions' });
    for (const [text, label, fn, disabled] of [
      [
        '↑',
        '上移',
        (a) => {
          [a[index - 1], a[index]] = [a[index], a[index - 1]];
        },
        index === 0,
      ],
      [
        '↓',
        '下移',
        (a) => {
          [a[index + 1], a[index]] = [a[index], a[index + 1]];
        },
        index === list.length - 1,
      ],
      [
        '＋',
        '复制',
        (a) => a.splice(index + 1, 0, structuredClone(a[index])),
        list.length >= maximum,
      ],
      ['×', '删除', (a) => a.splice(index, 1), list.length <= minimum],
    ]) {
      const button = make('button', text, { type: 'button', disabled });
      button.setAttribute('aria-label', `${label}第 ${index + 1} 项`);
      button.dataset.fixedDisabled = String(disabled);
      button.onclick = () => onEdit(fn);
      actions.append(button);
    }
    return actions;
  }
  function renderSequence() {
    const h = current();
    $('hapticSequenceCount').textContent = `${h.sequence.length} / 8 槽`;
    $('hapticSequenceRows').replaceChildren();
    $('hapticSequenceTimeline').replaceChildren();
    h.sequence.forEach((id, index) => {
      $('hapticSequenceTimeline').append(
        make('div', id >= 129 ? `${index + 1} · ${(id & 127) * 10} ms` : `${index + 1} · #${id}`, {
          className: id >= 129 ? 'haptic-sequence-slot wait' : 'haptic-sequence-slot',
        }),
      );
      const row = make('div', '', { className: 'haptic-row' }),
        type = make('select'),
        value = make(id >= 129 ? 'input' : 'select');
      type.setAttribute('aria-label', `第 ${index + 1} 槽类型`);
      selectOptions(
        type,
        [
          [0, '内置效果'],
          [1, '间隔'],
        ],
        id >= 129 ? 1 : 0,
      );
      type.onchange = () =>
        modify((h) => (h.sequence[index] = Number(type.value) ? 131 : selected));
      value.setAttribute('aria-label', `第 ${index + 1} 槽${id >= 129 ? '间隔（ms）' : '效果'}`);
      if (id >= 129) {
        value.type = 'number';
        value.min = 10;
        value.max = 1270;
        value.step = 10;
        value.value = (id & 127) * 10;
        value.onchange = () =>
          modify((h) => {
            const ms = Number(value.value);
            if (ms % 10 || ms < 10 || ms > 1270) throw Error('ROM 间隔需要 10–1270 ms，10 ms 步进');
            h.sequence[index] = 128 + ms / 10;
          });
      } else {
        selectOptions(value, effectEntries(), id);
        value.onchange = () => modify((h) => (h.sequence[index] = Number(value.value)));
      }
      row.append(
        type,
        value,
        rowActions(h.sequence, index, (fn) => modify((h) => fn(h.sequence)), 1, 8),
      );
      $('hapticSequenceRows').append(row);
    });
    for (const id of ['hapticAddROM', 'hapticAddWait', 'hapticAddEffect']) {
      $(id).disabled = h.sequence.length >= 8;
      $(id).dataset.fixedDisabled = String(h.sequence.length >= 8);
    }
  }
  function renderEnvelope() {
    const h = current(),
      total = h.envelope.reduce((n, s) => n + s.duration, 0);
    $('hapticEnvelopeCount').textContent = `${h.envelope.length} / 16 段 · ${total} ms`;
    $('hapticEnvelopeRows').replaceChildren();
    h.envelope.forEach((step, index) => {
      const row = make('div', '', { className: 'haptic-row envelope' }),
        ampLabel = make('label', `${index + 1} · 幅度 (%)`),
        durationLabel = make('label', '时长 (ms)'),
        amp = make('input'),
        duration = make('input');
      Object.assign(amp, { type: 'number', min: 0, max: 100, step: 1, value: step.amplitude });
      Object.assign(duration, { type: 'number', min: 4, max: 5000, step: 1, value: step.duration });
      amp.onchange = () => modify((h) => (h.envelope[index].amplitude = Number(amp.value)));
      duration.onchange = () =>
        modify((h) => (h.envelope[index].duration = Number(duration.value)));
      ampLabel.append(amp);
      durationLabel.append(duration);
      row.append(
        ampLabel,
        durationLabel,
        rowActions(h.envelope, index, (fn) => modify((h) => fn(h.envelope)), 1, 16),
      );
      $('hapticEnvelopeRows').append(row);
    });
    $('hapticAddSegment').disabled = h.envelope.length >= 16;
    $('hapticAddSegment').dataset.fixedDisabled = String(h.envelope.length >= 16);
    drawCurve();
  }
  function drawCurve() {
    if (tab !== 'envelope') return;
    const svg = $('hapticCurve'),
      width = svg.parentElement.clientWidth;
    if (!width) return;
    const height = 196,
      left = 42,
      right = width - 12,
      top = 14,
      bottom = 152,
      h = current(),
      total = h.envelope.reduce((n, s) => n + s.duration, 0),
      sx = (t) => left + ((right - left) * t) / total,
      sy = (a) => bottom - ((bottom - top) * a) / 100;
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('height', height);
    const append = (tag, attrs, text) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      if (text) node.textContent = text;
      svg.append(node);
      return node;
    };
    append('title', {}, 'RTP 分段幅度指令，结束时回到零');
    for (const a of [0, 50, 100]) {
      append('line', { x1: left, x2: right, y1: sy(a), y2: sy(a), class: 'haptic-grid' });
      append('text', { x: left - 8, y: sy(a) + 4, 'text-anchor': 'end' }, String(a));
    }
    let t = 0,
      points = `M${left},${bottom}`;
    h.envelope.forEach((s, index) => {
      points += ` L${sx(t)},${sy(s.amplitude)} L${sx(t + s.duration)},${sy(s.amplitude)}`;
      append('rect', {
        x: sx(t),
        y: top,
        width: Math.max(1, sx(t + s.duration) - sx(t)),
        height: bottom - top,
        fill: 'transparent',
        'data-segment': index,
        class: 'haptic-drag-segment',
      });
      t += s.duration;
    });
    points += ` L${right},${bottom}`;
    append('path', { d: points, class: 'haptic-wave', fill: 'none', 'pointer-events': 'none' });
    const ticks = width < 400 ? 3 : 5;
    for (let i = 0; i < ticks; i++)
      append(
        'text',
        {
          x: sx((total * i) / (ticks - 1)),
          y: bottom + 20,
          'text-anchor': i === 0 ? 'start' : i === ticks - 1 ? 'end' : 'middle',
        },
        String(Math.round((total * i) / (ticks - 1))),
      );
    append(
      'text',
      { x: (left + right) / 2, y: height - 3, 'text-anchor': 'middle' },
      '时间 (ms) · 幅度 (%)',
    );
  }
  function renderEvents() {
    const h = current();
    $('hapticEventRows').replaceChildren(
      ...eventNames.map((name, i) => {
        const label = make('label', name),
          select = make('select');
        selectOptions(
          select,
          [
            [0, '关闭'],
            [124, '当前效果序列'],
            [125, '当前 RTP 曲线'],
            ...[[126, '标准短脉冲 · 非旋转需 1.13']],
            ...effectEntries(),
          ],
          h.events[i],
        );
        select.onchange = () => modify((h) => (h.events[i] = Number(select.value)));
        label.append(select);
        return label;
      }),
    );
  }
  function setState(state) {
    connected = state.connected;
    caps = state.caps;
    busy = state.busy;
    const supported = Boolean(caps & HAPTIC_CAP);
    root.querySelectorAll('input,select,button').forEach((control) => {
      if (!control.hasAttribute('data-device'))
        control.disabled = busy || control.dataset.fixedDisabled === 'true';
    });
    root.querySelectorAll('[data-advanced]').forEach((button) => {
      button.disabled = !connected || !supported || busy;
      button.dataset.fixedDisabled = String(connected && !supported);
    });
    if (!connected) notice('离线可编辑；连接支持触觉工作室的固件后可试听。');
    else if (!supported) notice('当前固件只支持传统脉冲。高级试听与保存需要升级触觉工作室固件。');
    else
      notice(
        current().enabled
          ? '高级触觉已启用；操作按事件绑定播放，试听播放当前草稿。'
          : '高级模式未启用，应用后使用标准脉冲反馈；试听仍可使用当前草稿。',
      );
  }
  function render() {
    const h = current();
    $('hapticEnabled').checked = Boolean(getConfig().advancedHaptic?.enabled);
    $('hapticSustain').value = h.sustain;
    $('hapticTurnInterval').value = h.turnInterval;
    $('hapticTimeout').value = h.timeout;
    renderLibrary();
    renderSequence();
    renderEnvelope();
    renderEvents();
    setState({ connected, caps, busy });
  }
  async function audition(mode, sequence) {
    const h = structuredClone(current());
    h.mode = mode;
    if (sequence) h.sequence = sequence;
    await preview(encodeHaptic(h), getConfig().haptic);
  }
  for (const button of root.querySelectorAll('[data-haptic-tab]'))
    button.onclick = () => showTab(button.dataset.hapticTab);
  $('hapticSearch').oninput = () => {
    filter = $('hapticSearch').value.trim();
    renderLibrary();
  };
  $('hapticCategory').onchange = () => {
    category = $('hapticCategory').value;
    renderLibrary();
  };
  $('hapticEnabled').onchange = () => modify((h) => (h.enabled = $('hapticEnabled').checked));
  $('hapticAddEffect').onclick = () => {
    modify((h) => {
      h.mode = 0;
      h.sequence.push(selected);
    });
    showTab('sequence');
  };
  $('hapticAddROM').onclick = () =>
    modify((h) => {
      h.mode = 0;
      h.sequence.push(selected);
    });
  $('hapticAddWait').onclick = () =>
    modify((h) => {
      h.mode = 0;
      h.sequence.push(131);
    });
  $('hapticAddSegment').onclick = () =>
    modify((h) => {
      h.mode = 1;
      h.envelope.push({ amplitude: 0, duration: 20 });
    });
  for (const [id, key] of [
    ['hapticSustain', 'sustain'],
    ['hapticTurnInterval', 'turnInterval'],
    ['hapticTimeout', 'timeout'],
  ])
    $(id).onchange = () => modify((h) => (h[key] = Number($(id).value)));
  $('hapticPreviewROM').onclick = () => audition(0, [selected]);
  $('hapticPreviewSequence').onclick = () => audition(0);
  $('hapticPreviewEnvelope').onclick = () => audition(1);
  $('hapticStop').onclick = stop;
  $('hapticPresets').replaceChildren(
    ...Object.entries(envelopePresets).map(([name, steps]) => {
      const b = make('button', name);
      b.onclick = () =>
        modify((h) => {
          h.mode = 1;
          h.envelope = structuredClone(steps);
        });
      return b;
    }),
  );
  $('hapticExport').onclick = () =>
    download('C5-haptic.json', {
      format: 'C5-haptic',
      version: 1,
      gain: getConfig().haptic,
      haptic: current(),
    });
  $('hapticImport').onclick = () => $('hapticImportFile').click();
  $('hapticImportFile').onchange = async () => {
    const input = $('hapticImportFile'),
      file = input.files[0];
    if (!file) return;
    try {
      if (file.size > 16384) throw Error('触觉文件超过 16 KiB');
      const data = JSON.parse(await file.text());
      if (data.format !== 'C5-haptic' || data.version !== 1) throw Error('不支持此触觉文件格式');
      validateHaptic(data.haptic);
      if (!data.haptic || !Number.isInteger(data.gain) || data.gain < 0 || data.gain > 100)
        throw Error('触觉文件增益或效果无效');
      getConfig().advancedHaptic = structuredClone(data.haptic);
      getConfig().haptic = data.gain;
      changed();
      render();
      showTab(data.haptic.mode ? 'envelope' : 'sequence');
    } catch (e) {
      notice(e.message, true);
    } finally {
      input.value = '';
    }
  };
  $('hapticLegacy').onclick = () => {
    delete getConfig().advancedHaptic;
    changed();
    render();
  };
  let drag = null;
  $('hapticCurve').addEventListener('pointerdown', (event) => {
    if (busy) return;
    const mark = event.target.closest('[data-segment]');
    if (!mark) return;
    drag = Number(mark.dataset.segment);
    $('hapticCurve').setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  $('hapticCurve').addEventListener('pointermove', (event) => {
    if (drag === null) return;
    const svg = $('hapticCurve'),
      bounds = svg.getBoundingClientRect(),
      amplitude = Math.max(
        0,
        Math.min(100, Math.round(((152 - (event.clientY - bounds.top)) / 138) * 100)),
      ),
      h = structuredClone(current());
    h.envelope[drag].amplitude = amplitude;
    h.mode = 1;
    getConfig().advancedHaptic = h;
    drawCurve();
  });
  const endDrag = () => {
    if (drag === null) return;
    drag = null;
    changed();
    render();
  };
  $('hapticCurve').addEventListener('pointerup', endDrag);
  $('hapticCurve').addEventListener('pointercancel', endDrag);
  new ResizeObserver(drawCurve).observe($('hapticCurve').parentElement);
  render();
  return { render, setState };
}
