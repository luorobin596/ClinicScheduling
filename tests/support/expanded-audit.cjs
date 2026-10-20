'use strict';
const assert = require('node:assert/strict');
const {calendar} = require('./expanded-calendar.cjs');
const {coverageFindings} = require('./daily-coverage.cjs');
const {auditPairing} = require('./pairing-audit.cjs');
function audit(context, fixture, {minimum = false, pedsSnapshot = null} = {}) {
  const cal = calendar(fixture.month);
  assert.equal(context.days.length, cal.days.length);
  const actualByDay = new Map();
  for (const [index, day] of context.days.entries()) {
    const expected = cal.days[index];
    assert.equal(day.date, expected.date);
    assert.equal(day.isOpen, expected.isOpen);
    const people = new Map();
    for (const [shift, stations] of Object.entries(day.slots)) {
      assert.ok(day.isOpen, `Closed day has slots: ${day.date}`);
      assert.ok((day.dayOfWeek === 6 ? ['A', 'B'] : ['A', 'B', 'C']).includes(shift));
      const ids = [...stations.ORTHO.staff, ...stations.PEDS.staff];
      assert.equal(new Set(ids).size, ids.length, 'Same-shift duplicate');
      assert.ok(stations.ORTHO.staff.length <= (day.dayOfWeek === 6 && shift === 'B' ? 2 : 3));
      assert.ok(stations.PEDS.staff.length <= 1);
      for (const [station, slot] of Object.entries(stations)) {
        assert.deepEqual(Object.keys(slot.assignmentMeta).sort(), Array.from(slot.staff).sort(), 'Provenance/staff mismatch');
        for (const id of slot.staff) {
          assert.ok(fixture.staff.some(s => s.id === id), 'Unknown employee');
          if (!people.has(id)) people.set(id, []);
          people.get(id).push(shift);
          assert.ok(people.get(id).length <= 2, 'Daily maximum exceeded');
          assert.ok(slot.assignmentMeta[id].source, `Missing source: ${station}/${id}`);
        }
      }
    }
    actualByDay.set(day.date, people);
  }
  for (const event of fixture.events) {
    const actual = actualByDay.get(event.date).get(event.staff_id) || [];
    assert.deepEqual(actual.slice().sort(), (event.work || []).slice().sort(), `Intent changed: ${event.staff_id}/${event.date}`);
  }
  const peds = context.days.flatMap(day => Object.entries(day.slots).map(([shift, slots]) => [day.date, shift, Array.from(slots.PEDS.staff)]));
  if (pedsSnapshot) assert.deepEqual(peds, pedsSnapshot, 'PEDS moved during adjustments');
  const coverage = coverageFindings(context.days, {station: 'ORTHO'});
  if (minimum) assert.equal(coverage.length, 0, 'Minimum coverage missing');
  return {peds, pairing: auditPairing(context, fixture.staff), coverage};
}
// Independent expected pediatric owners from raw requests and configured patterns.
function auditPeds(context, fixture) {
  const definitions = [{id: 'FT003', shifts: [[1, 'C'], [4, 'C']]}, {id: 'FT002', shifts: [[3, 'C'], [4, 'B']]}];
  for (const day of context.days.filter(d => d.isOpen)) {
    for (const [shift, slots] of Object.entries(day.slots)) {
      const rule = definitions.find(r => r.shifts.some(([weekday, s]) => weekday === day.dayOfWeek && s === shift));
      let ids = [];
      if (rule) {
        const off = id => fixture.requests.some(r => r.date === day.date && r.staff_id === id && r.shift === shift && r.type === 'off');
        const id = !off(rule.id) ? rule.id : ['FT002', 'FT003'].find(id => id !== rule.id && !off(id));
        assert.ok(id, 'PEDS input conflict was not rejected');
        ids = [id];
      }
      assert.deepEqual(Array.from(slots.PEDS.staff), ids, `Incorrect pediatric owner: ${day.date}/${shift}`);
    }
  }
}
module.exports = {audit, auditPeds};
