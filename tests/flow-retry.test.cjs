const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(status = 'FT_WINDOW_OPEN', options = {}) {
  const state = { run_id: '2026-11', status, ft_window_close_at: status === 'FT_WINDOW_CLOSED' ? 'original-cutoff' : '', writes: [], exported: 0, engineCalls: 0, locked: false };
  const sandbox = {
    console: { log() {}, error() {} }, Date,
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    Utilities: { formatDate: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` },
    LockService: { getScriptLock: () => ({
      waitLock() { if (state.locked) throw new Error('LOCK_BUSY'); state.locked = true; },
      releaseLock() { state.locked = false; }
    }) },
    RepoCore: {
      getActiveRun() { return { rowIndex: 3, data: { ...state } }; },
      updateToFtClosed() { if (options.closeError) throw new Error('cutoff failed'); state.status = 'FT_WINDOW_CLOSED'; state.ft_window_close_at = 'first-cutoff'; },
      restoreFtClosed(runId, details) {
        assert.equal(runId, '2026-11');
        if (options.restoreError) throw new Error('restore failed');
        state.status = 'FT_WINDOW_CLOSED'; state.failure = details;
      },
      updateToPublished() { assert.equal(state.locked, true); state.status = 'PUBLISHED'; }
    },
    ScheduleReport: { send(context) { assert.equal(state.exported, state.engineCalls); if (options.mailError) throw new Error('mail unavailable'); state.mailed = (state.mailed || 0) + 1; } },
    SchedulingEngine: { generateSchedule(runId) {
      assert.equal(state.locked, true); state.engineCalls++;
      assert.equal(state.status, 'FT_WINDOW_CLOSED');
      if (options.engineError) { state.status = 'RUN_CREATED'; throw Object.assign(new Error('coverage failed'), { code: 'COVERAGE_UNRESOLVED', details: { missing: 'B' } }); }
      return { runIdStr: '2026-11' };
    } },
    exportScheduleToFrontend() { if (options.exportError) throw new Error('export partial failure'); state.exported++; },
    RepoRequests: { saveStaffRequest(runId) { state.lockedAtWrite = state.locked; state.writes.push(runId); } }
  };
  vm.createContext(sandbox);
  for (const file of ['flow_run.js', 'web_entry.js']) vm.runInContext(fs.readFileSync('gas/' + file, 'utf8'), sandbox);
  return { state, sandbox };
}

test('OPEN closes before scheduling and returns existing success string', () => {
  const { state, sandbox } = setup();
  assert.match(sandbox.CoreSystem.closeFtWindow(), /執行成功/);
  assert.equal(state.status, 'FT_WINDOW_CLOSED'); assert.equal(state.exported, 1); assert.equal(state.locked, false);
});
test('CLOSED retry preserves first deadline and can rerun', () => {
  const { state, sandbox } = setup('FT_WINDOW_CLOSED');
  sandbox.CoreSystem.closeFtWindow(); sandbox.CoreSystem.closeFtWindow();
  assert.equal(state.ft_window_close_at, 'original-cutoff'); assert.equal(state.engineCalls, 2);
});
test('engine failure restores CLOSED, preserves code/details and does not export', () => {
  const { state, sandbox } = setup('FT_WINDOW_CLOSED', { engineError: true });
  assert.throws(() => sandbox.CoreSystem.closeFtWindow(), e => e.code === 'COVERAGE_UNRESOLVED' && e.details.missing === 'B' && e.details.stage === 'SCHEDULING');
  assert.equal(state.status, 'FT_WINDOW_CLOSED'); assert.equal(state.ft_window_close_at, 'original-cutoff'); assert.equal(state.exported, 0); assert.equal(state.locked, false);
});
test('engine persistence diagnostics survive flow error decoration', () => {
  const { sandbox } = setup('FT_WINDOW_CLOSED');
  sandbox.SchedulingEngine.generateSchedule = () => {
    throw Object.assign(new Error('backend partial write'), { code: 'PERSISTENCE_FAILED', details: { stage: 'BACKEND_WRITE', previousRows: [['old']] } });
  };
  assert.throws(() => sandbox.CoreSystem.closeFtWindow(), error => error.details.stage === 'BACKEND_WRITE' && error.details.flowStage === 'SCHEDULING' && error.details.previousRows[0][0] === 'old' && error.details.partialWritePossible);
});
test('restore failure exposes original and restore errors without promising retry', () => {
  const { sandbox } = setup('FT_WINDOW_CLOSED', { engineError: true, restoreError: true });
  assert.throws(() => sandbox.CoreSystem.closeFtWindow(), e => e.details.originalError.message === 'coverage failed' && e.details.recoveryError.message === 'restore failed' && e.details.retryReady === false);
});
test('export failure reports partial persistence risk and restores CLOSED', () => {
  const { state, sandbox } = setup('FT_WINDOW_CLOSED', { exportError: true });
  assert.throws(() => sandbox.CoreSystem.closeFtWindow(), e => e.code === 'PERSISTENCE_FAILED' && e.details.stage === 'FRONTEND_EXPORT' && e.details.partialWritePossible === true);
  assert.equal(state.status, 'FT_WINDOW_CLOSED');
});
test('failed cutoff never schedules and never claims CLOSED', () => {
  const { state, sandbox } = setup('FT_WINDOW_OPEN', { closeError: true });
  assert.throws(() => sandbox.CoreSystem.closeFtWindow(), /cutoff failed/);
  assert.equal(state.engineCalls, 0); assert.equal(state.status, 'FT_WINDOW_OPEN'); assert.equal(state.locked, false);
});
for (const status of ['PUBLISHED', 'RUN_CREATED', 'FT_WINDOW_CLOSED']) {
  test(`old portal submission is rejected in ${status}`, () => {
    const { state, sandbox } = setup(status);
    assert.throws(() => sandbox.processFtSubmission({ runId: '2026-11' }));
    assert.equal(state.writes.length, 0); assert.equal(state.locked, false);
  });
}
test('submission rejects other run, accepts current run and date-normalized run', () => {
  const { state, sandbox } = setup();
  assert.throws(() => sandbox.processFtSubmission({ runId: '2026-12' }));
  state.run_id = new Date(2026, 10, 1);
  sandbox.processFtSubmission({ runId: '2026-11' });
  assert.deepEqual(state.writes, ['2026-11']); assert.equal(state.lockedAtWrite, true);
});
test('submission cannot interleave with scheduling and publish shares lock', () => {
  const { state, sandbox } = setup('FT_WINDOW_CLOSED');
  state.locked = true;
  assert.throws(() => sandbox.processFtSubmission({ runId: '2026-11' }), /LOCK_BUSY/);
  assert.throws(() => sandbox.CoreSystem.publishSchedule('2026-11'), /LOCK_BUSY/);
  assert.equal(state.locked, true, 'failed acquisition must not release another operation lock');
  state.locked = false;
  sandbox.CoreSystem.publishSchedule('2026-11');
  assert.equal(state.status, 'PUBLISHED');
  assert.throws(() => sandbox.CoreSystem.closeFtWindow());
});

function repositorySetup() {
  const header = ['run_id', 'target_month', 'ft_window_open_at', 'ft_window_close_at', 'unused', 'unused2', 'status', 'unused3', 'created_at', 'updated_at', 'last_action'];
  const rows = [header, [], [new Date(2026, 10, 1), '', '', 'original-cutoff', '', '', 'RUN_CREATED'], ['2026-12', '', '', 'other-cutoff', '', '', 'PUBLISHED']];
  const sheet = {
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getLastColumn: () => header.length,
    getRange: (r, c) => ({ getValues: () => [rows[r - 1].slice()], getValue: () => rows[r - 1][c - 1], setValue(value) { rows[r - 1][c - 1] = value; } })
  };
  const sandbox = { Date, console: { error() {} }, CONFIG: { SHEET_NAMES: { RUN_CONTROL: 'Run_Control' } }, getDbSpreadsheet: () => ({ getSheetByName: () => sheet }), Session: { getScriptTimeZone: () => 'Asia/Taipei' }, Utilities: { formatDate: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` } };
  vm.createContext(sandbox);
  for (const file of ['flow_run.js', 'repo_core.js']) vm.runInContext(fs.readFileSync('gas/' + file, 'utf8'), sandbox);
  return { rows, repo: vm.runInContext('RepoCore', sandbox) };
}
test('actual repository restores only matching Date runId and preserves cutoff', () => {
  const { rows, repo } = repositorySetup();
  repo.restoreFtClosed('2026-11', { stage: 'SCHEDULING' });
  assert.equal(rows[2][6], 'FT_WINDOW_CLOSED'); assert.equal(rows[2][3], 'original-cutoff');
  assert.equal(rows[3][6], 'PUBLISHED'); assert.equal(rows[3][3], 'other-cutoff');
});
test('actual repository refuses restore of published, missing, or ambiguous runs', () => {
  const { rows, repo } = repositorySetup();
  assert.throws(() => repo.restoreFtClosed('2026-12', {}), /已發布/);
  assert.throws(() => repo.restoreFtClosed('2027-01', {}), /唯一確認/);
  rows.push(rows[2].slice());
  assert.throws(() => repo.restoreFtClosed('2026-11', {}), /唯一確認/);
  assert.equal(rows[2][6], 'RUN_CREATED');
});

test('cutoff refuses malformed state columns before any writes', () => {
  const { rows, repo } = repositorySetup();
  rows[0][6] = 'missing-status';
  assert.throws(() => repo.updateToFtClosed(3), /缺少/);
  assert.equal(rows[2][3], 'original-cutoff');
});

test('every successful rerun mails after export; failed scheduling/export never mails', () => {
  const {state, sandbox} = setup('FT_WINDOW_CLOSED');
  sandbox.CoreSystem.closeFtWindow(); sandbox.CoreSystem.closeFtWindow();
  assert.equal(state.mailed, 2);
  for (const options of [{engineError:true}, {exportError:true}]) {
    const failed = setup('FT_WINDOW_CLOSED', options);
    assert.throws(() => failed.sandbox.CoreSystem.closeFtWindow());
    assert.equal(failed.state.mailed, undefined);
  }
});
test('mail failure returns warning without restoring or rerunning completed schedule', () => {
  const {state, sandbox} = setup('FT_WINDOW_CLOSED', {mailError:true});
  assert.match(sandbox.CoreSystem.closeFtWindow(), /排班.*完成.*報告.*未寄出/);
  assert.equal(state.failure, undefined); assert.equal(state.engineCalls, 1);
  assert.equal(state.exported, 1); assert.equal(state.locked, false);
});
