'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {argumentsFor, readJSON, writeJSON, readRuns} = require('./support/expanded-io.cjs');
const {stats, metrics} = require('./support/expanded-statistics.cjs');
const {formatWeeklyCell} = require('./support/weekly-report.cjs');
const mean = values => stats(values)?.mean ?? null;
const number = value => value === null || value === undefined ? 'N/A' : value.toFixed(2);
const pair = (a, b) => `${number(mean(a))} → ${number(mean(b))}`;
const percentPair = (a, b) => {
  const format = list => mean(list) === null ? 'N/A' : `${number(mean(list))}%`;
  return `${format(a)} → ${format(b)}`;
};
async function summarize(directory) {
  const metadata = readJSON(path.join(directory, 'merged.json')), groups = new Map();
  for await (const run of readRuns(directory)) {
    const key = `${run.month}/${run.group}/${run.mode}`;
    if (!groups.has(key)) groups.set(key, {statuses: {}, elapsed: [], successful: [], stageMetrics: {initial: {}, repaired: {}, final: {}}});
    const group = groups.get(key);
    group.statuses[run.status] = (group.statuses[run.status] || 0) + 1;
    group.elapsed.push(run.elapsedMs);
    // All three stages use exactly the same successful cohort.
    if (run.status === 'VALID') {
      group.successful.push(run);
      for (const stage of ['initial', 'repaired', 'final']) {
        for (const [metric, value] of Object.entries(metrics(run[stage].measure))) {
          (group.stageMetrics[stage][metric] ||= []).push(value);
        }
      }
    }
  }
  const lines = ['# 擴大排班測試結果', '',
    `規模：${metadata.size}；完整：${metadata.completed}；前導通過：${metadata.pilotPassed}。`, '',
    `狀態：${JSON.stringify(metadata.statuses)}。缺少 ${metadata.missing.length} 組；待調查 ${metadata.invalid.length} 組。`, '',
    '公平性優先序維持月非自願單節 → 月工時達成率 → 每週 AC → 每週 BC／AB 同級。', '',
    '各分層公平性僅比較相同成功樣本。輸入衝突仍保留在成功率分母；負向案例獨立列示。新月份／新樣本不與歷史 400 組直接宣稱前後改善。', '',
    '雲端前導通過後仍需成本回報與使用者選定規模，才執行正式批。', '',
    '| 月份／情境／模式 | 狀態 | 成功樣本 n | 單節差距：初始 → 最終 | 工時達成率差距（百分點） | 詳細報告 |',
    '|---|---|---:|---:|---:|---|'];
  const summaries = {};
  for (const [key, group] of groups) {
    const file = `${key.replaceAll('/', '_')}.md`, target = path.join(directory, 'reports', file);
    const detail = [`# ${key}`, '', `狀態：${JSON.stringify(group.statuses)}；公平性分母：${group.successful.length}。`, '',
      '## 差距分布', '', '| 階段 | 指標 | 平均 | 中位數 | P90 | P95 | 最大 |', '|---|---|---:|---:|---:|---:|---:|'];
    const stages = {};
    for (const stage of ['initial', 'repaired', 'final']) {
      stages[stage] = {};
      for (const [metric, values] of Object.entries(group.stageMetrics[stage])) {
        const value = stats(values); stages[stage][metric] = value;
        detail.push(`| ${stage} | ${metric} | ${number(value.mean)} | ${number(value.median)} | ${number(value.p90)} | ${number(value.p95)} | ${number(value.max)} |`);
      }
    }
    detail.push('', '## 每人月平均', '',
      '額外連休者與非額外連休者分開；比率為逐組個人比率再平均。', '',
      '| 員工 | 額外整週休假 | n | 非自願單節：初始 → 最終 | 達成率：初始 → 最終 | 平均應排工時 |', '|---|---|---:|---:|---:|---:|');
    const ids = group.successful[0]?.final.measure.staff.map(s => s.id) || [];
    for (const id of ids) for (const extra of [false, true]) {
      const selected = group.successful.filter(run => run.scenario.weekly.some(w => w.id === id && w.extraWholeWeek) === extra);
      if (!selected.length) continue;
      const people = stage => selected.map(run => run[stage].measure.staff.find(s => s.id === id));
      const initial = people('initial'), final = people('final');
      detail.push(`| ${id} | ${extra ? '是' : '否'} | ${selected.length} | ${pair(initial.map(s => s.involuntarySingle), final.map(s => s.involuntarySingle))} | ${percentPair(initial.map(s => s.attainment === null ? null : s.attainment * 100), final.map(s => s.attainment === null ? null : s.attainment * 100))} | ${number(mean(final.map(s => s.capacityHours)))} |`);
    }
    detail.push('', '## 每人每週', '',
      'AC 為初始→最終平均次數。完整平日週呈現 C／早班達成率；日曆短週呈現平均實際天數，零目標 N/A，週六不計 C／早班。', '',
      '| 週 | 員工 | n | AC：初始 → 最終 | C：初始 → 最終 | 早班：初始 → 最終 |', '|---|---|---:|---:|---:|---:|');
    for (const id of ids) {
      const count = group.successful[0].initial.weekly.find(p => p.id === id).weeks.length;
      for (let week = 0; week < count; week++) {
        const rows = stage => group.successful.map(run => run[stage].weekly.find(p => p.id === id).weeks[week]);
        const initial = rows('initial'), final = rows('final');
        detail.push(`| ${week + 1} | ${id} | ${initial.length} | ${pair(initial.map(w => w.AC), final.map(w => w.AC))} | ${formatWeeklyCell(initial, final, 'c')} | ${formatWeeklyCell(initial, final, 'early')} |`);
      }
    }
    detail.push('', '## 週六結構及搜尋', '', '| sampleId | 週六最大 AB 稽核 | 公平性停止原因 | 候選數 | 耗時 ms |', '|---|---|---|---:|---:|');
    for (const run of group.successful) detail.push(`| ${run.sampleId} | ${run.final.audit.pairing.map(d => `${d.date}: ${d.actualAB}/${d.maxAB}`).join('; ')} | ${run.final.report.stopReason} | ${run.final.report.evaluated} | ${run.elapsedMs} |`);
    const worst = {};
    for (const metric of ['involuntarySingle', 'attainmentPercentagePoints', 'weeklyACWorst', 'weeklyBCABWorst']) {
      const sorted = group.successful.map(run => ({sampleId: run.sampleId, seed: run.seed, value: metrics(run.final.measure)[metric]}))
        .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.sampleId.localeCompare(b.sampleId)).slice(0, 5);
      worst[metric] = sorted;
    }
    detail.push('', '## 最差案例種子', '', '```json', JSON.stringify(worst, null, 2), '```', '');
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, detail.join('\n'), {flag: 'wx'});
    summaries[key] = {statuses: group.statuses, elapsed: stats(group.elapsed), stages, worst};
    const stage = group.stageMetrics;
    lines.push(`| ${key} | ${JSON.stringify(group.statuses)} | ${group.successful.length} | ${pair(stage.initial.involuntarySingle || [], stage.final.involuntarySingle || [])} | ${pair(stage.initial.attainmentPercentagePoints || [], stage.final.attainmentPercentagePoints || [])} | [詳細](reports/${file}) |`);
  }
  lines.push('', '## 失敗與未完成', '',
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
module.exports = {summarize};
