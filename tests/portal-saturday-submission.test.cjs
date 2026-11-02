const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { engine } = require('./support/engine-harness.cjs');
const { fakeSheets } = require('./support/fake-sheets.cjs');

// Execute the actual portal script, replacing only GAS template values and UI/RPC boundaries.
function submitFromPortal(date, selection, backend) {
  const source = fs.readFileSync('GAS/FT_Portal.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace('<?= targetMonth ?>', '2026-11')
    .replace('<?!= closedDates ?>', '[]')
    .replace('<?= existingEvents ?>', '"{}"');
  let payload;
  const rpc = {
    withSuccessHandler() { return this; },
    withFailureHandler() { return this; },
    processFtSubmission(value) {
      payload = JSON.parse(JSON.stringify(value));
      assert.equal(backend.processFtSubmission(payload).success, true);
    }
  };
  const browser = vm.createContext({
    document: { getElementById: () => ({ value: 'FT001' }) },
    confirm: () => true,
    alert(message) { throw new Error(message); },
    google: { script: { run: rpc } }
  });
  vm.runInContext(source, browser);
  vm.runInContext(`selectedData = ${JSON.stringify({ [date]: selection })}; submitAll();`, browser);
  return payload;
}

const cases = [
  { name: 'Saturday A leave', date: '2026-11-07', selection: { type: 'PARTIAL_OFF', shifts: ['A'] }, off: ['A'], fixed: ['B'] },
  { name: 'Saturday B leave', date: '2026-11-07', selection: { type: 'PARTIAL_OFF', shifts: ['B'] }, off: ['B'], fixed: ['A'] },
  { name: 'Saturday full leave', date: '2026-11-07', selection: { type: 'FULL_OFF' }, off: ['A', 'B', 'C'], fixed: [] },
  { name: 'weekday A leave', date: '2026-11-06', selection: { type: 'PARTIAL_OFF', shifts: ['A'] }, off: ['A'], fixed: ['B', 'C'] },
  { name: 'weekday A/C leave', date: '2026-11-06', selection: { type: 'PARTIAL_OFF', shifts: ['A', 'C'] }, off: ['A', 'C'], fixed: ['B'] }
];

for (const entry of cases) test(`${entry.name}: portal -> submission -> Sheets -> final schedule preserves intent`, () => {
  const requests = fakeSheets([['run_id', 'staff_id', 'submitted_at', 'off_dates', 'fixed_shifts']]);
  requests.sheet.appendRow = row => requests.rows.push(Array.from(row));
  const output = fakeSheets();
  const spreadsheet = { getSheetByName: name => name === 'FT_Requests' ? requests.sheet : output.sheet };
  const x = engine([], { final: true, save: true, spreadsheet });
  x.box.RepoStaff.getStaffMap = () => ({});
  x.box.RepoCore = { getActiveRun: () => ({ data: { run_id: '2026-11', status: 'FT_WINDOW_OPEN' } }) };
  x.box.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  for (const file of ['repo_FTrequests.js', 'flows_run.js', 'web_entry.js']) {
    vm.runInContext(fs.readFileSync(`GAS/${file}`, 'utf8'), x.box, { filename: file });
  }
  const payload = submitFromPortal(entry.date, entry.selection, x.box);
  const tokens = shifts => shifts.map(shift => `${entry.date}|${shift}`);
  assert.deepEqual(payload.offDates, tokens(entry.off));
  assert.deepEqual(payload.fixedShifts, tokens(entry.fixed));
  assert.equal(requests.rows[1][3], tokens(entry.off).join(';'));
  assert.equal(requests.rows[1][4], tokens(entry.fixed).join(';'));
  const restored = x.box.RepoRequests.getAllRequestsByRun('2026-11');
  assert.deepEqual(Array.from(restored, r => `${r.date}|${r.shift}|${r.type}`).sort(),
    [...tokens(entry.off).map(t => `${t}|off`), ...tokens(entry.fixed).map(t => `${t}|fixed`)].sort());

  const result = x.e.generateSchedule('2026-11', { now: () => 0, maxCandidates: 20000, maxAccepted: 200, timeLimitMs: 10000 });
  const day = result.days.find(d => d.date === entry.date);
  for (const [shift, stations] of Object.entries(day.slots)) {
    const assigned = Object.values(stations).some(station => station.staff.includes('FT001'));
    if (entry.off.includes(shift)) assert.equal(assigned, false, `${shift} leave must be respected`);
    if (entry.fixed.includes(shift)) assert.equal(assigned, true, `${shift} fixed work must be retained`);
  }
  assert.equal(x.adjustments.coverage(result).length, 0);
  assert.ok(output.operations.some(operation => operation.type === 'write'));
});
