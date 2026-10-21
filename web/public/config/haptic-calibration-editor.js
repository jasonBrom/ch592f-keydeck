import {
  TUNING_CAP,
  tuningDefaults,
  validateTuning,
  encodeTuning,
  ratedCode,
  readCalibration,
  runCalibration,
} from './haptic-tuning.js';
import { hapticDefaults, encodeHaptic } from './haptic-schema.js';

export function mountCalibrationEditor({
  root,
  link,
  getConfig,
  changed,
  operation,
  download,
  save,
  refreshHaptic = () => {},
}) {
  let draft = tuningDefaults(),
    snapshot = null,
    connected = false,
    caps = 0,
    busy = false,
    running = false,
    cancelled = false,
    savedKey = null;
  const records = [],
    $ = (id) => root.querySelector('#' + id);
  const fields = [
    ['pulseMs', '旋转脉冲时长（ms）', 4, 120, 1],
    ['ratedMv', '额定电压（mVrms）', 100, 900, 10],
    ['clampCode', '峰值钳位代码（每级 21.22 mV）', 7, 66, 1],
    [
      'driveTime',
      'DRIVE_TIME 初值',
      [
        [23, '23 · 约 178.6 Hz'],
        [24, '24 · 约 172.4 Hz'],
        [25, '25 · 约 166.7 Hz'],
        [26, '26 · 约 161.3 Hz'],
      ],
    ],
    [
      'brakeFactor',
      '反馈制动倍率',
      [
        [0, '1×'],
        [1, '2×'],
        [2, '3×'],
        [3, '4× · 默认'],
        [4, '6×'],
        [5, '8×'],
        [6, '16×'],
        [7, '关闭制动'],
      ],
    ],
    [
      'loopGain',
      '反馈增益',
      [
        [0, '低'],
        [1, '中 · 默认'],
        [2, '高'],
        [3, '很高'],
      ],
    ],
    [
      'sampleTime',
      '反电动势采样时间',
      [
        [0, '150 µs'],
        [1, '200 µs'],
        [2, '250 µs'],
        [3, '300 µs · 默认'],
      ],
    ],
    [
      'blanking',
      '采样消隐时间',
      Array.from({ length: 16 }, (_, i) => [
        i,
        `${i} · ${[15, 25, 50, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 235, 260, 285][i]} µs`,
      ]),
    ],
    [
      'idiss',
      '电流消散时间',
      Array.from({ length: 16 }, (_, i) => [
        i,
        `${i} · ${[15, 25, 50, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 235, 260, 285][i]} µs`,
      ]),
    ],
    [
      'calTime',
      '自动校准时间',
      [
        [0, '150–350 ms'],
        [1, '250–450 ms'],
        [2, '500–700 ms'],
        [3, '1000–1200 ms'],
      ],
    ],
    [
      'zeroCross',
      '过零检测时间',
      [
        [0, '100 µs'],
        [1, '200 µs'],
        [2, '300 µs'],
        [3, '390 µs'],
      ],
    ],
    ['startupBoost', '起振增强', 'bool'],
    ['brakeStabilizer', '制动稳定器', 'bool'],
    ['twicePerCycle', '每周期更新两次', 'bool'],
  ];
  const fieldHTML = ([key, label, choices, max, step]) =>
    `<label>${label}${choices === 'bool' ? `<input id="cal_${key}" type="checkbox">` : Array.isArray(choices) ? `<select id="cal_${key}">${choices.map(([v, text]) => `<option value="${v}">${text}</option>`).join('')}</select>` : `<input id="cal_${key}" type="number" min="${choices}" max="${max}" step="${step}">`}</label>`;
  root.innerHTML = `<div class="rule"></div><div class="section-title"><h3>旋钮触觉调校</h3><span class="mono">DRV2605L · 闭环 LRA</span></div>
 <p class="hint">每一格应是短促点击。先调脉冲和间隔，再调校准与制动；80 ms 持续震动容易掩盖格感。校准通过后，点击底部「保存到设备」即可断电保留。</p>
 <p id="calCompatibility" class="hint" role="status"></p><div id="calStatus" class="cal-status" aria-live="polite">连接后读取真实芯片状态。</div>
 <div class="haptic-actions"><button id="calRead" data-cal-device>读取驱动参数到草稿</button><button id="calAuto" data-cal-device>按当前参数自动校准</button><button id="calDiagnose" data-cal-device>检测马达连接</button><button id="calUndo" data-cal-device>撤销最近参数</button><button id="calStop" data-cal-device>停止／取消</button></div>
 <div class="cal-fields">${fields.slice(0, 3).map(fieldHTML).join('')}</div><p id="calVoltage" class="hint"></p>
 <details><summary>展开制动、共振与采样参数</summary><div class="cal-fields">${fields.slice(3).map(fieldHTML).join('')}</div><p class="hint">DRIVE_TIME 是共振初值；闭环仍自动跟踪。制动和环路增益过高可能回弹或不稳定。只开放 AAC0809 的电压范围和闭环参数；补偿、BEMF 结果由芯片产生，不允许手填。切换采样时间会重新计算额定电压寄存器。</p></details>
 <div class="haptic-actions"><button id="calSearch" data-cal-device>自动排查 4 档频率初值</button></div>
 <p id="calPersistence" class="hint" role="status"></p><p class="hint">校准通过会同步到页面草稿，仍需底部保存；只有「试用」时重启会恢复已保存参数。保存的是脉冲、电压、制动等设置；补偿、BEMF 和增益档在每次上电时由芯片重新校准产生。</p>
 <p class="hint">自动排查只寻找芯片能够通过校准的一组参数，无法自动评判清脆度。校准结果会同步草稿，再用底部「试用」或「保存」。日常旋转反馈在上方调整；快速旋转会合并触觉，输入格数保留。Windows 接管轮盘触觉时仍遵守短脉冲及防连续嗡振限制。</p>
 <details><summary>装壳／桌面传递对比与导出</summary><p class="hint">马达贴在 PCB 上时，振动要经过 PCB、编码器和转轴到达手指。固定同一参数和测试波形，依次比较裸板、装壳拿起、硬桌面、鼠标垫；对比过程中不重新校准。若拿起后恢复，优先改善支撑隔振；若按住编码器附近 PCB 强而旋钮弱，重点检查 PCB 到轴的传递。</p>
 <div class="cal-fields"><label>测试环境<select id="calEnvironment"><option>裸 PCB</option><option>装壳拿起</option><option selected>装壳硬桌面</option><option>装壳鼠标垫</option></select></label><label>旋钮振感（主观 1–5）<input id="calStrength" type="number" min="1" max="5" value="3"></label><label>清脆度（主观 1–5）<input id="calCrispness" type="number" min="1" max="5" value="3"></label><label>备注<input id="calNotes" maxlength="200" placeholder="胶层、脚垫、螺丝状态等"></label></div>
 <div class="haptic-actions"><button id="calCompareTest" data-cal-device>播放相同短点击 #4</button><button id="calRecord">记录此环境</button><button id="calExport">导出参数与对比记录</button><button id="calImport">导入参数草稿</button><input id="calFile" type="file" accept=".json,application/json" hidden></div><div id="calRecords" class="hint"></div>
 <p class="hint">频率与供电只显示上次播放时芯片寄存器的换算值，不能当作加速度或锁定证明。没有加速度传感器，环境记录使用你的主观评分。</p></details>
 <p id="calNotice" class="hint" role="status"></p><details><summary>原始寄存器与 TI 依据</summary><pre id="calRaw" class="cal-raw">尚未读取</pre><a href="https://www.ti.com/lit/ds/symlink/drv2605l.pdf" target="_blank" rel="noopener">DRV2605L 数据手册</a> · <a href="https://www.ti.com/lit/pdf/slou402" target="_blank" rel="noopener">TI 马达安装与测量指南 §5–6</a></details>`;
  const notice = (text, error = false) => {
    $('calNotice').textContent = text;
    $('calNotice').classList.toggle('haptic-error', error);
  };
  const localAction = (fn) => () => {
    try {
      fn();
    } catch (e) {
      notice(e.message, true);
    }
  };
  function fill() {
    for (const [key, , kind] of fields)
      if (kind === 'bool') $('cal_' + key).checked = draft[key];
      else $('cal_' + key).value = draft[key];
    voltage();
  }
  function readForm() {
    const t = {};
    for (const [key, , kind] of fields)
      t[key] = kind === 'bool' ? $('cal_' + key).checked : Number($('cal_' + key).value);
    return validateTuning(t);
  }
  const tuningKey = (t) => Array.from(encodeTuning(t)).join(',');
  function verifiedForm() {
    try {
      return (
        snapshot?.phase === 3 &&
        !snapshot.fault &&
        !snapshot.busy &&
        tuningKey(readForm()) === tuningKey(snapshot.tuning)
      );
    } catch {
      return false;
    }
  }
  function voltage() {
    try {
      draft = readForm();
      $('calVoltage').textContent =
        `计算额定代码 0x${ratedCode(draft).toString(16).padStart(2, '0')}；峰值钳位 ${(draft.clampCode * 21.22).toFixed(2)} mV。900 mVrms／1.0 Vrms 正弦上限内，按 160–180 Hz 公差保守计算。`;
    } catch (e) {
      $('calVoltage').textContent = e.message;
    }
    controls();
  }
  function show(s) {
    snapshot = s;
    const phases = ['启动', '写入参数', '自动校准', '就绪', '故障', '连接诊断'],
      results = [
        '未运行',
        '运行中',
        '通过',
        '失败，已恢复',
        '失败，已停止',
        '已撤销／取消',
        '超时，已恢复',
      ];
    $('calStatus').textContent =
      `${phases[s.phase] || '未知'} · ${results[s.result] || '未知结果'} · 故障 ${s.fault} · 补偿 ${s.comp} / BEMF ${s.bemf} / 增益档 ${s.bemfGain}${s.frequency ? ` · 上次周期换算 ${s.frequency.toFixed(1)} Hz` : ''}`;
    $('calRaw').textContent = JSON.stringify(
      {
        generation: s.generation,
        status: s.chipStatus,
        lastJobStatus: s.lastJobStatus,
        comp: s.comp,
        bemf: s.bemf,
        bemfGain: s.bemfGain,
        registers: Object.fromEntries(
          ['16', '17', '1a', '1b', '1c', '1d', '1e', '1f', '20'].map((r, i) => [
            '0x' + r,
            '0x' + s.registers[i].toString(16).padStart(2, '0'),
          ]),
        ),
        lastPlaybackSupplyMv: s.supplyMv,
        lastPlaybackFrequency: s.frequency,
        tuning: s.tuning,
      },
      null,
      2,
    );
    controls();
  }
  function controls() {
    const supported = Boolean(caps & TUNING_CAP);
    $('calCompatibility').textContent = !connected
      ? '可离线准备参数，连接固件 1.12 后校准。'
      : supported
        ? '支持断电保存：校准只先试用，点击底部「保存到设备」才会写入设备。'
        : '当前固件不支持高级校准，请升级 1.12。';
    root
      .querySelectorAll('button,input,select')
      .forEach(
        (e) =>
          (e.disabled =
            busy || running || (e.hasAttribute('data-cal-device') && (!connected || !supported))),
      );
    $('calStop').disabled = !connected || !supported || (!running && busy);
    $('calUndo').disabled = busy || running || !connected || !supported || !snapshot?.canUndo;
    $('calPersistence').textContent = !snapshot
      ? '参数保留在草稿；底部试用／保存时会应用参数并自动校准。'
      : !verifiedForm()
        ? '草稿与驱动不同，或驱动尚未就绪；可自动校准，底部试用／保存也会应用参数。'
        : savedKey === tuningKey(snapshot.tuning)
          ? '设备已确认保存并回读一致；参数断电保留，上电后按此设置重新自动校准。'
          : '驱动已就绪；「通过」表示校准成功，当前为试调状态，请点底部保存以断电保留。';
  }
  async function task(fn) {
    return operation(async (progress) => {
      try {
        await fn(progress);
      } catch (e) {
        notice(e.message, true);
        throw e;
      }
    });
  }
  async function calibrate(t, action = 0) {
    running = true;
    cancelled = false;
    controls();
    try {
      const s = await runCalibration(link, t, { action, onStatus: show });
      if (cancelled) throw Error('已请求取消，请重新读取确认');
      show(s);
      if (action === 0) {
        draft = structuredClone(s.tuning);
        fill();
        adopt();
        notice('校准通过，参数已同步草稿；底部保存后断电保留。');
      } else notice('马达连接诊断通过；参数草稿保持原设置。');
      return s;
    } finally {
      running = false;
      controls();
    }
  }
  for (const [key] of fields)
    $('cal_' + key).onchange = () => {
      voltage();
      try {
        const c = getConfig();
        c.advancedHaptic ??= hapticDefaults();
        c.advancedHaptic.tuning = structuredClone(readForm());
        changed();
      } catch (e) {
        notice(e.message, true);
      }
    };
  $('calRead').onclick = () =>
    task(async () => {
      show(await readCalibration(link));
      draft = structuredClone(snapshot.tuning);
      fill();
      adopt();
      notice('已将驱动实际参数读入草稿；底部保存后断电保留。');
    });
  $('calAuto').onclick = () => task(() => calibrate(readForm()));
  $('calDiagnose').onclick = () => task(() => calibrate(null, 1));
  $('calUndo').onclick = () =>
    task(async () => {
      await link.request(18, Uint8Array.of(3));
      show(await readCalibration(link));
      draft = structuredClone(snapshot.tuning);
      fill();
      adopt();
      notice('已恢复最近一次调校前参数，并同步草稿；底部保存后才会持久化。');
    });
  $('calStop').onclick = async () => {
    cancelled = true;
    try {
      await link.request(18, Uint8Array.of(2));
      show(await readCalibration(link));
      if (snapshot.phase === 3 && !snapshot.fault) {
        draft = structuredClone(snapshot.tuning);
        fill();
        adopt();
      }
      notice('已请求停止，并读取恢复后的驱动状态。');
    } catch (e) {
      notice(e.message, true);
    }
  };
  $('calSearch').onclick = () =>
    task(async () => {
      const base = readForm();
      running = true;
      cancelled = false;
      controls();
      let lastError;
      try {
        for (const driveTime of [
          base.driveTime,
          ...[24, 25, 23, 26].filter((x) => x !== base.driveTime),
        ]) {
          if (cancelled) break;
          notice(`正在检测 DRIVE_TIME=${driveTime}，只判断校准能否通过…`);
          try {
            const s = await runCalibration(link, { ...base, driveTime }, { onStatus: show });
            if (cancelled) break;
            show(s);
            draft = structuredClone(s.tuning);
            fill();
            adopt();
            notice(
              `DRIVE_TIME=${driveTime} 校准通过。仍需手动比较旋钮格感，没有自动判定“最佳触感”。`,
            );
            return;
          } catch (e) {
            lastError = e;
            const s = await readCalibration(link);
            show(s);
            if (s.lastJobStatus & 3 || s.fault) break;
          }
        }
        throw cancelled
          ? Error('已取消自动排查')
          : lastError || Error('自动排查未通过，未写入 Flash');
      } finally {
        running = false;
        controls();
      }
    });
  function adopt() {
    const c = getConfig();
    c.advancedHaptic ??= hapticDefaults();
    c.advancedHaptic.tuning = structuredClone(snapshot.tuning);
    changed();
    refreshHaptic();
  }
  $('calCompareTest').onclick = () =>
    task(async () => {
      const h = hapticDefaults();
      h.mode = 0;
      h.sequence = [4];
      await link.previewHaptic(encodeHaptic(h), 100);
      notice('相同 #4 短点击已播放；四种环境保持同一参数，按旋钮时以手指感受作比较。');
    });
  $('calRecord').onclick = () => {
    const strength = Number($('calStrength').value),
      crispness = Number($('calCrispness').value);
    if (![strength, crispness].every((x) => Number.isInteger(x) && x >= 1 && x <= 5)) {
      notice('评分需要 1–5 的整数', true);
      return;
    }
    records.push({
      environment: $('calEnvironment').value,
      strength,
      crispness,
      notes: $('calNotes').value,
      tuning: snapshot?.tuning || readForm(),
      generation: snapshot?.generation ?? null,
      source: 'user_rating',
      waveform: 'ROM #4 / 100%',
    });
    $('calRecords').textContent = records
      .map((r, i) => `${i + 1}. ${r.environment}：振感 ${r.strength}/5，清脆 ${r.crispness}/5`)
      .join('；');
    notice('对比记录只在本页内存，可导出保存。');
  };
  $('calExport').onclick = localAction(() =>
    download('C5-rotary-calibration.json', {
      format: 'C5-haptic-calibration',
      version: 1,
      tuning: readForm(),
      snapshot,
      records,
    }),
  );
  $('calImport').onclick = () => $('calFile').click();
  $('calFile').onchange = async () => {
    const file = $('calFile').files?.[0];
    if (!file) return;
    try {
      if (file.size > 65536) throw Error('文件过大');
      const data = JSON.parse(await file.text());
      if (data.format !== 'C5-haptic-calibration' || data.version !== 1)
        throw Error('调校文件格式不支持');
      draft = structuredClone(validateTuning(data.tuning));
      fill();
      adopt();
      notice('已导入参数草稿，尚未写入驱动；文件内的校准结果不会直接写入芯片。');
    } catch (e) {
      notice(e.message, true);
    } finally {
      $('calFile').value = '';
    }
  };
  fill();
  controls();
  return {
    applied(status) {
      show(status);
      draft = structuredClone(status.tuning);
      fill();
    },
    render() {
      if (!running) {
        draft = structuredClone(getConfig().advancedHaptic?.tuning || tuningDefaults());
        fill();
      }
    },
    validateDraft() {
      readForm();
    },
    saved(tuning = tuningDefaults()) {
      savedKey = tuningKey(tuning);
      controls();
    },
    setState(state) {
      const newConnection = state.connected && !connected;
      connected = state.connected;
      caps = state.caps;
      busy = state.busy;
      if (newConnection) {
        snapshot = null;
        savedKey = null;
        const t = getConfig().advancedHaptic?.tuning;
        if (t) {
          draft = structuredClone(t);
          fill();
        }
      }
      if (!connected) {
        snapshot = null;
        savedKey = null;
        cancelled = true;
      }
      controls();
    },
  };
}
