'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const {hash, identities, argumentsFor, readJSON, writeJSON, loadManifest} = require('./support/expanded-io.cjs');
function filesUnder(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  }).sort();
}
function compact(run) {
  const copy = {...run};
  delete copy.roster;
  delete copy.diagnosticRoster;
  // Preserve individual metrics, weekly targets, scores, audit conclusions and stops;
  // full candidate history and rosters remain in each compressed original record.
  for (const stage of ['initial', 'repaired', 'workdayRepaired', 'final']) if (run[stage]) {
    const value = run[stage];
    copy[stage] = {measure: value.measure, weekly: value.weekly, audit: {
      coverage: value.audit.coverage, pairing: value.audit.pairing
    }, report: value.report ? {evaluated: value.report.evaluated, accepted: value.report.accepted,
      elapsedMs: value.report.elapsedMs, stopReason: value.report.stopReason,
      transfersAccepted: value.report.transfersAccepted, swapsAccepted: value.report.swapsAccepted,
      additionsAccepted: value.report.additionsAccepted,
      moveRefillEvaluated: value.report.moveRefillEvaluated, moveRefillAccepted: value.report.moveRefillAccepted} : undefined};
  }
  return copy;
}
function merge({manifestFile, input, out}) {
  const manifest = loadManifest(manifestFile), current = identities();
  const expected = new Map(manifest.fixtures.map(f => [f.sampleId, f]));
  const selected = new Map(), jobs = [], attempts = new Map();
  let identityHash = null, identity = null;
  for (const file of filesUnder(input)) {
    const base = path.basename(file);
    if (!/^result-.*\.json\.gz$/.test(base) && !/^job-.*\.json$/.test(base)) continue;
    const record = readJSON(file);
    if (!record.identity || record.identity.inputHash !== manifest.inputHash || record.identity.size !== manifest.size ||
      record.identity.engineHash !== current.engineHash || record.identity.toolsHash !== current.toolsHash ||
      hash(record.identity) !== record.identityHash) throw new Error(`Input or code contract mismatch: ${file}`);
    if (identityHash && identityHash !== record.identityHash) throw new Error('Mixed runtime/budget identities');
    identityHash = record.identityHash; identity = record.identity;
    if (base.startsWith('job-')) { jobs.push(record); continue; }
    const run = record.run, fixture = expected.get(run.sampleId);
    if (record.schema !== 'expanded-result-v1' || record.runHash !== hash(run) || !fixture || fixture.inputHash !== run.inputHash) throw new Error(`Unexpected/modified sample: ${file}`);
    if (run.month !== fixture.month || run.group !== fixture.group || run.mode !== fixture.mode ||
      hash(run.scenario) !== hash(fixture.scenario)) throw new Error(`Result stratum mismatch: ${file}`);
    if (run.status === 'VALID' && (!run.initial || !run.repaired || !run.workdayRepaired || !run.final || !run.final.audit ||
      run.weekdayWorkdays?.schema !== 'weekday-workdays-v2' || !Array.isArray(run.weekdayWorkdays.final) ||
      run.weekdayWorkdays.final.length || !Array.isArray(run.weekdayWorkdays.workdayRepaired) || run.weekdayWorkdays.workdayRepaired.length ||
      run.final.audit.coverage.length || run.final.audit.pairing.some(d => d.actualAB !== d.maxAB))) throw new Error(`Missing or failing successful audit: ${file}`);
    if (run.status === 'EXPECTED_CONFLICT' && (!run.negativeProbe || run.negativeProbe.code !== 'INPUT_CONFLICT' ||
      run.negativeProbe.details.date !== fixture.scenario.saturday)) throw new Error(`Missing expected conflict proof: ${file}`);
    if (!attempts.has(run.sampleId)) attempts.set(run.sampleId, []);
    attempts.get(run.sampleId).push({file: path.relative(input, file), attempt: record.attempt, status: run.status});
    const previous = selected.get(run.sampleId);
    if (!previous || record.createdAt > previous.createdAt ||
      (record.createdAt === previous.createdAt && record.attempt > previous.attempt)) {
      selected.set(run.sampleId, {file, createdAt: record.createdAt, attempt: record.attempt});
    }
  }
  if (!identity) throw new Error('No compatible result records found');
  const missing = [...expected.keys()].filter(id => !selected.has(id));
  const statuses = {}, groups = {}, samples = [];
  const invalid = [], unknownStatuses = [];
  const dir = path.resolve(out);
  fs.mkdirSync(dir, {recursive: true});
  const recordsFile = path.join(dir, 'summary.ndjson.gz'), metaFile = path.join(dir, 'merged.json');
  if (fs.existsSync(recordsFile) || fs.existsSync(metaFile)) throw new Error('Use a fresh merge output directory');
  const temporary = `${recordsFile}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, '', {flag: 'wx'});
  for (const [id, pick] of selected) {
    const run = readJSON(pick.file).run;
    const fixture = expected.get(id);
    statuses[run.status] = (statuses[run.status] || 0) + 1;
    const key = `${run.month}/${run.group}/${run.mode}`;
    if (!groups[key]) groups[key] = {count: 0, statuses: {}};
    groups[key].count++;
    groups[key].statuses[run.status] = (groups[key].statuses[run.status] || 0) + 1;
    if (['ERROR', 'SEARCH_LIMIT', 'COVERAGE_UNRESOLVED', 'WORKDAY_UNRESOLVED'].includes(run.status)) invalid.push(id);
    if (manifest.inputPolicy === 'COORDINATED_ORIGINAL_INTENT_V2' && !fixture.scenario.expectedConflict && run.status === 'INPUT_CONFLICT') invalid.push(id);
    if (manifest.inputPolicy === 'COORDINATED_ORIGINAL_INTENT_V2' && fixture.scenario.expectedConflict &&
      run.status === 'EXPECTED_CONFLICT' && run.error?.details?.date !== fixture.scenario.saturday) invalid.push(id);
    if (!['VALID', 'INPUT_CONFLICT', 'EXPECTED_CONFLICT', 'ERROR', 'SEARCH_LIMIT', 'COVERAGE_UNRESOLVED', 'WORKDAY_UNRESOLVED'].includes(run.status)) unknownStatuses.push(id);
    if ((run.scenario.expectedConflict && run.status !== 'EXPECTED_CONFLICT') ||
      (!run.scenario.expectedConflict && run.status === 'EXPECTED_CONFLICT')) invalid.push(id);
    fs.appendFileSync(temporary, zlib.gzipSync(JSON.stringify(compact(run)) + '\n'));
    samples.push({sampleId: id, record: path.relative(input, pick.file), attempts: attempts.get(id)});
  }
  fs.renameSync(temporary, recordsFile);
  const completed = missing.length === 0;
  const metadata = {schema: 'expanded-merged-v1', identity, identityHash, size: manifest.size, completed,
    inputPolicy: manifest.inputPolicy, inputSampling: manifest.sampling,
    inputRoot: path.resolve(input), statuses, groups, missing, invalid: [...new Set(invalid)], unknownStatuses,
    pilotPassed: manifest.size === 200 && completed && invalid.length === 0 && unknownStatuses.length === 0 &&
      ['2026-09', '2026-10', '2026-11'].every(month => Object.entries(groups).some(([key, value]) => key.startsWith(month + '/') && value.statuses.VALID > 0)) &&
      statuses.EXPECTED_CONFLICT === manifest.fixtures.filter(f => f.scenario.expectedConflict).length,
    jobs, samples, summaryHash: hash(fs.readFileSync(recordsFile)), artifactBytes: filesUnder(input).reduce((n, file) => n + fs.statSync(file).size, 0)};
  writeJSON(metaFile, metadata);
  return metadata;
}
if (require.main === module) {
  const args = argumentsFor(process.argv.slice(2), ['--manifest', '--input', '--out']);
  if (!args['--manifest'] || !args['--input'] || !args['--out']) throw new Error('--manifest, --input and --out are required');
  const metadata = merge({manifestFile: args['--manifest'], input: args['--input'], out: args['--out']});
  console.log(JSON.stringify({completed: metadata.completed, statuses: metadata.statuses, missing: metadata.missing.length, pilotPassed: metadata.pilotPassed}));
  if (!metadata.completed || metadata.invalid.length || metadata.unknownStatuses.length) process.exitCode = 1;
}
module.exports = {filesUnder, compact, merge};
