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
  const metadata = readJSON(path.join(directory, 'merged.json')), groups = new Map();
  for await (const run of readRuns(directory)) {
    const key = `${run.month}/${run.group}/${run.mode}`;
    if (!groups.has(key)) groups.set(key, {statuses: {}, elapsed: [], successful: [], stageMetrics: {initial: {}, repaired: {}, final: {}}});
    const group = groups.get(key);
    group.statuses[run.status] = (group.statuses[run.status] || 0) + 1;
    group.elapsed.push(run.elapsedMs);
    if (run.status === 'VALID') {
      group.successful.push(run);
      // Retain machine-readable phase diagnostics; visible tables use final only.
      for (const stage of ['initial', 'repaired', 'final']) for (const [metric, value] of Object.entries(metrics(run[stage].measure))) {
        (group.stageMetrics[stage][metric] ||= []).push(value);
      }
    }
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
  const summaries = {}, resultSections = [], auditRows = [], efficiencyRows = [];
  for (const [key, group] of groups) {
    const file = `${key.replaceAll('/', '_')}.md`, target = path.join(directory, 'reports', file);
    const detail = [`# ${key}`, '', `狀態：${JSON.stringify(group.statuses)}；最終公平性分母：${group.successful.length}。`, '',
      ...READING_GUIDE, '## 最終人員差距平均', '', '| 指標 | 平均 |', '|---|---:|'];
    const stages = {};
    for (const stage of ['initial', 'repaired', 'final']) {
      stages[stage] = Object.fromEntries(Object.entries(group.stageMetrics[stage]).map(([name, values]) => [name, stats(values)]));
    }
    for (const [name, label] of Object.entries(METRICS)) detail.push(`| ${label} | ${average(group.stageMetrics.final[name] || [])} |`);
    const tables = outcomeTables(group);
    detail.push('', ...tables, '', '## 週六結構及搜尋診斷', '',
      '| sampleId | 週六最大 AB 稽核 | 公平性停止原因 | 候選數 | 耗時 ms |', '|---|---|---|---:|---:|');
    for (const run of group.successful) detail.push(`| ${run.sampleId} | ${run.final.audit.pairing.map(d => `${d.date}: ${d.actualAB}/${d.maxAB}`).join('; ')} | ${run.final.report.stopReason} | ${run.final.report.evaluated} | ${run.elapsedMs} |`);
    const worst = {};
    for (const metric of Object.keys(METRICS)) worst[metric] = group.successful.map(run => ({sampleId: run.sampleId, seed: run.seed, value: metrics(run.final.measure)[metric]}))
      .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.sampleId.localeCompare(b.sampleId)).slice(0, 5);
    detail.push('', '## 最差案例種子（診斷用）', '', '```json', JSON.stringify(worst, null, 2), '```', '');
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, detail.join('\n'), {flag: 'wx'});
    summaries[key] = {statuses: group.statuses, elapsed: stats(group.elapsed), stages, worst};
    lines.push(`| ${key} | ${JSON.stringify(group.statuses)} | ${group.successful.length} | ${average(group.stageMetrics.final.involuntarySingle || [])} | ${average(group.stageMetrics.final.attainmentPercentagePoints || [])} | [詳細](reports/${file}) |`);
    resultSections.push('', `## ${key}（成功 ${group.successful.length} 組）`, '', ...tables);
    const dates = group.successful.flatMap(run => run.final.audit.pairing);
    auditRows.push(`| ${key} | ${dates.length} | ${dates.filter(d => d.actualAB !== d.maxAB).length} |`);
    efficiencyRows.push(`| ${key} | ${group.elapsed.length} | ${average(group.elapsed)} | ${average(group.successful.map(run => run.elapsedMs))} | ${group.successful.filter(run => /LIMIT/.test(run.final.report.stopReason)).length} |`);
  }
  lines.push('', '## 最終週六 AB 結構獨立驗證', '',
    '| 月份／情境／模式 | 最終稽核日期數 | 未達最大可行 AB 日期數 |', '|---|---:|---:|', ...auditRows, '',
    '## 效率與搜尋界限', '',
    '完整評估耗時含讀入引擎、排班、修補、調整與獨立稽核，不代表線上 GAS 執行時間。公平性到限後仍可能保留合法結果，不代表已找到最佳解。', '',
    '| 月份／情境／模式 | 全部樣本數 | 全部樣本平均耗時 ms | 成功樣本平均耗時 ms | 成功樣本公平性到限組數 |',
    '|---|---:|---:|---:|---:|', ...efficiencyRows, ...resultSections, '', '## 失敗與未完成', '',
    '逐組錯誤、停止原因及保留的重試紀錄見 merged.json 與 summary.ndjson.gz；原始壓縮紀錄包含成功班表或失敗階段班表。', '',
    `缺批／缺樣本：${metadata.missing.join(', ') || '無'}。`, '',
    `待調查：${metadata.invalid.join(', ') || '無'}。`, '');
  writeJSON(path.join(directory, 'statistics.json'), {identity: metadata.identity, completed: metadata.completed, groups: summaries});
  fs.writeFileSync(path.join(directory, 'summary.md'), lines.join('\n'), {flag: 'wx'});
  return summaries;
}
if (require.main === module) {
  const args = argumentsFor(process.argv.slice(2), ['--input']);
  if (!args['--input']) throw new Error('--input is required');
  summarize(path.resolve(args['--input'])).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = {summarize, weeklyCell};
