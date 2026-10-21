const {test} = require('node:test');
const assert = require('node:assert/strict');
const {engine} = require('./support/engine-harness.cjs');
const {weekdayGaps} = require('./support/expanded-audit.cjs');
const fixtures = require('./fixtures/weekday-workday-repair.cjs');
const options = {maxCandidates: 20000, maxAccepted: 200, timeLimitMs: 10000, now: () => 0};

test('WD01 frozen one-day and two-day weeks no longer leave FT002 unassigned', () => {
  let swaps = 0;
  for (const fixture of fixtures) {
    const x = engine(fixture.requests, {staff: fixture.staff, settings: fixture.settings});
    const initial = x.e.generateInitialSchedule(fixture.month);
    const covered = x.adjustments.repair(initial, fixture.staff, options).context;
    assert.ok(weekdayGaps(covered, fixture.staff, fixture.requests).some(g => g.id === 'FT002'));
    const original = JSON.stringify(covered);
    const repaired = x.adjustments.repairWorkdays(covered, fixture.staff, options);
    assert.deepEqual(weekdayGaps(repaired.context, fixture.staff, fixture.requests), []);
    assert.equal(JSON.stringify(covered), original);
    assert.ok(repaired.report.accepted > 0);
    swaps += repaired.report.swapsAccepted;
    assert.doesNotThrow(() => x.adjustments.validate(repaired.context, fixture.staff,
      {requireMinimumCoverage: true, requireAllWeekdayWorkdays: true}));
  }
  assert.ok(swaps > 0, 'A two-slot exchange can fill two people’s missing workdays at once');
});

function dayFixture(date = '2026-11-02', requests = []) {
  const staff = ['FT001', 'FT002', 'FT003'].map(id => ({id}));
  const x = engine(requests, {staff, settings: {pedsAssignments: {}}});
  const context = x.e.createContext('2026-11');
  context.days = context.days.filter(d => d.date === date);
  context.submittedStaffIds = staff.map(p => p.id);
  x.assignments.prepare(context, requests);
  const add = (shift, id, origin = 'AUTO') => x.assignments.add(context.days[0], shift, 'ORTHO', id,
    'AUTO_TEST', origin, origin === 'AUTO' ? [] : ['STAFF_REQUEST']);
  add('A', 'FT001'); add('B', 'FT001'); add('C', 'FT002');
  return {...x, context, staff, add};
}

test('WD02 transfer from a double preserves slot counts instead of adding a new shift', () => {
  const x = dayFixture();
  const result = x.adjustments.repairWorkdays(x.context, x.staff, options);
  assert.equal(result.report.transfersAccepted, 1);
  assert.equal(result.report.additionsAccepted, 0);
  for (const s of ['A', 'B', 'C']) assert.equal(result.context.days[0].slots[s].ORTHO.staff.length, 1);
  assert.equal(x.adjustments.workdayGaps(result.context, x.staff).length, 0);
});

test('WD02 locked donors remain fixed, so a lawful new shift is the fallback', () => {
  const x = dayFixture();
  for (const s of ['A', 'B']) x.context.days[0].slots[s].ORTHO.assignmentMeta.FT001.lockReasons.push('STAFF_REQUEST');
  const result = x.adjustments.repairWorkdays(x.context, x.staff, options);
  assert.equal(result.report.additionsAccepted, 1);
  assert.equal(result.report.transfersAccepted, 0);
  assert.ok(result.context.days[0].slots.A.ORTHO.staff.includes('FT001'));
  assert.ok(result.context.days[0].slots.B.ORTHO.staff.includes('FT001'));
});

test('WD02 no shifting a gap to someone else; full leave, Saturday and holidays are exempt', () => {
  const x = dayFixture();
  const only = x.adjustments.apply(x.context, [{remove: {date: '2026-11-02', shift: 'C', station: 'ORTHO', id: 'FT002'},
    add: {date: '2026-11-02', shift: 'C', station: 'ORTHO', id: 'FT003'}}], x.staff, {});
  assert.equal(x.adjustments.workdayGaps(only, x.staff).length, 1);
  const result = x.adjustments.repairWorkdays(x.context, x.staff, options);
  assert.ok(result.context.days[0].slots.C.ORTHO.staff.includes('FT002'));
  const y = dayFixture('2026-11-02', ['A','B','C'].map(shift => ({staff_id: 'FT003', date: '2026-11-02', shift, type: 'off'})));
  assert.equal(y.adjustments.workdayGaps(y.context, y.staff).length, 0);
  const c = engine([]).e.createContext('2026-11');
  c.days = c.days.filter(d => d.dayOfWeek === 0 || d.dayOfWeek === 6);
  c.constraints = {off: {}, fixed: {}, peds: {}};
  assert.equal(x.adjustments.workdayGaps(c, x.staff).length, 0);
});

test('WD03 incomplete workday repair throws with diagnostics and never mutates input', () => {
  const x = dayFixture(), before = JSON.stringify(x.context);
  assert.throws(() => x.adjustments.repairWorkdays(x.context, x.staff, {...options, maxCandidates: 0}),
    e => e.code === 'SEARCH_LIMIT' && e.details.stage === 'WORKDAY_REPAIR' && e.details.findings[0].id === 'FT003');
  assert.equal(JSON.stringify(x.context), before);
  assert.throws(() => x.adjustments.repairWorkdays(x.context, x.staff, {...options, now: () => 10, deadline: 5}),
    e => e.code === 'SEARCH_LIMIT' && e.details.report.stopReason === 'TIME_LIMIT');
  assert.throws(() => x.adjustments.validate(x.context, x.staff, {requireAllWeekdayWorkdays: true}),
    e => e.code === 'WORKDAY_UNRESOLVED');
});

test('WD03 unavailable replacement seats report WORKDAY_UNRESOLVED rather than a false input impossibility', () => {
  const requests = ['B','C'].map(shift => ({staff_id: 'FT003', date: '2026-11-02', shift, type: 'off'}));
  const x = engine(requests, {settings: {pedsAssignments: {}}});
  const context = x.e.createContext('2026-11');
  context.days = context.days.filter(d => d.date === '2026-11-02');
  const staff = [1,2,3,4,5].map(i => ({id: `FT00${i}`}));
  context.submittedStaffIds = staff.map(s => s.id);
  x.assignments.prepare(context, requests);
  for (const [shift, id] of [['A','FT001'],['A','FT004'],['A','FT005'],['B','FT001'],['C','FT002']]) {
    x.assignments.add(context.days[0], shift, 'ORTHO', id, 'FT_FIXED', 'STAFF_REQUEST', ['STAFF_REQUEST']);
  }
  assert.throws(() => x.adjustments.repairWorkdays(context, staff, options), e =>
    e.code === 'WORKDAY_UNRESOLVED' && e.details.stage === 'WORKDAY_REPAIR' &&
    e.details.blockers[0].slots.find(s => s.shift === 'A').count === 3);
});

test('WD01 full pipeline includes workday repair and final nonempty weekday validation', () => {
  const fixture = fixtures[0];
  const x = engine(fixture.requests, {staff: fixture.staff, settings: fixture.settings, final: true});
  const result = x.e.generateSchedule(fixture.month, options);
  assert.deepEqual(weekdayGaps(result, fixture.staff, fixture.requests), []);
  assert.equal(result.adjustmentReport.workdayRepair.stopReason, 'WORKDAYS_SATISFIED');
  assert.ok(result.adjustmentReport.workdayRepair.accepted > 0);
});
