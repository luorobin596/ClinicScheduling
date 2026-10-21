'use strict';
process.env.TZ = 'Asia/Taipei';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {generate} = require('./generate-expanded-inputs.cjs');
const {merge} = require('./merge-expanded.cjs');
const {hash, contract, writeJSON, loadManifest} = require('./support/expanded-io.cjs');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expanded-shards-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const manifest = generate(200), file = path.join(dir, 'manifest.json.gz');
  writeJSON(file, manifest);
  return {dir, manifest, file, identity: contract(manifest)};
}
function record(fixture, identity, attempt = 'one', status = 'INPUT_CONFLICT') {
  const run = {sampleId: fixture.sampleId, inputHash: fixture.inputHash, month: fixture.month,
    group: fixture.group, mode: fixture.mode, scenario: fixture.scenario, status, elapsedMs: 1};
  return {schema: 'expanded-result-v1', identity, identityHash: hash(identity), createdAt: attempt,
    attempt, runHash: hash(run), run};
}

test('EX05: missing cases remain incomplete, and retry attempts count once', t => {
  const state = setup(t), input = path.join(state.dir, 'input');
  const first = state.manifest.fixtures[0];
  writeJSON(path.join(input, 'result-first.json.gz'), record(first, state.identity, 'one'));
  writeJSON(path.join(input, 'result-retry.json.gz'), record(first, state.identity, 'two'));
  const result = merge({manifestFile: state.file, input, out: path.join(state.dir, 'merged')});
  assert.equal(result.completed, false);
  assert.equal(result.pilotPassed, false);
  assert.equal(result.missing.length, 199);
  assert.equal(result.statuses.INPUT_CONFLICT, 1);
  assert.equal(result.samples[0].attempts.length, 2);
  assert.deepEqual(result.invalid, [first.sampleId], 'Coordinated normal inputs must flag unexpected input conflicts');
});

test('WD04 unresolved workdays are recognized failures and nonempty v2 finals cannot merge as VALID', t => {
  const state = setup(t), input = path.join(state.dir, 'input');
  const fixture = state.manifest.fixtures.find(f => !f.scenario.expectedConflict);
  const failed = record(fixture, state.identity, 'one', 'WORKDAY_UNRESOLVED');
  failed.run.error = {code: 'WORKDAY_UNRESOLVED', stage: 'WORKDAY_REPAIR', details: {date: '2026-11-02'}};
  failed.runHash = hash(failed.run);
  const file = path.join(input, 'result-workday.json.gz');
  writeJSON(file, failed);
  const result = merge({manifestFile: state.file, input, out: path.join(state.dir, 'merged')});
  assert.deepEqual(result.invalid, [fixture.sampleId]);
  assert.deepEqual(result.unknownStatuses, []);
  const invalid = record(fixture, state.identity, 'two', 'VALID');
  const stage = {measure: {}, audit: {coverage: [], pairing: []}};
  Object.assign(invalid.run, {initial: stage, repaired: stage, workdayRepaired: stage, final: stage,
    weekdayWorkdays: {schema: 'weekday-workdays-v2', workdayRepaired: [], final: [{date: '2026-11-02', id: 'FT001'}]}});
  invalid.runHash = hash(invalid.run);
  writeJSON(path.join(input, 'result-invalid.json.gz'), invalid);
  assert.throws(() => merge({manifestFile: state.file, input, out: path.join(state.dir, 'invalid')}), /Missing or failing successful audit/);
});

test('EX05: coordinated negative cases accept only their designated Saturday conflict', t => {
  const state = setup(t), input = path.join(state.dir, 'input');
  const fixtures = state.manifest.fixtures.filter(f => f.scenario.expectedConflict).slice(0, 2);
  for (const [index, fixture] of fixtures.entries()) {
    const value = record(fixture, state.identity, 'one', 'EXPECTED_CONFLICT');
    value.run.negativeProbe = {code: 'INPUT_CONFLICT', details: {date: fixture.scenario.saturday}};
    value.run.error = {code: 'INPUT_CONFLICT', details: {date: index === 0 ? fixture.scenario.saturday : '2026-09-07'}};
    value.runHash = hash(value.run);
    writeJSON(path.join(input, `result-negative-${index}.json.gz`), value);
  }
  const result = merge({manifestFile: state.file, input, out: path.join(state.dir, 'merged')});
  assert.equal(result.statuses.EXPECTED_CONFLICT, 2);
  assert.deepEqual(result.invalid, [fixtures[1].sampleId]);
  assert.equal(result.pilotPassed, false);
});
test('EX05: manifest and result corruption are rejected before a complete report', t => {
  const state = setup(t), input = path.join(state.dir, 'input');
  const bad = record(state.manifest.fixtures[0], state.identity);
  bad.run.status = 'VALID'; // Deliberately leave the original checksum.
  writeJSON(path.join(input, 'result-corrupt.json.gz'), bad);
  assert.throws(() => merge({manifestFile: state.file, input, out: path.join(state.dir, 'merged')}), /modified/);
  state.manifest.fixtures[0].seed++;
  writeJSON(path.join(state.dir, 'bad-input.json'), state.manifest);
  assert.throws(() => loadManifest(path.join(state.dir, 'bad-input.json')), /modified/);
});
test('EX05: budget changes cannot be mixed even when engine and inputs match', t => {
  const state = setup(t), input = path.join(state.dir, 'input');
  const changed = {...state.identity, budget: {...state.identity.budget, maxCandidates: 1}};
  writeJSON(path.join(input, 'result-a.json.gz'), record(state.manifest.fixtures[0], state.identity));
  writeJSON(path.join(input, 'result-b.json.gz'), record(state.manifest.fixtures[1], changed));
  assert.throws(() => merge({manifestFile: state.file, input, out: path.join(state.dir, 'merged')}), /Mixed runtime/);
});
