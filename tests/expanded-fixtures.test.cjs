'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {calendar} = require('./support/expanded-calendar.cjs');
const {descriptors, generateFixture, hash} = require('./support/expanded-fixtures.cjs');
const {generate} = require('./generate-expanded-inputs.cjs');

test('EX02: manifest counts and nested identities match all three proposed scales', () => {
  const pilot = descriptors(200), small = descriptors(5000), large = descriptors(10000);
  const lookup = new Map(large.map(row => [row.sampleId, row]));
  for (const [rows, size] of [[pilot, 200], [small, 5000], [large, 10000]]) {
    assert.equal(rows.length, size);
    assert.equal(new Set(rows.map(r => r.sampleId)).size, size);
    assert.equal(rows.filter(r => r.group === 'negative-saturday').length, size * 0.04);
    for (const row of rows) assert.deepEqual(row, lookup.get(row.sampleId));
  }
  const smallIds = new Set(small.map(r => r.sampleId));
  assert.ok(pilot.every(r => smallIds.has(r.sampleId)));
  for (const month of ['2026-09', '2026-10', '2026-11']) {
    const rows = pilot.filter(r => r.month === month);
    assert.equal(rows.filter(r => r.group !== 'negative-saturday').length, 64);
    for (const group of ['random', 'one-extra-week', 'two-same-week', 'two-different-weeks', 'saturday']) {
      for (const mode of ['full', 'half', 'mixed']) assert.equal(rows.filter(r => r.group === group && r.mode === mode).length, 4);
    }
  }
});

test('EX02: leave budgets, original intents and extra-week semantics are independent of outcomes', () => {
  for (const row of descriptors(200)) {
    const fixture = generateFixture(row), cal = calendar(row.month);
    assert.deepEqual(fixture, generateFixture(row), 'Same descriptor changed the frozen intent');
    for (const summary of fixture.leaveSummary) {
      const own = fixture.events.filter(e => e.staff_id === summary.id);
      assert.equal(new Set(own.map(e => e.date)).size, own.length);
      assert.ok(own.every(e => cal.days.some(d => d.date === e.date && d.isOpen)));
      assert.equal(summary.totalDaysOff, cal.fixedClosedDays + summary.leaveUnits / 2);
      assert.equal(summary.expectedCapacityHours, cal.days.filter(d => d.isOpen).length * 8 - summary.leaveUnits * 4);
      const week = fixture.scenario.weekly.find(w => w.id === summary.id);
      if (week?.extraWholeWeek) {
        assert.equal(summary.extraUnits, week.openDays * 2);
        assert.equal(own.filter(e => e.allocation === 'basic').reduce((sum, e) => sum + (e.kind === 'full' ? 2 : 1), 0), 8);
        assert.ok(own.filter(e => e.allocation === 'basic').every(e => e.date < week.start || e.date > week.end));
      } else assert.equal(summary.leaveUnits, Math.max(8, (week?.openDays || 0) * 2));
      for (const event of own.filter(e => e.kind === 'half')) {
        const requests = fixture.requests.filter(r => r.staff_id === summary.id && r.date === event.date);
        assert.equal(requests.filter(r => r.type === 'fixed').length, 1);
        assert.equal(requests.filter(r => r.type === 'off').length, 2);
        if (cal.days.find(d => d.date === event.date).weekday === 6) assert.notEqual(event.work[0], 'C');
      }
    }
  }
});

test('EX02: legal pair/week rotations and exact Saturday absentee counts', () => {
  const seenSingle = new Set();
  for (const row of descriptors(200)) {
    const fixture = generateFixture(row), weeks = fixture.scenario.weekly;
    if (weeks.length === 1) seenSingle.add(weeks[0].id);
    if (row.group === 'two-same-week') {
      assert.equal(weeks[0].start, weeks[1].start);
      assert.notEqual(weeks.map(w => w.id).sort().join(','), 'FT002,FT003');
    }
    if (row.group === 'two-different-weeks') assert.notEqual(weeks[0].start, weeks[1].start);
    if (fixture.scenario.saturday) {
      const day = fixture.scenario.saturday;
      assert.equal(fixture.events.filter(e => e.date === day && e.kind === 'full').length,
        row.group === 'negative-saturday' ? 5 : 2 + (row.rank % 100 + ['full', 'half', 'mixed'].indexOf(row.mode) + ['2026-09', '2026-10', '2026-11'].indexOf(row.month)) % 3);
      assert.equal(calendar(row.month).days.find(d => d.date === day).isOpen, true);
    }
  }
  assert.equal(seenSingle.size, 5);
});

test('EX02: serialized fixture and manifest hashes are reproducible', () => {
  const manifest = generate(200);
  assert.equal(manifest.inputHash, hash(manifest.fixtures));
  for (const fixture of manifest.fixtures) assert.equal(fixture.inputHash, hash({...fixture, inputHash: undefined}));
});
