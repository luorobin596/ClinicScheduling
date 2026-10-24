'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const readline = require('node:readline');
const {hash} = require('./expanded-fixtures.cjs');
const ROOT = path.resolve(__dirname, '../..');
const ENGINE_FILES = ['Config_system.js', 'scheduling_engine.js', 'scheduling_assignments.js',
  'scheduling_fairness.js', 'scheduling_adjustments.js', 'scheduling_saturday.js'];
function sourceHash(files) {
  return hash(files.map(file => [file, fs.readFileSync(path.join(ROOT, file.endsWith('.js') ? 'gas' : '', file), 'utf8')]));
}
function identities() {
  const support = fs.readdirSync(__dirname).filter(f => f.endsWith('.cjs')).sort().map(f => `tests/support/${f}`);
  const commands = ['generate-expanded-inputs', 'evaluate-expanded', 'merge-expanded', 'summarize-expanded', 'estimate-expanded-cost']
    .map(f => `tests/${f}.cjs`);
  return {engineHash: sourceHash(ENGINE_FILES), toolsHash: sourceHash(support.concat(commands))};
}
function argumentsFor(argv, allowed) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.includes(argv[i]) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${argv[i]}`);
    if (Object.hasOwn(result, argv[i])) throw new Error(`Duplicate argument: ${argv[i]}`);
    result[argv[i]] = argv[i + 1];
  }
  return result;
}
function integer(value, name, minimum = 0) {
  if (value === undefined || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) throw new Error(`Invalid ${name}`);
  return Number(value);
}
function writeJSON(file, value, exclusive = true) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const text = Buffer.from(JSON.stringify(value) + '\n');
  fs.writeFileSync(file, file.endsWith('.gz') ? zlib.gzipSync(text) : text, {flag: exclusive ? 'wx' : 'w'});
}
function readJSON(file) {
  const bytes = fs.readFileSync(file);
  return JSON.parse(file.endsWith('.gz') ? zlib.gunzipSync(bytes).toString('utf8') : bytes.toString('utf8'));
}
function loadManifest(file) {
  const manifest = readJSON(file);
  if (manifest.schema !== 'expanded-v1' || ![200, 5000, 10000].includes(manifest.size) ||
      manifest.fixtures.length !== manifest.size || new Set(manifest.fixtures.map(f => f.sampleId)).size !== manifest.size ||
      hash(manifest.fixtures) !== manifest.inputHash) throw new Error('Invalid or modified manifest');
  for (const fixture of manifest.fixtures) {
    if (fixture.inputHash !== hash({...fixture, inputHash: undefined})) throw new Error(`Modified fixture: ${fixture.sampleId}`);
  }
  return manifest;
}
const BUDGET = Object.freeze({maxCandidates: 20000, maxAccepted: 200, timeLimitMs: 10000});
async function* readRuns(directory) {
  const metadata = readJSON(path.join(directory, 'merged.json'));
  const file = path.join(directory, 'summary.ndjson.gz');
  if (hash(fs.readFileSync(file)) !== metadata.summaryHash) throw new Error('Merged summary hash mismatch');
  const input = fs.createReadStream(file).pipe(zlib.createGunzip());
  const lines = readline.createInterface({input, crlfDelay: Infinity});
  for await (const line of lines) if (line) yield JSON.parse(line);
}
function contract(manifest) {
  if (process.env.TZ !== 'Asia/Taipei') throw new Error('Set TZ=Asia/Taipei before running the evaluator');
  return {...identities(), inputHash: manifest.inputHash, size: manifest.size,
    node: process.version, timezone: process.env.TZ, budget: BUDGET};
}
module.exports = {hash, identities, argumentsFor, integer, writeJSON, readJSON, loadManifest, contract, readRuns, BUDGET};
