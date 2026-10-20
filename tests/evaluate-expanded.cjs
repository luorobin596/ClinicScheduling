'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {engine} = require('./support/engine-harness.cjs');
const {summarizeWeeks} = require('./support/weekly-report.cjs');
const {audit, auditPeds} = require('./support/expanded-audit.cjs');
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
    scenario: fixture.scenario, leaveSummary: fixture.leaveSummary};
  let stage = 'INITIAL', initial, repaired;
  try {
    if (fixture.scenario.expectedConflict) run.negativeProbe = expectedConflictProbe(fixture);
    const loaded = engine(fixture.requests, {staff: fixture.staff, settings: fixture.settings});
    const {e, adjustments, fairness} = loaded;
    initial = e.generateInitialSchedule(fixture.month);
    const snapshot = context => {
      const measure = fairness.measure(context, fixture.staff);
      for (const person of measure.staff) assert.equal(person.capacityHours,
        fixture.leaveSummary.find(s => s.id === person.id).expectedCapacityHours, 'Capacity diverged from original leave');
      return {measure, weekly: summarizeWeeks(context, fixture.staff)};
    };
    adjustments.validate(initial, fixture.staff);
    auditPeds(initial, fixture);
    const firstAudit = audit(initial, fixture);
    run.initial = {...snapshot(initial), audit: firstAudit};
    run.saturday = initial.saturdayAllocationReport;
    const options = {...BUDGET, deadline: Date.now() + BUDGET.timeLimitMs};
    stage = 'REPAIR';
    repaired = adjustments.repair(initial, fixture.staff, options);
    run.repaired = {...snapshot(repaired.context), report: repaired.report,
      audit: audit(repaired.context, fixture, {minimum: true, pedsSnapshot: firstAudit.peds})};
    stage = 'FAIRNESS';
    const final = adjustments.improve(repaired.context, fixture.staff, options);
    stage = 'AUDIT';
    adjustments.validate(final.context, fixture.staff, {requireMinimumCoverage: true});
    const finalAudit = audit(final.context, fixture, {minimum: true, pedsSnapshot: firstAudit.peds});
    assert.ok(fairness.compareScores(final.report.after.score, run.repaired.measure.score) <= 0);
    for (const [i, day] of final.context.days.entries()) {
      for (const [shift, slots] of Object.entries(day.slots)) for (const station of ['ORTHO', 'PEDS']) {
        assert.equal(slots[station].staff.length, repaired.context.days[i].slots[shift][station].staff.length);
      }
    }
    run.final = {...snapshot(final.context), report: final.report, audit: finalAudit};
    run.roster = JSON.parse(JSON.stringify(final.context.days));
    if (fixture.scenario.expectedConflict) throw new Error('Negative input incorrectly accepted');
    run.status = 'VALID';
  } catch (error) {
    run.error = {code: error.code || 'EVALUATOR_ERROR', message: error.message, details: error.details, stage};
    if (error.code === 'INPUT_CONFLICT') {
      run.status = fixture.scenario.expectedConflict && run.negativeProbe ? 'EXPECTED_CONFLICT' : 'INPUT_CONFLICT';
    } else if (error.code === 'SEARCH_LIMIT') run.status = 'SEARCH_LIMIT';
    else if (error.code === 'COVERAGE_UNRESOLVED') run.status = 'COVERAGE_UNRESOLVED';
    else run.status = 'ERROR';
    if (initial) run.diagnosticRoster = JSON.parse(JSON.stringify((repaired ? repaired.context : initial).days));
  }
  run.elapsedMs = Date.now() - start;
  return run;
}

function runShard({manifestFile, out, shards, shard, resume = false, formalSize, pilotReport}) {
  const manifest = loadManifest(manifestFile);
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
