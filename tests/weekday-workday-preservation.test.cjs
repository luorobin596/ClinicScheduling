const {test} = require('node:test');
const assert = require('node:assert/strict');
const {engine} = require('./support/engine-harness.cjs');
const fixture = require('./fixtures/weekday-workday-preservation.cjs');
const {weekdayGaps, assertWeekdayWorkdays} = require('./support/expanded-audit.cjs');
const {fakeSheets} = require('./support/fake-sheets.cjs');
const options = {maxCandidates: 20000, maxAccepted: 200, timeLimitMs: 10000, now: () => 0};
const work = (day, id) => Object.values(day.slots).flatMap(s => Object.values(s)).some(s => s.staff.includes(id));
const lost = (before, after, staff) => before.days.filter(d => d.isOpen && d.dayOfWeek >= 1 && d.dayOfWeek <= 5)
  .flatMap(day => staff.filter(p => work(day, p.id) && !work(after.days.find(d => d.date === day.date), p.id))
    .map(p => ({date: day.date, id: p.id})));
function setup() {
  const loaded = engine(fixture.requests);
  const initial = loaded.e.generateInitialSchedule(fixture.month);
  const repaired = loaded.adjustments.repair(initial, initial.staffList, options).context;
  return {...loaded, initial, repaired, staff: initial.staffList};
}
const exchange = [
  {remove: {date: '2026-11-12', shift: 'B', station: 'ORTHO', id: 'FT005'},
    add: {date: '2026-11-12', shift: 'B', station: 'ORTHO', id: 'FT001'}, source: 'FAIRNESS_ADJUST'},
  {remove: {date: '2026-11-20', shift: 'C', station: 'ORTHO', id: 'FT001'},
    add: {date: '2026-11-20', shift: 'C', station: 'ORTHO', id: 'FT005'}, source: 'FAIRNESS_ADJUST'}
];

test('WP01 full user intent keeps every repaired weekday workday after fairness', () => {
  const {adjustments: a, repaired, staff} = setup();
  const original = JSON.stringify(repaired);
  const final = a.improve(repaired, staff, options).context;
  assert.equal(lost(repaired, final, staff).length, 0);
  assert.equal(JSON.stringify(repaired), original);
  assert.doesNotThrow(() => a.validate(final, staff, {requireMinimumCoverage: true, requireWeekdayWorkdays: true}));
});

test('WP02 reducing singles cannot justify losing the last weekday shift', () => {
  const {adjustments: a, repaired, staff, fairness: f} = setup();
  const oldCandidate = a.apply(repaired, exchange, staff, {requireMinimumCoverage: true});
  assert.ok(f.compareScores(f.measure(oldCandidate, staff).score, f.measure(repaired, staff).score) < 0);
  const protectedContext = a.protectWeekdayWorkdays(repaired, staff);
  const original = JSON.stringify(protectedContext);
  assert.throws(() => a.apply(protectedContext, exchange, staff, {requireMinimumCoverage: true}),
    e => e.code === 'INTERNAL_INVALID' && e.details.subcode === 'WEEKDAY_WORKDAY_LOST' && e.details.id === 'FT001');
  assert.equal(JSON.stringify(protectedContext), original);
});

test('WP03/04 complete same-day replacement and remaining pediatric work preserve a workday', () => {
  const {adjustments: a, repaired, staff} = setup();
  const c = a.protectWeekdayWorkdays(repaired, staff);
  const add = {date: '2026-11-20', shift: 'A', station: 'ORTHO', id: 'FT001'};
  // Vacate an A seat at the same time to stay under the cap; that donor still works B.
  const operations = [
    {remove: {...add, shift: 'C'}, add},
    {remove: {...add, id: 'FT002'}}
  ];
  assert.doesNotThrow(() => a.apply(c, operations, staff, {requireMinimumCoverage: true}));
  const day = c.days.find(d => d.date === '2026-11-30');
  const shift = Object.keys(day.slots).find(s => day.slots[s].ORTHO.staff.includes('FT003'));
  assert.doesNotThrow(() => a.apply(c, [{remove: {date: day.date, shift, station: 'ORTHO', id: 'FT003'}}], staff, {}));
});

test('WP05/06 baseline excludes closed days, Saturday and previously empty weekdays', () => {
  const loaded = engine([]);
  const c = loaded.e.createContext('2026-11');
  const staff = [{id: 'FT001'}];
  loaded.assignments.prepare(c, []);
  for (const date of ['2026-11-02', '2026-11-07']) {
    loaded.assignments.add(c.days.find(d => d.date === date), 'A', 'ORTHO', 'FT001', 'AUTO_TEST');
  }
  const protectedContext = loaded.adjustments.protectWeekdayWorkdays(c, staff);
  assert.equal(JSON.stringify(protectedContext.weekdayWorkdayBaseline), JSON.stringify([{date: '2026-11-02', id: 'FT001'}]));
  assert.doesNotThrow(() => loaded.adjustments.apply(protectedContext,
    [{remove: {date: '2026-11-07', shift: 'A', station: 'ORTHO', id: 'FT001'}}], staff, {}));
});

test('WP07 final validation requires a baseline and catches tampering without recalibrating it', () => {
  const {adjustments: a, repaired, staff} = setup();
  assert.throws(() => a.validate(repaired, staff, {requireWeekdayWorkdays: true}), /工作日基準/);
  const c = a.protectWeekdayWorkdays(repaired, staff);
  const broken = a.apply(repaired, exchange, staff, {requireMinimumCoverage: true});
  broken.weekdayWorkdayBaseline = c.weekdayWorkdayBaseline;
  assert.throws(() => a.validate(broken, staff, {requireWeekdayWorkdays: true}), e => e.details.subcode === 'WEEKDAY_WORKDAY_LOST');
  assert.throws(() => a.improve(broken, staff, options), e => e.details.subcode === 'WEEKDAY_WORKDAY_LOST');
  assert.ok(Object.isFrozen(c.weekdayWorkdayBaseline));
});

test('WP03 audit independently detects lost workdays even without the production baseline', () => {
  const {adjustments: a, repaired, staff} = setup();
  const broken = a.apply(repaired, exchange, staff, {requireMinimumCoverage: true});
  assert.equal(broken.weekdayWorkdayBaseline, undefined);
  assert.throws(() => assertWeekdayWorkdays(repaired, broken, staff), /FT001.*2026-11-20/);
  const gaps = weekdayGaps(broken, staff, fixture.requests);
  assert.deepEqual(gaps, [{date: '2026-11-20', id: 'FT001'}]);
  assert.deepEqual(weekdayGaps(repaired, staff, fixture.requests), []);
});

test('WP07 final pipeline rejects a lost weekday even if candidate filtering was bypassed', () => {
  const fake = fakeSheets([['header'], ['description'], ['2026-11', 'old schedule']]);
  const loaded = engine(fixture.requests, {final: true, save: true, spreadsheet: fake.spreadsheet});
  const a = loaded.adjustments;
  a.improve = (context, staff) => {
    const baseline = a.protectWeekdayWorkdays(context, staff).weekdayWorkdayBaseline;
    const broken = a.apply(context, exchange, staff, {requireMinimumCoverage: true});
    broken.weekdayWorkdayBaseline = baseline;
    return {context: broken, report: {after: loaded.fairness.measure(broken, staff)}};
  };
  assert.throws(() => loaded.e.generateSchedule(fixture.month, options),
    e => e.code === 'INTERNAL_INVALID' && e.details.subcode === 'WEEKDAY_WORKDAY_LOST');
  assert.equal(fake.operations.length, 0);
});
