'use strict';
process.env.TZ = 'Asia/Taipei';
const test = require('node:test');
const assert = require('node:assert/strict');
const {descriptors, generateFixture} = require('./support/expanded-fixtures.cjs');
const {evaluate, expectedConflictProbe} = require('./evaluate-expanded.cjs');
const {stats} = require('./support/expanded-statistics.cjs');
const {calendar} = require('./support/expanded-calendar.cjs');
const {engine} = require('./support/engine-harness.cjs');
const {summarizeWeeks} = require('./support/weekly-report.cjs');

test('EX03: each negative pilot input identifies its actual Saturday conflict', () => {
  for (const row of descriptors(200).filter(r => r.group === 'negative-saturday')) {
    const fixture = generateFixture(row);
    const proof = expectedConflictProbe(fixture);
    assert.equal(proof.code, 'INPUT_CONFLICT');
    assert.equal(proof.details.date, fixture.scenario.saturday);
    assert.equal(proof.details.availableOrthoShiftCapacity, 0);
  }
});
test('EX03: clean month crosses the real evaluator and independent audit without Google writes', () => {
  const fixture = generateFixture(descriptors(200).find(r => r.month === '2026-11' && r.group === 'random'));
  fixture.events = []; fixture.requests = [];
  const capacity = calendar(fixture.month).days.filter(d => d.isOpen).length * 8;
  fixture.leaveSummary = fixture.staff.map(s => ({id: s.id, expectedCapacityHours: capacity}));
  const result = evaluate(fixture);
  assert.equal(result.status, 'VALID', JSON.stringify(result.error));
  assert.equal(result.final.audit.coverage.length, 0);
  assert.ok(result.final.audit.pairing.every(d => d.actualAB === d.maxAB));
});
test('EX04: observed spread statistics preserve tails and exclude N/A', () => {
  assert.deepEqual(stats([null, 0, 1, 2, 100]), {n: 4, mean: 25.75, median: 1.5, p90: 100, p95: 100, min: 0, max: 100});
  assert.equal(stats([null, undefined]), null);
});
test('EX04: October substitute holidays produce calendar short weeks independently of personal leave', () => {
  const loaded = engine([], {settings: {closedDates: calendar('2026-10').closedDates}});
  const context = loaded.e.createContext('2026-10');
  context.submittedStaffIds = ['FT001'];
  loaded.assignments.prepare(context, []);
  const weeks = summarizeWeeks(context, [{id: 'FT001'}])[0].weeks;
  assert.deepEqual(weeks.map(w => w.openWeekdays), [2, 4, 5, 5, 4]);
  assert.deepEqual(weeks.map(w => w.shortWeek), [true, true, false, false, true]);
});
