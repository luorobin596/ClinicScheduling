'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {hash, writeJSON} = require('./support/expanded-io.cjs');
const {summarize} = require('./summarize-expanded.cjs');
const {estimate} = require('./estimate-expanded-cost.cjs');

test('EX04: reporting uses identical successful denominators and renders zero targets as N/A', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expanded-report-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const week = {week: 1, AC: 0, shortWeek: false, cActual: 0, cRate: null, earlyActual: 0, earlyRate: null};
  const stage = singles => ({measure: {score: Array(9).fill(0), staff: [
    {id: 'FT001', involuntarySingle: singles, attainment: null, capacityHours: 0},
    {id: 'FT002', involuntarySingle: 0, attainment: 0.9, capacityHours: 168}
  ]}, weekly: ['FT001', 'FT002'].map(id => ({id, weeks: [week]})),
  audit: {pairing: [], coverage: []}, report: {stopReason: 'CANDIDATE_LIMIT', evaluated: 20000}});
  const valid = {sampleId: 'valid', seed: 1, month: '2026-11', group: 'random', mode: 'full', status: 'VALID',
    elapsedMs: 1, scenario: {weekly: []}, initial: stage(4), repaired: stage(2), final: stage(1)};
  const rejected = {...valid, sampleId: 'rejected', status: 'INPUT_CONFLICT', initial: stage(40)};
  delete rejected.repaired; delete rejected.final;
  const bytes = zlib.gzipSync([valid, rejected].map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'summary.ndjson.gz'), bytes);
  writeJSON(path.join(dir, 'merged.json'), {size: 200, completed: false, pilotPassed: false,
    statuses: {VALID: 1, INPUT_CONFLICT: 1}, missing: ['not-complete'], invalid: [], identity: {}, summaryHash: hash(bytes)});
  const groups = await summarize(dir);
  assert.equal(groups['2026-11/random/full'].stages.initial.involuntarySingle.mean, 4);
  assert.equal(groups['2026-11/random/full'].stages.final.involuntarySingle.mean, 1);
  const detail = fs.readFileSync(path.join(dir, 'reports/2026-11_random_full.md'), 'utf8');
  assert.match(detail, /N\/A → N\/A/);
  assert.doesNotMatch(detail, /N\/A%/);
  assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /not-complete/);
});

test('EX06: a failed or incomplete pilot cannot produce a cost approval report', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expanded-cost-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  writeJSON(path.join(dir, 'merged.json'), {size: 200, completed: true, pilotPassed: false});
  await assert.rejects(estimate(dir, 'not-read.json'), /passing 200-case/);
  assert.equal(fs.existsSync(path.join(dir, 'cost-estimate.json')), false);
});
