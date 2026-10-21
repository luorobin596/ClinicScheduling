'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {hash, writeJSON} = require('./support/expanded-io.cjs');
const {summarize, weeklyCell, combinedTables, failureTables, weekdayGapTables} = require('./summarize-expanded.cjs');
const {estimate} = require('./estimate-expanded-cost.cjs');

test('EX04: reporting uses identical successful denominators and renders zero targets as N/A', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expanded-report-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const week = {week: 1, openWeekdays: 5, AC: 0, shortWeek: false, cActual: 0, cRate: null, earlyActual: 0, earlyRate: null};
  const stage = singles => ({measure: {score: Array(9).fill(0), staff: [
    {id: 'FT001', hours: 0, voluntarySingle: 0, involuntarySingle: singles, attainment: null, capacityHours: 0},
    {id: 'FT002', hours: 151.2, voluntarySingle: 0, involuntarySingle: 0, attainment: 0.9, capacityHours: 168}
  ]}, weekly: ['FT001', 'FT002'].map(id => ({id, weeks: [week]})),
  audit: {pairing: [{date: '2026-11-07', actualAB: 1, maxAB: 1, roster: {A: ['FT001', 'FT002'], B: ['FT001']}}], coverage: []}, report: {stopReason: 'CANDIDATE_LIMIT', evaluated: 20000}});
  const valid = {sampleId: 'valid', seed: 1, month: '2026-11', group: 'random', mode: 'full', status: 'VALID',
    elapsedMs: 1, scenario: {weekly: []}, initial: stage(4), repaired: stage(2), final: stage(1)};
  const rejected = {...valid, sampleId: 'rejected', status: 'INPUT_CONFLICT', initial: stage(40)};
  rejected.error = {code: 'INPUT_CONFLICT', stage: 'INITIAL', message: '小兒代班衝突 | 無可用人員',
    details: {date: '2026-11-05', id: 'FT003'}};
  delete rejected.repaired; delete rejected.final;
  const bytes = zlib.gzipSync([valid, rejected].map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'summary.ndjson.gz'), bytes);
  writeJSON(path.join(dir, 'merged.json'), {size: 200, completed: false, pilotPassed: false,
    statuses: {VALID: 1, INPUT_CONFLICT: 1}, missing: ['not-complete'], invalid: [], identity: {}, summaryHash: hash(bytes)});
  const groups = await summarize(dir);
  assert.equal(groups['2026-11/random/full'].stages.initial.involuntarySingle.mean, 4);
  assert.equal(groups['2026-11/random/full'].stages.final.involuntarySingle.mean, 1);
  const detail = fs.readFileSync(path.join(dir, 'reports/2026-11_random_full.md'), 'utf8');
  assert.match(detail, /\| 第1週 \| FT001 \| 0.00 \| N\/A \| N\/A \|/);
  assert.doesNotMatch(detail, /N\/A%/);
  const summary = fs.readFileSync(path.join(dir, 'summary.md'), 'utf8');
  assert.match(summary, /not-complete/);
  assert.match(summary, /綜合全部情境：各員工月平均/);
  assert.match(summary, /綜合全部情境：各員工平均每週/);
  assert.match(summary, /小兒代班衝突 &#124; 無可用人員/);
  assert.match(detail, /小兒代班衝突 &#124; 無可用人員/);
  assert.match(summary, /2026-11-05/);
  assert.match(summary, /\| FT001 \| 1 \| 0 \| 0.00 \| 0.00 \| N\/A \| 1.00 \| 1.00 \| 0.00 \|/);
  assert.match(summary, /每位員工的最終月平均/);
  assert.match(summary, /未請假整天空班/);
  assert.match(summary, /未稽核/);
  assert.match(summary, /\| FT001 \| 0.00 \| 0.00 \| N\/A \| 1.00 \| 0.00 \|/);
  assert.match(summary, /\| FT002 \| 151.20 \| 168.00 \| 90.00% \| 0.00 \| 0.00 \|/);
  assert.match(summary, /\| FT001 \| 1.00 \| 0.00 \| 0.00 \| 0.00 \|/);
  assert.match(summary, /\| FT002 \| 0.00 \| 1.00 \| 0.00 \| 0.00 \|/);
  for (const text of [summary, detail]) {
    assert.doesNotMatch(text, /初始 → 最終|初步排班 → 調整完成|\| 階段 \|/);
    assert.doesNotMatch(text, /\| initial \||\| repaired \||4.00 → 1.00/);
  }
});

test('WP08 final-only gap report distinguishes audited zeros, old records and origin with correct denominator', () => {
  const run = (sampleId, final) => ({sampleId, seed: 7, final: {measure: {staff: [{id: 'FT001'}]}},
    ...(final === null ? {} : {weekdayWorkdays: {schema: 'weekday-workdays-v1', final}})});
  const result = weekdayGapTables([
    run('existing', [{date: '2026-11-02', id: 'FT001', stageOrigin: 'INITIAL'}]),
    run('zero', []), run('historical', null)
  ]);
  assert.equal(result.statistics.auditedSamples, 2);
  assert.equal(result.statistics.unauditedSamples, 1);
  assert.equal(result.statistics.gapCount, 1);
  assert.equal(result.statistics.affectedSamples, 1);
  assert.equal(result.statistics.staff.find(s => s.id === 'FT001').meanDays, 0.5);
  const text = result.lines.join('\n');
  assert.match(text, /INITIAL/);
  assert.match(text, /existing/);
  assert.match(text, /未稽核/);
  assert.doesNotMatch(text, /→/);
  assert.equal(weekdayGapTables([run('old', null)]).statistics.gapCount, null);
  assert.match(weekdayGapTables([]).lines.join('\n'), /N\/A/);
  const current = run('v2', []);
  current.weekdayWorkdays.schema = 'weekday-workdays-v2';
  const currentReport = weekdayGapTables([current]);
  assert.equal(currentReport.statistics.requiredWorkdaySamples, 1);
  assert.equal(currentReport.statistics.gapCount, 0);
  assert.match(currentReport.lines.join('\n'), /v2/);
});

test('EX04: combined statistics weight successful months and weeks, separating every short-week length', () => {
  const week = (days, AC, c, early) => ({openWeekdays: days, shortWeek: days < 5, AC,
    ...(days === 5 ? {cRate: c, earlyRate: early} : {cActual: c, earlyActual: early})});
  const run = (rate, singles, weeks) => ({final: {
    measure: {staff: [{id: 'FT001', hours: 80, capacityHours: 100, attainment: rate, involuntarySingle: singles, voluntarySingle: 1}]},
    weekly: [{id: 'FT001', weeks}]
  }});
  const result = combinedTables([
    run(0.5, 1, [week(5, 1, 1, null), week(2, 0, 1, 0), week(0, 99, 0, 0)]),
    run(1, 3, [week(5, 3, 0.5, 1), week(2, 1, 2, 1)]),
    run(1, 3, [week(5, 2, null, 0.5), week(1, 0, 1, 0)])
  ]);
  const monthly = result.monthly.find(p => p.id === 'FT001');
  assert.equal(monthly.monthlySamples, 3);
  assert.equal(monthly.attainment, 2.5 / 3);
  assert.equal(monthly.totalSingle, 10 / 3);
  const full = result.weekly.find(p => p.id === 'FT001' && p.openWeekdays === 5);
  assert.equal(full.AC, 2);
  assert.equal(full.weeklySamples, 3);
  assert.equal(full.cValue, 0.75);
  assert.equal(full.cValidSamples, 2);
  assert.equal(full.earlyValue, 0.75);
  const short = result.weekly.find(p => p.id === 'FT001' && p.openWeekdays === 2);
  assert.equal(short.cValue, 1.5);
  assert.equal(short.weeklySamples, 2);
  assert.ok(result.weekly.every(row => row.openWeekdays > 0));
  const text = result.lines.join('\n');
  assert.match(text, /75.00%（n=2\/3）/);
  assert.match(text, /1.50 次/);
});

test('EX04: failure reasons distinguish expected conflicts, real conflicts and missing diagnostics', () => {
  const lines = failureTables([
    {sampleId: 'negative', seed: 1, month: '2026-11', group: 'negative-saturday', mode: 'full', status: 'EXPECTED_CONFLICT',
      scenario: {saturday: '2026-11-07'}, error: {code: 'INPUT_CONFLICT', stage: 'REPAIR', message: '週六無人', details: {date: '2026-11-07'}}},
    {sampleId: 'unknown', status: 'ERROR', scenario: {}, month: '2026-11', group: 'random', mode: 'mixed'}
  ]).join('\n');
  assert.match(lines, /EXPECTED_CONFLICT／INPUT_CONFLICT／REPAIR/);
  assert.match(lines, /週六無人/);
  assert.match(lines, /原始紀錄未提供錯誤訊息/);
});

test('EX04: final-only weekly cells preserve mean ratios, N/A and short-week counts', () => {
  assert.equal(weeklyCell([], 'c'), 'N/A');
  assert.equal(weeklyCell([{shortWeek: false, cRate: null}], 'c'), 'N/A');
  assert.equal(weeklyCell([{shortWeek: false, cRate: 1}, {shortWeek: false, cRate: 0.5}, {shortWeek: false, cRate: null}], 'c'), '75.00%（n=2/3）');
  assert.equal(weeklyCell([{shortWeek: true, earlyActual: 0}, {shortWeek: true, earlyActual: 1}], 'early'), '0.50 次');
});

test('EX06: a failed or incomplete pilot cannot produce a cost approval report', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expanded-cost-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  writeJSON(path.join(dir, 'merged.json'), {size: 200, completed: true, pilotPassed: false});
  await assert.rejects(estimate(dir, 'not-read.json'), /passing 200-case/);
  assert.equal(fs.existsSync(path.join(dir, 'cost-estimate.json')), false);
});
