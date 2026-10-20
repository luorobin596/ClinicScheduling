'use strict';
function stats(values) {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  const quantile = p => list[Math.max(0, Math.ceil(list.length * p) - 1)];
  const mid = Math.floor(list.length / 2);
  return {n: list.length, mean: list.reduce((a, b) => a + b, 0) / list.length,
    median: list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2,
    p90: quantile(0.9), p95: quantile(0.95), min: list[0], max: list.at(-1)};
}
function spread(values) {
  const list = values.filter(Number.isFinite);
  return list.length ? Math.max(...list) - Math.min(...list) : null;
}
function metrics(measure) {
  return {involuntarySingle: spread(measure.staff.map(s => s.involuntarySingle)),
    attainmentPercentagePoints: spread(measure.staff.filter(s => s.attainment !== null).map(s => s.attainment * 100)),
    weeklyACWorst: measure.score[4], weeklyBCABWorst: measure.score[7]};
}
module.exports = {stats, spread, metrics};
