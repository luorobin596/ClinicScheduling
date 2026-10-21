'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {argumentsFor, readJSON, writeJSON, readRuns} = require('./support/expanded-io.cjs');
const {stats, metrics} = require('./support/expanded-statistics.cjs');
const {STAFF} = require('./support/expanded-fixtures.cjs');
const mean = values => stats(values)?.mean ?? null;
const number = value => value === null || value === undefined ? 'N/A' : value.toFixed(2);
const average = values => number(mean(values));
const percentage = values => {
  const value = mean(values);
  return value === null ? 'N/A' : `${(value * 100).toFixed(2)}%`;
};
const METRICS = {
  involuntarySingle: '非自願單節差距（次）',
  attainmentPercentagePoints: '工時達成率差距（百分點）',
  weeklyACWorst: '各週 AC 人員差距中的最大值（次）',
  weeklyBCABWorst: '各週 BC／AB 差距評分值'
};
const READING_GUIDE = [
  '本報告只呈現通過最終驗證的交付班表（final），不呈現初步排班、修補階段或新舊版本比較。每個月份／情境／休假模式分開統計，公平性分母為該列成功樣本 n。', '',
  '「非自願單節差距」先在每張月班表內取五位員工的非自願單節次數最大值減最小值，再跨成功樣本平均；不是單節總量，也不是每人的平均次數。個人指定半天的單節排除，小兒班形成的非自願單節納入。工時達成率差距同理，單位為百分點。', '',
  '「每位員工的最終月平均」為各人的實際工時、應排工時、達成率及單節次數。達成率先逐組算個人實際工時／應排工時，再平均比率；不是平均工時相除。零分母排除，沒有有效值顯示 N/A。', '',
  '「每人每週」的 AC 為平均次數。C／早班只計週一至五營業日，包含骨科與小兒；C 包含 AC、BC、單 C。早班指 AB、單 A、單 B，每日算一次，排除 AC 的 A 與 BC 的 B。', '',
  '完整平日週：C 目標為 min(3，原始意願與固定小兒班允許的 C 天數)；早班目標為 min(原始允許早班天數，max(0，可上班日數－C 目標))。逐組算實際／目標後平均，零目標 N/A；部分樣本有分母時標示有效 n，比例可超過 100%。', '',
  '月初／月底或國定假日造成診所當週營業平日不足五天時，C／早班改呈現實際平均次數；個人請假不會把完整週變成短週。週六不計入 C／早班，另列最終 AB／單 A／單 B／未排班平均次數。週六休診日不計；未排班含指定休假與自動輪空。', '',
  '跨次平均接近不表示每張班表都公平，需搭配同張班表內的人員差距。無成功樣本時不計公平性，顯示 N/A，不把失敗當作零次納入。', ''
];
function weeklyCell(rows, kind) {
  if (!rows.length) return 'N/A';
  if (rows[0].shortWeek) return `${average(rows.map(w => w[kind + 'Actual']))} 次`;
  const values = rows.map(w => w[kind + 'Rate']);
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return 'N/A';
  return `${percentage(valid)}${valid.length === values.length ? '' : `（n=${valid.length}/${values.length}）`}`;
}
function monthlyTable(runs, ids, extra = null) {
  const lines = extra === null ? [
    '| 員工 | 實際工時 | 應排工時 | 工時達成率 | 非自願單節次數 | 自願單節次數 |',
    '|---|---:|---:|---:|---:|---:|'
  ] : [
    '| 員工 | 額外整週休假 | n | 實際工時 | 應排工時 | 工時達成率 | 非自願單節次數 | 自願單節次數 |',
    '|---|---|---:|---:|---:|---:|---:|---:|'
  ];
  for (const id of ids) {
    const selected = extra === null ? runs : runs.filter(run => run.scenario.weekly.some(w => w.id === id && w.extraWholeWeek) === extra);
    if (extra !== null && !selected.length) continue;
    const people = selected.map(run => run.final.measure.staff.find(s => s.id === id));
    const prefix = extra === null ? id : `${id} | ${extra ? '是' : '否'} | ${selected.length}`;
    lines.push(`| ${prefix} | ${average(people.map(s => s.hours))} | ${average(people.map(s => s.capacityHours))} | ${percentage(people.map(s => s.attainment))} | ${average(people.map(s => s.involuntarySingle))} | ${average(people.map(s => s.voluntarySingle))} |`);
  }
  return lines;
}
const cell = value => String(value ?? '—').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('|', '&#124;').replace(/\r?\n/g, '<br>');
function failureTables(runs) {
  const failed = runs.filter(run => run.status !== 'VALID');
  if (!failed.length) return ['無失敗或輸入衝突案例。'];
  const counts = new Map();
  for (const run of failed) {
    const error = run.error || {};
    const key = [run.status, error.code || '未提供', error.stage || '未提供'].join('／');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const lines = ['預期衝突是刻意設計的拒絕案例，與一般輸入衝突及程式／搜尋失敗分開列出；以下保留實際錯誤訊息，不從狀態名稱推測原因。', '',
    '| 狀態／錯誤碼／發生階段 | 組數 |', '|---|---:|',
    ...[...counts].map(([key, count]) => `| ${cell(key)} | ${count} |`), '',
    '| 案例 sampleId（seed） | 月份／情境／模式 | 狀態 | 日期 | 員工 | 錯誤碼／階段 | 失敗原因 | 詳細診斷 |',
    '|---|---|---|---|---|---|---|---|'];
  for (const run of failed) {
    const error = run.error || {}, details = error.details || {};
    const date = details.date || details.request?.date || (run.status === 'EXPECTED_CONFLICT' ? run.scenario.saturday : null);
    const id = details.id || details.staff_id || details.request?.staff_id;
    const diagnostic = {...details};
    if (run.negativeProbe) diagnostic.expectedSaturdayProbe = run.negativeProbe;
    lines.push(`| ${cell(run.sampleId)}（${cell(run.seed)}） | ${cell(`${run.month}/${run.group}/${run.mode}`)} | ${cell(run.status)} | ${cell(date)} | ${cell(id)} | ${cell(`${error.code || '未提供'}／${error.stage || '未提供'}`)} | ${cell(error.message || '原始紀錄未提供錯誤訊息，需查核該案例')} | ${cell(JSON.stringify(diagnostic))} |`);
  }
  return lines;
}
function weekdayGapTables(runs) {
  const audited = runs.filter(run => ['weekday-workdays-v1', 'weekday-workdays-v2'].includes(run.weekdayWorkdays?.schema) &&
    Array.isArray(run.weekdayWorkdays.final));
  const gaps = audited.flatMap(run => run.weekdayWorkdays.final.map(gap => ({sampleId: run.sampleId, seed: run.seed, ...gap})));
  const statistics = {auditedSamples: audited.length, unauditedSamples: runs.length - audited.length,
    requiredWorkdaySamples: audited.filter(run => run.weekdayWorkdays.schema === 'weekday-workdays-v2').length,
    gapCount: audited.length ? gaps.length : null,
    affectedSamples: audited.length ? audited.filter(run => run.weekdayWorkdays.final.length).length : null,
    staff: [], gaps};
  const lines = ['### 最終平日未請假整天空班', '',
    `成功樣本 ${runs.length} 組；已稽核 ${audited.length} 組；未稽核 ${statistics.unauditedSamples} 組。最終空班總筆數：${statistics.gapCount ?? 'N/A'}；涉及樣本數：${statistics.affectedSamples ?? 'N/A'}。`, '',
    `採用全體工作日修補規則（v2）的成功樣本 ${statistics.requiredWorkdaySamples} 組，最終此類空班必須為零。其餘已稽核樣本沿用舊版 v1 語義，只保護原本有班的工作日。`, '',
    '只計週一至五營業日、原意願非全天休且骨科與小兒皆無班。週六輪空不計。平均分母為該員工已稽核的成功月樣本；舊紀錄缺少稽核資料時標示未稽核，不當作零筆。INITIAL／REPAIR／WORKDAY_REPAIR／FAIRNESS 為診斷來源，v2 任一來源的最終空班都不能列為合格班表。', '',
    '| 員工 | 已稽核月樣本 n | 平均月空班日數 |', '|---|---:|---:|'];
  for (const id of STAFF.map(s => s.id)) {
    const selected = audited.filter(run => run.final.measure.staff.some(s => s.id === id));
    const row = {id, samples: selected.length,
      meanDays: mean(selected.map(run => run.weekdayWorkdays.final.filter(g => g.id === id).length))};
    statistics.staff.push(row);
    lines.push(`| ${id} | ${row.samples} | ${number(row.meanDays)} |`);
  }
  lines.push('', '| sampleId（seed） | 日期 | 員工 | 空班來源 |', '|---|---|---|---|');
  for (const gap of gaps) lines.push(`| ${cell(gap.sampleId)}（${cell(gap.seed)}） | ${cell(gap.date)} | ${cell(gap.id)} | ${cell(gap.stageOrigin)} |`);
  if (!gaps.length) lines.push('', audited.length ? '已稽核的成功班表沒有此類空班。' : '沒有有效空班稽核資料：N/A。');
  return {lines, statistics};
}
function combinedTables(runs) {
  const ids = STAFF.map(s => s.id);
  const monthly = [], weekly = [], lines = ['## 綜合全部情境：各員工月平均', '',
    `以下合併全部月份／情境／模式的 ${runs.length} 組成功班表，每張月班表各算一筆，不把各情境平均再等權平均。失敗案例不計入，也不當作零次；不同情境的成功樣本數會影響整體比重。`, '',
    '工時達成率先逐張班表算個人比率再平均；有效 n 排除應排工時為零者。單節總次數＝非自願＋自願，公平性優先考量仍是非自願單節。', '',
    '| 員工 | 成功月樣本 n | 達成率有效 n | 平均實際工時 | 平均應排工時 | 平均月工時達成率 | 平均單節總次數 | 平均非自願單節次數 | 平均自願單節次數 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const id of ids) {
    const people = runs.map(run => run.final.measure.staff.find(s => s.id === id)).filter(Boolean);
    const rates = people.map(s => s.attainment).filter(Number.isFinite);
    const row = {id, monthlySamples: people.length, attainmentSamples: rates.length,
      hours: mean(people.map(s => s.hours)), capacityHours: mean(people.map(s => s.capacityHours)), attainment: mean(rates),
      involuntarySingle: mean(people.map(s => s.involuntarySingle)), voluntarySingle: mean(people.map(s => s.voluntarySingle)),
      totalSingle: mean(people.map(s => s.involuntarySingle + s.voluntarySingle))};
    monthly.push(row);
    lines.push(`| ${id} | ${row.monthlySamples} | ${row.attainmentSamples} | ${number(row.hours)} | ${number(row.capacityHours)} | ${percentage(rates)} | ${number(row.totalSingle)} | ${number(row.involuntarySingle)} | ${number(row.voluntarySingle)} |`);
  }
  lines.push('', '## 綜合全部情境：各員工平均每週', '',
    '每張成功班表中，每個至少有一個營業平日的週各算一筆。完整週與短週依營業平日數分開合併，避免把百分比與次數混算；完全沒有營業平日的週不納入此表。個人整週請假仍保留在週樣本中，其零目標達成率以 N/A 排除。', '',
    'AC 為同類週樣本的平均次數；完整週 C／早班為各週個人達成率的平均，短週為實際平均次數。不同月份的週數不同，因此本表不是月總次數除以固定四週。', '',
    '| 週型 | 員工 | 週樣本 n | AC 平均次數 | 平日 C 達成率／短週次數 | 平日早班達成率／短週次數 |',
    '|---|---|---:|---:|---:|---:|');
  // Explicitly separate every short-week length rather than mixing 1- and 4-day weeks.
  for (const days of [5, 4, 3, 2, 1]) for (const id of ids) {
    const rows = runs.flatMap(run => run.final.weekly.find(person => person.id === id)?.weeks || [])
      .filter(week => week.openWeekdays === days);
    if (!rows.length) continue;
    const row = {id, openWeekdays: days, weeklySamples: rows.length, AC: mean(rows.map(w => w.AC)),
      cValue: days === 5 ? mean(rows.map(w => w.cRate)) : mean(rows.map(w => w.cActual)),
      earlyValue: days === 5 ? mean(rows.map(w => w.earlyRate)) : mean(rows.map(w => w.earlyActual)),
      cValidSamples: days === 5 ? rows.filter(w => Number.isFinite(w.cRate)).length : rows.length,
      earlyValidSamples: days === 5 ? rows.filter(w => Number.isFinite(w.earlyRate)).length : rows.length,
      unit: days === 5 ? 'ratio' : 'count'};
    weekly.push(row);
    lines.push(`| ${days === 5 ? '完整週（5 平日）' : `短週（${days} 平日）`} | ${id} | ${rows.length} | ${number(row.AC)} | ${weeklyCell(rows, 'c')} | ${weeklyCell(rows, 'early')} |`);
  }
  if (!weekly.length) lines.push('', '沒有可統計的成功週樣本，各週指標為 N/A。');
  return {lines, monthly, weekly};
}
function outcomeTables(group) {
  const runs = group.successful;
  const ids = runs[0]?.final.measure.staff.map(s => s.id) || STAFF.map(s => s.id);
  const lines = ['### 每位員工的最終月平均', '', ...monthlyTable(runs, ids), '',
    '### 每人每週班型平均', '',
    '| 週別 | 員工 | AC 平均次數 | 平日 C 達成率／短週次數 | 平日早班達成率／短週次數 |',
    '|---|---|---:|---:|---:|'];
  const weeks = runs[0]?.final.weekly[0].weeks || [];
  for (let index = 0; index < weeks.length; index++) {
    const label = `第${index + 1}週${weeks[index].shortWeek ? `（短週${weeks[index].openWeekdays}平日）` : ''}`;
    for (const id of ids) {
      const rows = runs.map(run => run.final.weekly.find(p => p.id === id).weeks[index]);
      lines.push(`| ${label} | ${id} | ${average(rows.map(w => w.AC))} | ${weeklyCell(rows, 'c')} | ${weeklyCell(rows, 'early')} |`);
    }
  }
  if (!runs.length) lines.push('', '無成功樣本：每週及週六結果為 N/A。');
  lines.push('', '### 每人週六最終分配平均次數', '',
    '| 員工 | AB | 單 A | 單 B | 未排班 |', '|---|---:|---:|---:|---:|');
  for (const id of ids) {
    const totals = runs.map(run => {
      const result = {AB: 0, A: 0, B: 0, off: 0};
      for (const day of run.final.audit.pairing) {
        const pattern = ['A', 'B'].filter(s => day.roster[s].includes(id)).join('');
        result[pattern || 'off']++;
      }
      return result;
    });
    lines.push(`| ${id} | ${average(totals.map(t => t.AB))} | ${average(totals.map(t => t.A))} | ${average(totals.map(t => t.B))} | ${average(totals.map(t => t.off))} |`);
  }
  if (runs.some(run => run.scenario.weekly.some(w => w.extraWholeWeek))) {
    lines.push('', '### 額外整週休假者分開統計', '',
      '同一員工在不同樣本可能是連休者或非連休者，分別列出，避免平均掩蓋應排工時差異。', '',
      ...monthlyTable(runs, ids, true), '', ...monthlyTable(runs, ids, false));
  }
  return lines;
}
async function summarize(directory) {
  const metadata = readJSON(path.join(directory, 'merged.json')), groups = new Map(), allSuccessful = [], failures = [];
  for await (const run of readRuns(directory)) {
    const key = `${run.month}/${run.group}/${run.mode}`;
    if (!groups.has(key)) groups.set(key, {statuses: {}, elapsed: [], successful: [], failures: [], stageMetrics: {initial: {}, repaired: {}, workdayRepaired: {}, final: {}}});
    const group = groups.get(key);
    group.statuses[run.status] = (group.statuses[run.status] || 0) + 1;
    group.elapsed.push(run.elapsedMs);
    if (run.status === 'VALID') {
      group.successful.push(run);
      allSuccessful.push(run);
      // Retain machine-readable phase diagnostics; visible tables use final only.
      for (const stage of ['initial', 'repaired', 'workdayRepaired', 'final']) if (run[stage]) for (const [metric, value] of Object.entries(metrics(run[stage].measure))) {
        (group.stageMetrics[stage][metric] ||= []).push(value);
      }
    } else { group.failures.push(run); failures.push(run); }
  }
  const lines = ['# 擴大排班測試結果', '',
    `規模：${metadata.size}；完整：${metadata.completed}；前導通過：${metadata.pilotPassed}。`, '',
    `狀態：${JSON.stringify(metadata.statuses)}。缺少 ${metadata.missing.length} 組；待調查 ${metadata.invalid.length} 組。`, '',
    '公平性優先序維持月非自願單節 → 月工時達成率 → 每週 AC → 每週 BC／AB 同級。', '',
    '輸入衝突仍保留在成功率分母；負向案例獨立列示。新月份／新樣本不與歷史 400 組直接宣稱前後改善。', '',
    '雲端前導通過後仍需成本回報與使用者選定規模，才執行正式批。', '',
    ...READING_GUIDE, '## 各情境執行狀態與最終公平性', '',
    '| 月份／情境／模式 | 狀態 | 成功樣本 n | 平均非自願單節差距（次） | 平均工時達成率差距（百分點） | 詳細報告 |',
    '|---|---|---:|---:|---:|---|'];
  if (metadata.inputPolicy === 'COORDINATED_ORIGINAL_INTENT_V2') {
    lines.splice(6, 0, '## 原始休假意願協調', '',
      `本批先按小兒可代班、指定班上限與每日最低骨科覆蓋可行性協調原始意願，再凍結 ${metadata.size} 組正式輸入。協調階段另退回 ${metadata.inputSampling?.rejectedCount ?? '未知'} 次原始抽樣；詳見輸入檔各組 sampling.rejected。`, '',
      '此為通過輸入協調的條件式測試，不代表任意未協調休假都可排班；篩選不使用自動班表或公平性結果。樣本凍結後的排班失敗不換種子。一般樣本若仍出現 INPUT_CONFLICT，列為待調查，不再自動視為可接受的輸入拒絕。刻意週六全休案例只豁免指定的該日期，其餘日期照常協調。', '');
  }
  const summaries = {}, resultSections = [], auditRows = [], efficiencyRows = [];
  for (const [key, group] of groups) {
    const file = `${key.replaceAll('/', '_')}.md`, target = path.join(directory, 'reports', file);
    const detail = [`# ${key}`, '', `狀態：${JSON.stringify(group.statuses)}；最終公平性分母：${group.successful.length}。`, '',
      ...READING_GUIDE, '## 最終人員差距平均', '', '| 指標 | 平均 |', '|---|---:|'];
    const stages = {};
    for (const stage of ['initial', 'repaired', 'workdayRepaired', 'final']) {
      stages[stage] = Object.fromEntries(Object.entries(group.stageMetrics[stage]).map(([name, values]) => [name, stats(values)]));
    }
    for (const [name, label] of Object.entries(METRICS)) detail.push(`| ${label} | ${average(group.stageMetrics.final[name] || [])} |`);
    const tables = outcomeTables(group);
    const gapReport = weekdayGapTables(group.successful);
    detail.push('', '## 失敗原因', '', ...failureTables(group.failures), '', ...tables, '', ...gapReport.lines, '', '## 週六結構及搜尋診斷', '',
      '| sampleId | 週六最大 AB 稽核 | 公平性停止原因 | 候選數 | 耗時 ms |', '|---|---|---|---:|---:|');
    for (const run of group.successful) detail.push(`| ${run.sampleId} | ${run.final.audit.pairing.map(d => `${d.date}: ${d.actualAB}/${d.maxAB}`).join('; ')} | ${run.final.report.stopReason} | ${run.final.report.evaluated} | ${run.elapsedMs} |`);
    const worst = {};
    for (const metric of Object.keys(METRICS)) worst[metric] = group.successful.map(run => ({sampleId: run.sampleId, seed: run.seed, value: metrics(run.final.measure)[metric]}))
      .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.sampleId.localeCompare(b.sampleId)).slice(0, 5);
    detail.push('', '## 最差案例種子（診斷用）', '', '```json', JSON.stringify(worst, null, 2), '```', '');
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, detail.join('\n'), {flag: 'wx'});
    summaries[key] = {statuses: group.statuses, elapsed: stats(group.elapsed), stages, worst,
      weekdayWorkdays: gapReport.statistics,
      failures: group.failures.map(run => ({sampleId: run.sampleId, seed: run.seed, status: run.status, error: run.error, negativeProbe: run.negativeProbe}))};
    lines.push(`| ${key} | ${JSON.stringify(group.statuses)} | ${group.successful.length} | ${average(group.stageMetrics.final.involuntarySingle || [])} | ${average(group.stageMetrics.final.attainmentPercentagePoints || [])} | [詳細](reports/${file}) |`);
    resultSections.push('', `## ${key}（成功 ${group.successful.length} 組）`, '', ...tables, '', ...gapReport.lines);
    const dates = group.successful.flatMap(run => run.final.audit.pairing);
    auditRows.push(`| ${key} | ${dates.length} | ${dates.filter(d => d.actualAB !== d.maxAB).length} |`);
    efficiencyRows.push(`| ${key} | ${group.elapsed.length} | ${average(group.elapsed)} | ${average(group.successful.map(run => run.elapsedMs))} | ${group.successful.filter(run => /LIMIT/.test(run.final.report.stopReason)).length} |`);
  }
  const combined = combinedTables(allSuccessful);
  const combinedGaps = weekdayGapTables(allSuccessful);
  lines.push('', ...combined.lines, '', '## 綜合全部情境：平日空班稽核', '', ...combinedGaps.lines, '', '## 全部情境的失敗原因', '', ...failureTables(failures), '',
    '## 最終週六 AB 結構獨立驗證', '',
    '| 月份／情境／模式 | 最終稽核日期數 | 未達最大可行 AB 日期數 |', '|---|---:|---:|', ...auditRows, '',
    '## 效率與搜尋界限', '',
    '完整評估耗時含讀入引擎、排班、修補、調整與獨立稽核，不代表線上 GAS 執行時間。公平性到限後仍可能保留合法結果，不代表已找到最佳解。', '',
    '| 月份／情境／模式 | 全部樣本數 | 全部樣本平均耗時 ms | 成功樣本平均耗時 ms | 成功樣本公平性到限組數 |',
    '|---|---:|---:|---:|---:|', ...efficiencyRows, ...resultSections, '', '## 失敗與未完成', '',
    '逐組錯誤、停止原因及保留的重試紀錄見 merged.json 與 summary.ndjson.gz；原始壓縮紀錄包含成功班表或失敗階段班表。', '',
    `缺批／缺樣本：${metadata.missing.join(', ') || '無'}。`, '',
    `待調查：${metadata.invalid.join(', ') || '無'}。`, '');
  writeJSON(path.join(directory, 'statistics.json'), {identity: metadata.identity, completed: metadata.completed,
    combined: {successfulSamples: allSuccessful.length, monthly: combined.monthly, weekly: combined.weekly,
      weekdayWorkdays: combinedGaps.statistics}, groups: summaries});
  fs.writeFileSync(path.join(directory, 'summary.md'), lines.join('\n'), {flag: 'wx'});
  return summaries;
}
if (require.main === module) {
  const args = argumentsFor(process.argv.slice(2), ['--input']);
  if (!args['--input']) throw new Error('--input is required');
  summarize(path.resolve(args['--input'])).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = {summarize, weeklyCell, combinedTables, failureTables, weekdayGapTables};
