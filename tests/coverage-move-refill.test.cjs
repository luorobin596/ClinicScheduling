const {test} = require('node:test');
const assert = require('node:assert/strict');
const {engine} = require('./support/engine-harness.cjs');
const fixture = require('./fixtures/coverage-move-refill.cjs');
const options = {maxCandidates: 20000, maxAccepted: 200, timeLimitMs: 10000, now: () => 0};
const pos = (shift, id) => ({date: '2026-11-19', shift, station: 'ORTHO', id});
const move = {remove: pos('A', 'FT002'), add: pos('C', 'FT002'), source: 'COVERAGE_REPAIR'};
const refill = {add: pos('A', 'FT003'), source: 'COVERAGE_REPAIR'};
function initial() {
  const loaded = engine(fixture.requests, {staff: fixture.staff, settings: fixture.settings});
  return {...loaded, context: loaded.e.generateInitialSchedule(fixture.month)};
}

test('CR01 frozen full-month failure repairs without changing intent or pediatric shifts', () => {
  const {context, adjustments: a} = initial();
  const before = JSON.stringify(context);
  const result = a.repair(context, fixture.staff, options);
  assert.equal(a.coverage(result.context).length, 0);
  assert.equal(JSON.stringify(context), before);
  assert.equal(result.report.moveRefillAccepted, 1);
  const day = result.context.days.find(d => d.date === '2026-11-19');
  assert.deepEqual(Array.from(day.slots.A.ORTHO.staff), ['FT003']);
  assert.deepEqual(Array.from(day.slots.C.ORTHO.staff), ['FT002']);
  assert.deepEqual(Array.from(day.slots.B.PEDS.staff), ['FT002']);
  assert.deepEqual(Array.from(day.slots.C.PEDS.staff), ['FT003']);
  assert.doesNotThrow(() => a.validate(result.context, fixture.staff, {requireMinimumCoverage: true}));
  assert.equal(result.context.adjustmentHistory.at(-1).operations.length, 2);
  assert.equal(day.slots.C.ORTHO.assignmentMeta.FT002.originalSource, 'AUTO_A_PHASE3');
  assert.equal(day.slots.A.ORTHO.assignmentMeta.FT003.source, 'COVERAGE_REPAIR');
});

test('CR02/03 atomic move+refill succeeds while the isolated move and third daily shift fail', () => {
  const {context, adjustments: a} = initial();
  assert.throws(() => a.apply(context, [move], fixture.staff, {requireMinimumCoverage: true}));
  assert.throws(() => a.apply(context, [{add: pos('C', 'FT002')}], fixture.staff, {}));
  assert.doesNotThrow(() => a.apply(context, [move, refill], fixture.staff, {requireMinimumCoverage: true}));
});

test('CR04 invalid or locked replacements never mutate the original context', () => {
  const {context, adjustments: a} = initial();
  const before = JSON.stringify(context);
  for (const id of ['FT001', 'FT004', 'FT005', 'FT002']) {
    assert.throws(() => a.apply(context, [move, {add: pos('A', id)}], fixture.staff, {}));
  }
  assert.throws(() => a.apply(context, [{remove: pos('B', 'FT001'), add: pos('C', 'FT001')}], fixture.staff, {}));
  assert.equal(JSON.stringify(context), before);
});

test('CR06 new candidates share the search budget and deterministic order', () => {
  const {context, adjustments: a} = initial();
  assert.throws(() => a.repair(context, fixture.staff, {...options, maxCandidates: 0}), e => e.code === 'SEARCH_LIMIT');
  const first = a.repair(context, fixture.staff, options);
  const second = a.repair(context, fixture.staff, options);
  assert.equal(JSON.stringify(first.context.days), JSON.stringify(second.context.days));
  assert.equal(first.report.evaluated, second.report.evaluated);
  assert.ok(first.report.evaluated <= options.maxCandidates);
});

test('CR01 full production pipeline completes the frozen month including fairness and final validation', () => {
  const loaded = engine(fixture.requests, {staff: fixture.staff, settings: fixture.settings, final: true});
  const result = loaded.e.generateSchedule(fixture.month, options);
  assert.equal(loaded.adjustments.coverage(result).length, 0);
  assert.equal(result.adjustmentReport.repair.moveRefillAccepted, 1);
  assert.ok(result.weekdayWorkdayBaseline.length > 0);
  assert.doesNotThrow(() => loaded.adjustments.validate(result, fixture.staff,
    {requireMinimumCoverage: true, requireWeekdayWorkdays: true}));
});
