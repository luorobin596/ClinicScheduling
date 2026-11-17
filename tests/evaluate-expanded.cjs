'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {engine} = require('./support/engine-harness.cjs');
const {summarizeWeeks} = require('./support/weekly-report.cjs');
const {audit, auditPeds, weekdayGaps, assertWeekdayWorkdays} = require('./support/expanded-audit.cjs');
const {hash, argumentsFor, integer, writeJSON, readJSON, loadManifest, contract, BUDGET} = require('./support/expanded-io.cjs');

function expectedConflictProbe(fixture) {
  // Isolate the intended negative Saturday; unrelated leave conflicts must not
  // masquerade as evidence that the engine identifies this specific conflict.
  const loaded = engine([], {staff: fixture.staff, settings: fixture.settings});
  const context = loaded.e.createContext(fixture.month);
  context.days = context.days.filter(d => d.date === fixture.scenario.saturday);
  loaded.assignments.prepare(context, fixture.requests.filter(r => r.date === fixture.scenario.saturday));
  assert.ok(context.days[0].isOpen && context.days[0].dayOfWeek === 6);
  try { loaded.adjustments.assertFeasible(context, fixture.staff); }
  catch (error) {
    assert.equal(error.code, 'INPUT_CONFLICT');
    assert.equal(error.details.date, fixture.scenario.saturday);
    assert.equal(error.details.requiredOrthoShiftCoverage, 1);
    return {code: error.code, details: error.details, scope: 'isolated-original-saturday-intent'};
  }
  throw new Error('Expected all-staff Saturday conflict was not identified');
}

function evaluate(fixture) {
  const start = Date.now();
  const run = {sampleId: fixture.sampleId, inputHash: fixture.inputHash, month: fixture.month,
    group: fixture.group, mode: fixture.mode, seed: fixture.seed, rank: fixture.rank,
    scenario: fixture.scenario, leaveSummary: fixture.leaveSummary,
    inputCoordination: fixture.sampling ? {policy: fixture.sampling.policy, rejectedCount: fixture.sampling.rejectedCount,
      acceptedAttempt: fixture.sampling.acceptedAttempt, candidateSeed: fixture.sampling.candidateSeed,
      rejectionCounts: fixture.sampling.rejectionCounts} : undefined};
  let stage = 'INITIAL', initial, repaired, workdayRepaired;
  try {
    if (fixture.scenario.expectedConflict) run.negativeProbe = expectedConflictProbe(fixture);
    const loaded = engine(fixture.requests, {staff: fixture.staff, settings: fixture.settings});
    const {e, fairness} = loaded;
    let firstAudit;
    const snapshot = context => {
      const measure = fairness.measure(context, fixture.staff);
      for (const person of measure.staff) {
        const systemDays = context.days.filter(day => day.systemRest?.includes(person.id));
        const originalCapacity = fixture.leaveSummary.find(s => s.id === person.id).expectedCapacityHours;
        const target = context.days.filter(day => day.dayOfWeek === 6).length * 8;
        const openHours = context.days.filter(day => day.isOpen).length * 8;
        assert.equal(systemDays.length, Math.max(0, Math.floor((target - (openHours - originalCapacity)) / 8)));
        assert.equal(person.capacityHours, originalCapacity - 8 * systemDays.length);
        for (const day of systemDays) {
          assert.ok(day.isOpen && !fixture.requests.some(r => r.date === day.date && r.staff_id === person.id));
          assert.ok(Object.values(day.slots).every(slots => Object.values(slots).every(slot => !slot.staff.includes(person.id))));
        }
      }
      return {measure, weekly: summarizeWeeks(context, fixture.staff)};
    };
    const gaps = context => weekdayGaps(context, fixture.staff, fixture.requests);
    const delivered = e.buildSchedule(fixture.month, {...BUDGET, onStage(next, context, report) {
      stage = next;
      if (next === 'INITIAL') {
        initial = repaired = workdayRepaired = null;
        for (const key of ['initial', 'repaired', 'workdayRepaired', 'saturday']) delete run[key];
        run.weekdayWorkdays = {schema: 'weekday-workdays-v2'};
      } else if (next === 'REPAIR') {
        initial = context;
        auditPeds(initial, fixture);
        firstAudit = audit(initial, fixture);
        run.initial = {...snapshot(initial), audit: firstAudit};
        run.saturday = initial.saturdayAllocationReport;
        run.weekdayWorkdays.initial = gaps(initial);
      } else if (next === 'WORKDAY_REPAIR') {
        repaired = context;
        run.repaired = {...snapshot(repaired), report, audit: audit(repaired, fixture, {minimum: true, pedsSnapshot: firstAudit.peds})};
        run.weekdayWorkdays.repaired = gaps(repaired);
      } else if (next === 'FAIRNESS') {
        workdayRepaired = context;
        run.workdayRepaired = {...snapshot(context), report, audit: audit(context, fixture, {minimum: true, pedsSnapshot: firstAudit.peds})};
        run.weekdayWorkdays.workdayRepaired = gaps(context);
        assert.equal(run.weekdayWorkdays.workdayRepaired.length, 0, 'Workday repair left weekday gaps');
      }
    }});
    const normal = delivered.normalSchedule;
    stage = 'AUDIT';
    run.weekdayWorkdays.final = gaps(delivered);
    assertWeekdayWorkdays(workdayRepaired, normal, fixture.staff);
    assert.equal(run.weekdayWorkdays.final.length, 0, 'Final roster has an available weekday without work');
    const finalAudit = audit(delivered, fixture, {minimum: true, pedsSnapshot: firstAudit.peds});
    const result = snapshot(normal);
    assert.ok(fairness.compareScores(result.measure.score, run.workdayRepaired.measure.score) <= 0);
    const extraHours = {};
    for (const [i, day] of delivered.days.entries()) {
      for (const [shift, slots] of Object.entries(day.slots)) for (const station of ['ORTHO', 'PEDS']) {
        const before = normal.days[i].slots[shift][station].staff;
        assert.equal(before.length, workdayRepaired.days[i].slots[shift][station].staff.length);
        assert.ok(before.every(id => slots[station].staff.includes(id)), 'Normal assignment lost during extra allocation');
        for (const id of slots[station].staff.filter(id => !before.includes(id))) {
          assert.equal(station, 'ORTHO');
          assert.ok(day.systemRest.includes(id));
          assert.equal(slots[station].assignmentMeta[id].source, 'SYSTEM_REST_EXTRA');
          extraHours[id] = (extraHours[id] || 0) + 4;
        }
      }
    }
    assert.deepEqual(extraHours, {...delivered.extraHours});
    run.final = {...result, report: normal.adjustmentReport.fairness, audit: finalAudit};
    run.extraHours = extraHours;
    run.roster = JSON.parse(JSON.stringify(delivered.days));
    if (fixture.scenario.expectedConflict) throw new Error('Negative input incorrectly accepted');
    run.status = 'VALID';
  } catch (error) {
    run.error = {code: error.code || 'EVALUATOR_ERROR', message: error.message, details: error.details, stage};
    if (error.code === 'INPUT_CONFLICT') {
      run.status = fixture.scenario.expectedConflict && run.negativeProbe ? 'EXPECTED_CONFLICT' : 'INPUT_CONFLICT';
    } else if (error.code === 'SEARCH_LIMIT') run.status = 'SEARCH_LIMIT';
    else if (error.code === 'COVERAGE_UNRESOLVED') run.status = 'COVERAGE_UNRESOLVED';
    else if (error.code === 'WORKDAY_UNRESOLVED') run.status = 'WORKDAY_UNRESOLVED';
    else if (error.code === 'SYSTEM_REST_UNRESOLVED') run.status = 'SYSTEM_REST_UNRESOLVED';
    else run.status = 'ERROR';
    if (initial) run.diagnosticRoster = JSON.parse(JSON.stringify((workdayRepaired || repaired || initial).days));
  }
  run.elapsedMs = Date.now() - start;
  return run;
}

function runShard({manifestFile, out, shards, shard, resume = false, formalSize, pilotReport}) {
  const manifest = loadManifest(manifestFile);
  if (manifest.inputPolicy !== 'COORDINATED_ORIGINAL_INTENT_V2' || manifest.fixtures.some(fixture =>
    fixture.sampling?.policy !== 'COORDINATED_ORIGINAL_INTENT_V2')) {
    throw new Error('200／5000／10000 組均需使用新版協調模型重新產生輸入；舊版凍結樣本只供歷史比較，不可接續本輪測試。');
  }
  if (manifest.size !== 200 && formalSize !== manifest.size) throw new Error('Formal execution requires --confirm-formal-size 5000 or 10000 after pilot review');
  assert.ok(Number.isInteger(shards) && shards > 0 && Number.isInteger(shard) && shard >= 0 && shard < shards);
  const identity = contract(manifest), identityHash = hash(identity);
  if (manifest.size !== 200) {
    if (!pilotReport) throw new Error('Formal execution requires --pilot-report after a passing cloud pilot and cost review');
    const pilot = readJSON(path.join(pilotReport, 'merged.json'));
    const cost = readJSON(path.join(pilotReport, 'cost-estimate.json'));
    assert.ok(pilot.size === 200 && pilot.completed && pilot.pilotPassed && cost.pilotPassed);
    assert.equal(hash(cost.identity), pilot.identityHash, 'Pilot cost report identity mismatch');
    for (const key of ['engineHash', 'toolsHash', 'node', 'timezone']) assert.equal(identity[key], pilot.identity[key], `Changed ${key}; rerun pilot`);
    assert.deepEqual(identity.budget, pilot.identity.budget, 'Changed search budgets; rerun pilot');
    assert.ok(cost.plans.some(plan => plan.size === manifest.size), 'Chosen size missing from cost report');
  }
  const dir = path.resolve(out, `shard-${String(shard).padStart(3, '0')}`);
  fs.mkdirSync(dir, {recursive: true});
  const selected = manifest.fixtures.filter((_, index) => index % shards === shard);
  const started = Date.now(), attempt = `${started}-${crypto.randomUUID()}`;
  let executed = 0, resumed = 0;
  const job = {schema: 'expanded-job-v1', attempt, identity, identityHash, shard, shards,
    expected: selected.map(f => f.sampleId), completed: false, executed: 0, resumed: 0};
  try {
    for (const fixture of selected) {
      const prefix = `result-${fixture.sampleId}-`;
      const previous = fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith('.json.gz'));
      if (previous.length && !resume) throw new Error(`Existing sample; use a new directory or --resume true: ${fixture.sampleId}`);
      if (resume && previous.length) {
        const records = previous.map(f => readJSON(path.join(dir, f)));
        if (records.some(r => r.identityHash !== identityHash || r.run.inputHash !== fixture.inputHash || r.runHash !== hash(r.run))) throw new Error('Cannot resume different or modified input/engine/environment/result');
        const last = records.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
        if (['VALID', 'INPUT_CONFLICT', 'EXPECTED_CONFLICT'].includes(last.run.status)) { resumed++; continue; }
      }
      const run = evaluate(fixture);
      writeJSON(path.join(dir, `${prefix}${attempt}.json.gz`), {
        schema: 'expanded-result-v1', identity, identityHash, createdAt: new Date().toISOString(), attempt, runHash: hash(run), run
      });
      executed++;
      console.log(`${executed + resumed}/${selected.length} ${run.sampleId}: ${run.status}`);
    }
    job.completed = true;
  } finally {
    Object.assign(job, {executed, resumed, elapsedMs: Date.now() - started});
    writeJSON(path.join(dir, `job-${attempt}.json`), job);
  }
  return job;
}
if (require.main === module) {
  const args = argumentsFor(process.argv.slice(2), ['--manifest', '--out', '--shards', '--shard', '--resume', '--confirm-formal-size', '--pilot-report']);
  if (!args['--manifest'] || !args['--out']) throw new Error('--manifest and --out are required');
  if (args['--resume'] && args['--resume'] !== 'true') throw new Error('--resume only accepts true');
  runShard({manifestFile: args['--manifest'], out: args['--out'],
    shards: integer(args['--shards'] || '1', 'shards', 1), shard: integer(args['--shard'] || '0', 'shard'),
    resume: args['--resume'] === 'true', formalSize: args['--confirm-formal-size'] ? integer(args['--confirm-formal-size'], 'formal size') : undefined,
    pilotReport: args['--pilot-report']});
}
module.exports = {evaluate, expectedConflictProbe, runShard};
