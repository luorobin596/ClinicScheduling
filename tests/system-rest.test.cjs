const test = require('node:test');
const assert = require('node:assert/strict');
const {engine} = require('./support/engine-harness.cjs');

test('weekly single concentration breaks ties after monthly hours', () => {
  const {fairness} = engine();
  const person = counts => ({involuntarySingle: 4, attainment: 1,
    weekly: counts.map(involuntarySingle => ({involuntarySingle, AC: 0, BC: 0, AB: 0}))});
  const weeks = [0, 1, 2, 3];
  assert.equal(fairness.compareScores(fairness.scoreStaff([person([1, 1, 1, 1])], weeks),
    fairness.scoreStaff([person([4, 0, 0, 0])], weeks)), -1);
});

test('system rest uses only full eight-hour deficits and preserves the pre-extra roster', () => {
  const off = (id, date) => ['A', 'B', 'C'].map(shift => ({staff_id: id, date, shift, type: 'off'}));
  const half = ['A', 'B', 'C'].map(shift => ({staff_id: 'FT001', date: '2026-11-25', shift, type: shift === 'A' ? 'fixed' : 'off'}));
  const requests = [...off('FT001', '2026-11-02'), ...off('FT001', '2026-11-09'), ...off('FT001', '2026-11-16'), ...half,
    ...off('FT002', '2026-11-03'), ...off('FT002', '2026-11-10'), ...off('FT002', '2026-11-17')];
  const {e} = engine(requests, {submittedStaffIds: ['FT001', 'FT002'], settings: {closedDates: ['2026/11/07']}});
  const context = e.generateFinalSchedule('2026-11');
  assert.equal(context.days.filter(d => d.systemRest?.includes('FT001')).length, 0);
  const rest = context.days.filter(d => d.systemRest?.includes('FT002'));
  assert.equal(rest.length, 1);
  assert.ok(rest[0].isOpen);
  assert.equal(context.normalSchedule.days.find(d => d.date === rest[0].date).slots.A.ORTHO.staff.includes('FT002'), false);
  assert.equal(context.adjustmentReport.fairnessAdjusted.staff.find(p => p.id === 'FT002').capacityHours, 160);
});

test('remaining slots form a double for the employee with lower pre-extra attainment', () => {
  const staff = Array.from({length: 6}, (_, i) => ({id: 'FT00' + (i + 1)}));
  const {e, assignments, adjustments, fairness} = engine([], {staff});
  const normal = e.createContext('2026-11');
  normal.staffList = staff;
  normal.submittedStaffIds = staff.map(person => person.id);
  normal.days = normal.days.filter(day => day.date === '2026-11-03');
  const requests = staff.slice(0, 2).flatMap(person => ['A', 'B', 'C'].map(shift => ({
    staff_id: person.id, date: '2026-11-03', shift, type: 'off'
  })));
  e._fillFixedShifts(normal, {}, requests);
  const day = normal.days[0];
  day.systemRest = ['FT001', 'FT002'];
  for (const [shift, ids] of Object.entries({A: ['FT003', 'FT004', 'FT005'], B: ['FT003', 'FT006'], C: ['FT004', 'FT005']})) {
    for (const id of ids) assignments.add(day, shift, 'ORTHO', id, 'AUTO_TEST');
  }
  const protectedNormal = adjustments.protectWeekdayWorkdays(normal, staff);
  protectedNormal.adjustmentReport = {fairnessAdjusted: fairness.measure(normal, staff)};
  protectedNormal.adjustmentReport.fairnessAdjusted.staff[0].attainment = 0.9;
  protectedNormal.adjustmentReport.fairnessAdjusted.staff[1].attainment = 0.8;
  const final = e._fillExtraShifts(protectedNormal);
  assert.deepEqual({...final.extraHours}, {FT002: 8});
  for (const shift of ['B', 'C']) {
    assert.equal(final.days[0].slots[shift].ORTHO.assignmentMeta.FT002.source, 'SYSTEM_REST_EXTRA');
    assert.ok(!day.slots[shift].ORTHO.staff.includes('FT002'));
  }
  assert.equal(final.normalSchedule.adjustmentReport.fairnessAdjusted.staff[1].hours, 0);
});

test('all enabled closed_dates rows accumulate and deduplicate calendar closures', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const {box, e} = engine();
  const rows = [
    [],
    ['', 'closed_dates', '2026-11-04, 2026-11-07', '', '', '', true],
    ['', 'closed_dates', '2026-11-04', '2026-11-12', '', '', true],
    ['', 'closed_dates', '2026-11-13', '', '', '', false]
  ];
  const fresh = vm.createContext({Session: box.Session, Utilities: {
    formatDate: (date, zone, format) => box.Utilities.formatDate(date, zone === 'GMT+8' ? 'Asia/Taipei' : zone, format)
  }});
  vm.runInContext(fs.readFileSync('GAS/Config_system.js', 'utf8'), fresh);
  fresh.getDbSpreadsheet = () => ({getSheetByName: name => {
    assert.equal(name, 'System_Configurations');
    return {getDataRange: () => ({getValues: () => rows})};
  }});
  box.RulesConfig.loadDynamicConfig = fresh.RulesConfig.loadDynamicConfig;
  const context = e.createContext('2026-11');
  assert.deepEqual(Array.from(context.settings.closedDates), ['2026/11/04', '2026/11/07', '2026/11/12']);
  for (const date of ['2026-11-04', '2026-11-07', '2026-11-12']) {
    assert.equal(context.days.find(day => day.date === date).isOpen, false);
  }
  assert.equal(context.days.find(day => day.date === '2026-11-13').isOpen, true);
});
