'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {calendar} = require('./support/expanded-calendar.cjs');
const {descriptors, generateFixture, generateCandidate, hash} = require('./support/expanded-fixtures.cjs');
const {inspectOriginalIntent} = require('./support/expanded-input-screen.cjs');
const {toRequests} = require('./support/leave-model.cjs');
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
  assert.equal(manifest.inputPolicy, 'COORDINATED_ORIGINAL_INTENT_V2');
  assert.equal(manifest.sampling.accepted, 200);
  assert.equal(manifest.inputHash, hash(manifest.fixtures));
  for (const fixture of manifest.fixtures) assert.equal(fixture.inputHash, hash({...fixture, inputHash: undefined}));
});

test('EX02: coordinated pilot inputs obey raw PEDS and daily feasibility before freezing', () => {
  for (const descriptor of descriptors(200)) {
    const fixture = generateFixture(descriptor);
    assert.equal(fixture.sampling.policy, 'COORDINATED_ORIGINAL_INTENT_V2');
    assert.equal(fixture.sampling.rejectedCount, fixture.sampling.rejected.length);
    assert.equal(inspectOriginalIntent(fixture).accepted, true);
    assert.equal(fixture.sampling.allowedConflictDate, fixture.scenario.expectedConflict ? fixture.scenario.saturday : null);
    for (const rejected of fixture.sampling.rejected) {
      const original = generateCandidate(descriptor, rejected.candidateSeed);
      assert.equal(hash(original.requests), rejected.requestHash);
      assert.equal(inspectOriginalIntent(original).accepted, false);
    }
  }
});

test('EX02: known prior pediatric collision is rejected, and coordination has a hard limit', () => {
  const row = descriptors(200).find(row => row.sampleId === '2026-09_random_full_0000');
  const old = generateCandidate(row);
  const result = inspectOriginalIntent(old);
  assert.equal(result.accepted, false);
  assert.match(result.reason.message, /小兒代班衝突/);
  assert.throws(() => generateFixture(row, {maxAttempts: 1}), error =>
    error.code === 'INPUT_GENERATION_EXHAUSTED' && error.details.rejected.length === 1);
  const accepted = generateFixture(row);
  assert.equal(accepted.scenario.weekly.length, old.scenario.weekly.length);
  assert.equal(accepted.sampleId, old.sampleId);
  assert.equal(accepted.seed, old.seed);
  assert.ok(accepted.sampling.rejectedCount >= 1);
});

test('EX02: all three scales share coordinated generation, including samples beyond the pilot', () => {
  // Probe every month/mode/scenario at ranks not included in the 200-case pilot.
  for (const size of [200, 5000, 10000]) {
    const rows = descriptors(size);
    const boundaries = new Map();
    for (const row of rows) boundaries.set(`${row.month}/${row.group}/${row.mode}`, row);
    for (const row of boundaries.values()) {
      const fixture = generateFixture(row);
      assert.equal(fixture.sampling.policy, 'COORDINATED_ORIGINAL_INTENT_V2');
      assert.equal(inspectOriginalIntent(fixture).accepted, true);
      assert.deepEqual(fixture, generateFixture(row));
    }
  }
});

test('EX02: negative exemption applies only to its designated Saturday, not pediatric collisions elsewhere', () => {
  const row = descriptors(200).find(row => row.month === '2026-09' && row.group === 'negative-saturday');
  const fixture = generateCandidate(row);
  const target = fixture.scenario.saturday;
  fixture.requests = toRequests(fixture.staff.map(s => ({staff_id: s.id, date: target, kind: 'full'})));
  assert.deepEqual(inspectOriginalIntent(fixture), {accepted: true, allowedConflictDate: target});
  fixture.requests.push(...toRequests(['FT002', 'FT003'].map(id => ({staff_id: id, date: '2026-09-07', kind: 'full'}))));
  const result = inspectOriginalIntent(fixture);
  assert.equal(result.accepted, false);
  assert.match(result.reason.message, /小兒代班衝突/);
  assert.equal(result.reason.details.date, '2026-09-07');
});
