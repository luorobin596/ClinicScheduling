'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {evaluate} = require('./evaluate-expanded.cjs');
const {argumentsFor, hash, identities, integer, writeJSON} = require('./support/expanded-io.cjs');
const {weeklySinglesTable, failureTables} = require('./summarize-expanded.cjs');

const args = argumentsFor(process.argv.slice(2), ['--out', '--limit-per-group']);
if (!args['--out']) throw new Error('--out is required');
const output = path.resolve(args['--out']);
const limit = args['--limit-per-group'] ? integer(args['--limit-per-group'], '--limit-per-group', 1) : 100;
if (limit > 100) throw new Error('--limit-per-group must be at most 100');
const archive = path.join(__dirname, 'results', 'archive', 'historical-results.tar.gz');
const kinds = ['baseline', 'full-only', 'mixed', 'week-off'];
const inputs = kinds.map(kind => {
  const record = JSON.parse(execFileSync('tar', ['-xOzf', archive, kind + '-inputs.json'], {maxBuffer: 16 * 1024 * 1024}));
  if (hash(record.fixtures) !== record.inputHash) throw new Error('Frozen input hash mismatch for ' + kind);
  return {kind, inputHash: record.inputHash, fixtures: record.fixtures.slice(0, limit)};
});
fs.mkdirSync(output);
const runs = [];
for (const {kind, fixtures} of inputs) for (const fixture of fixtures) {
  const run = evaluate({...fixture, month: '2026-11', group: kind, mode: kind,
    sampleId: kind + '-' + fixture.seed, scenario: {weekly: []},
    leaveSummary: fixture.leaveSummary.map(person => ({...person,
      expectedCapacityHours: 200 - 4 * person.additionalLeaveUnits}))});
  runs.push(run);
}
const successes = runs.filter(run => run.status === 'VALID');
const lines = ['# 400 組既有意願每週單節班補充報告', '',
  `共執行 ${runs.length} 組，成功 ${successes.length} 組。`, '',
  ...weeklySinglesTable(successes), '', '## 失敗案例', '', ...failureTables(runs)];
writeJSON(path.join(output, 'runs.json.gz'), {identity: identities(),
  inputs: inputs.map(({kind, inputHash, fixtures}) => ({kind, inputHash, count: fixtures.length})), runs});
fs.writeFileSync(path.join(output, 'summary.md'), lines.join('\n') + '\n', {flag: 'wx'});
