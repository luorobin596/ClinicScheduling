'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {descriptors} = require('./support/expanded-fixtures.cjs');
const {stats} = require('./support/expanded-statistics.cjs');
const {argumentsFor, readJSON, writeJSON, readRuns} = require('./support/expanded-io.cjs');
// Negative cases test the same all-staff-off Saturday, independently of the
// unrelated monthly mode. Eight pilot negatives cannot cover nine mode cells.
const stratum = row => `${row.month}/${row.group}/${row.group === 'negative-saturday' ? 'all' : row.mode}`;
function nonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}
async function estimate(directory, usageFile) {
  const merged = readJSON(path.join(directory, 'merged.json'));
  if (merged.size !== 200 || !merged.completed || !merged.pilotPassed) throw new Error('Cost gate requires a complete, passing 200-case cloud pilot');
  const usage = readJSON(usageFile);
  if (usage.source !== 'github-actions-observed') throw new Error('Use observed GitHub job durations, not local estimates');
  const rate = nonnegative(usage.linuxRateUSDPerMinute, 'current Linux rate');
  const storageRate = nonnegative(usage.storageRateUSDPerGBMonth, 'current storage rate');
  const retentionDays = nonnegative(usage.retentionDays, 'retention days');
  const artifactBytes = nonnegative(usage.artifactBytes, 'observed uploaded artifact bytes');
  if (!Array.isArray(usage.jobs) || !Array.isArray(usage.otherJobElapsedMs)) throw new Error('Observed jobs and otherJobElapsedMs are required');
  if (!usage.jobs.length || artifactBytes === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(usage.ratesCheckedAt || '') ||
    !String(usage.ratesSource || '').startsWith('https://docs.github.com/')) throw new Error('Observed artifact size and dated official pricing source are required');
  const observed = new Map();
  for (const job of usage.jobs) {
    if (observed.has(job.attempt)) throw new Error('Duplicate observed attempt');
    const elapsed = nonnegative(job.elapsedMs, 'job elapsedMs');
    if (!elapsed) throw new Error('Observed job elapsedMs must be positive');
    observed.set(job.attempt, elapsed);
  }
  if (observed.size !== merged.jobs.length || new Set(merged.jobs.map(j => j.attempt)).size !== merged.jobs.length) throw new Error('Observed job count mismatch');
  for (const job of merged.jobs) if (!observed.has(job.attempt)) throw new Error(`Missing observed job duration: ${job.attempt}`);
  const overhead = merged.jobs.map(job => Math.max(0, observed.get(job.attempt) - job.elapsedMs));
  const averageOverheadMs = stats(overhead).mean;
  const otherMs = usage.otherJobElapsedMs.map(ms => nonnegative(ms, 'other job elapsedMs'));
  const otherMinutes = otherMs.reduce((sum, ms) => sum + Math.ceil(ms / 60000), 0);
  const pilotMinutes = [...observed.values()].reduce((sum, ms) => sum + Math.ceil(ms / 60000), 0) + otherMinutes;
  const strata = new Map();
  for await (const run of readRuns(directory)) {
    if (!strata.has(stratum(run))) strata.set(stratum(run), []);
    strata.get(stratum(run)).push(run.elapsedMs);
  }
  const remainingMinutes = usage.remainingFreeMinutes === undefined ? null : nonnegative(usage.remainingFreeMinutes, 'remaining free minutes');
  const remainingBytes = usage.remainingFreeStorageBytes === undefined ? null : nonnegative(usage.remainingFreeStorageBytes, 'remaining free storage');
  const plans = [5000, 10000].map(size => {
    const rows = descriptors(size), shards = Math.ceil(size / 100), batches = Array.from({length: shards}, () => 0);
    rows.forEach((row, index) => {
      const sample = strata.get(stratum(row));
      if (!sample?.length) throw new Error(`Pilot did not cover stratum: ${stratum(row)}`);
      batches[index % shards] += stats(sample).mean;
    });
    const predictMinutes = factor => batches.reduce((sum, ms) => sum + Math.ceil((ms * factor + averageOverheadMs) / 60000), 0) + otherMinutes;
    const formalMinutes = predictMinutes(1), budgetMinutes = predictMinutes(1.3);
    const predictedBytes = Math.ceil(artifactBytes * size / 200);
    const storageFull = predictedBytes / 1e9 * storageRate * retentionDays / 30;
    const storageObserved = remainingBytes === null ? null : Math.max(0, predictedBytes - remainingBytes) / 1e9 * storageRate * retentionDays / 30;
    return {size, shards, averageFormalMinutes: formalMinutes, budgetFormalMinutes: budgetMinutes,
      pilotPlusFormalMinutes: pilotMinutes + formalMinutes, pilotPlusBudgetMinutes: pilotMinutes + budgetMinutes,
      predictedArtifactBytes: predictedBytes, storageUSDWithNoFreeAllowance: storageFull,
      pilotPlusFormalStorageUSDWithNoFreeAllowance: (artifactBytes + predictedBytes) / 1e9 * storageRate * retentionDays / 30,
      storageUSDWithObservedRemainingAllowance: storageObserved,
      computeUSDIf2000MinutesInitiallyUnused: Math.max(0, pilotMinutes + budgetMinutes - 2000) * rate,
      computeUSDIfFreeMinutesExhausted: (pilotMinutes + budgetMinutes) * rate,
      additionalFormalComputeUSDWithObservedRemainingMinutes: remainingMinutes === null ? null : Math.max(0, budgetMinutes - remainingMinutes) * rate,
      approximateWallMinutesAtTwoJobs: (budgetMinutes - otherMinutes) / 2 + otherMinutes,
      caveat: 'Storage scales uploaded pilot bytes linearly; parallel wait estimate excludes queue delays. 30% is an engineering margin, not a guarantee.'};
  });
  const report = {pilotPassed: true, formalExecutionAuthorized: false, identity: merged.identity,
    pilotMinutes, uploadedPilotBytes: artifactBytes, retentionDays, averageOverheadMs, rates: {
      linuxRateUSDPerMinute: rate, storageRateUSDPerGBMonth: storageRate, checkedAt: usage.ratesCheckedAt,
      source: usage.ratesSource}, plans, strata: Object.fromEntries([...strata].map(([key, values]) => [key, stats(values)]))};
  writeJSON(path.join(directory, 'cost-estimate.json'), report);
  const lines = ['# 雲端前導成本估算', '',
    `前導 200 組：${pilotMinutes} 個累計計費分鐘；已上傳產物 ${(artifactBytes / 1e6).toFixed(1)} MB。`, '',
    '正式執行尚未授權，待使用者選擇 5,000 或 10,000 組。', '',
    '| 規模 | 正式平均估計分鐘 | 正式含 30% 運算餘裕分鐘 | 前導＋正式預算分鐘 | 無免費分鐘時合計 USD |', '|---|---:|---:|---:|---:|'];
  for (const plan of plans) lines.push(`| ${plan.size} | ${plan.averageFormalMinutes} | ${plan.budgetFormalMinutes} | ${plan.pilotPlusBudgetMinutes} | ${plan.computeUSDIfFreeMinutesExhausted.toFixed(2)} |`);
  lines.push('', '儲存費、剩餘免費額度兩種情境、分層平均與 P95 見 cost-estimate.json。儲存預測為近似；30% 餘裕不是最高費用保證，等待時間另受排隊影響。', '');
  fs.writeFileSync(path.join(directory, 'cost-estimate.md'), lines.join('\n'), {flag: 'wx'});
  return report;
}
if (require.main === module) {
  const args = argumentsFor(process.argv.slice(2), ['--input', '--usage']);
  if (!args['--input'] || !args['--usage']) throw new Error('--input and --usage are required');
  estimate(path.resolve(args['--input']), args['--usage']).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = {estimate};
