'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {calendar} = require('./support/expanded-calendar.cjs');

test('EX01: holidays, Sunday deduplication and discretionary leave match clinic agreement', () => {
  const expected = {'2026-09': [30, 8, 2, 10, 6], '2026-10': [31, 9, 2, 11, 7], '2026-11': [30, 9, 0, 9, 5]};
  for (const [month, [days, weekends, holidays, basic, closed]] of Object.entries(expected)) {
    const cal = calendar(month);
    assert.equal(cal.days.length, days);
    assert.equal(cal.weekendDays, weekends);
    assert.equal(cal.weekdayHolidays, holidays);
    assert.equal(cal.basicDaysOff, basic);
    assert.equal(cal.fixedClosedDays, closed);
    assert.equal(cal.discretionaryUnits, 8);
    assert.ok(cal.fullWeeks.every(w => w.length === 7 && w[0].weekday === 0 && w[6].weekday === 6));
  }
});
test('EX01: substitute holidays close but ordinary Saturdays stay open', () => {
  const days = calendar('2026-10').days;
  for (const day of ['09', '10', '25', '26']) assert.equal(days.find(d => d.date.endsWith(`-${day}`)).isOpen, false);
  for (const day of ['03', '17', '24', '31']) assert.equal(days.find(d => d.date.endsWith(`-${day}`)).isOpen, true);
  assert.throws(() => calendar('2026-12'), /Unsupported/);
});
