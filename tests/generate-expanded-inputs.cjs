'use strict';
const path = require('node:path');
const {descriptors, generateFixture} = require('./support/expanded-fixtures.cjs');
const {hash, argumentsFor, integer, writeJSON} = require('./support/expanded-io.cjs');
function generate(size) {
  const fixtures = descriptors(size).map(row => {
    const fixture = generateFixture(row);
    return {...fixture, inputHash: hash(fixture)};
  });
  if (fixtures.length !== size || new Set(fixtures.map(f => f.sampleId)).size !== size) throw new Error('Manifest size/identity mismatch');
  return {schema: 'expanded-v1', size, inputHash: hash(fixtures), fixtures};
}
if (require.main === module) {
  const args = argumentsFor(process.argv.slice(2), ['--size', '--out']);
  if (!args['--out']) throw new Error('--out is required; existing evidence is never overwritten');
  const manifest = generate(integer(args['--size'], 'size', 1));
  writeJSON(path.resolve(args['--out']), manifest);
  console.log(`Frozen ${manifest.size} inputs; no scheduler executed. SHA256 ${manifest.inputHash}`);
}
module.exports = {generate};
