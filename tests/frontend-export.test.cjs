const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function exportRoster(requestRows, systemRest = "") {
  const backgrounds = { R5C3: '#cccccc', R5C4: '#cccccc', R5C6: '#d9ead3', R8C3: '#999999' };
  let roster;
  const sheet = {
    getRange(...range) {
      if (range[0] === 'C3:Z3') return { getValues: () => [['員工乙', ' 員工甲 ', '目前缺班', '員工丙']] };
      if (range[1] === 1) return { getValues: () => [[3], [1], [2], ['統計'], [4]] };
      assert.deepEqual(range, [5, 3, 3, 4]);
      return { getBackgrounds: () => Array.from({length: 3}, (_, r) => Array.from({length: 4}, (_, c) => backgrounds[`R${5 + r}C${3 + c}`])),
        setRichTextValues: values => { roster = JSON.parse(JSON.stringify(values)); } };
    },
    getRangeList(cells) {
      assert.ok(cells.length);
      return { setBackground: color => cells.forEach(cell => { backgrounds[cell] = color; }) };
    }
  };
  const staff = [['F1', '員工甲'], ['F2', '員工乙'], ['F3', '員工丙'], ['F4', '其他員工']];
  const dbRows = {
    Staff: [[], ...staff],
    FT_Requests: [[], ...requestRows],
    Schedule_Output: [
      [], [],
      ['2026-12', '2026-12-01', 'A', 'F1', 'F3', '', '', 'F2', 0, '', '', '', 'ORTHO', '', '', systemRest],
      ['2026-12', '2026-12-01', 'C', 'F1', '', '', '', '', 1, '', '', '', 'PEDS']
    ]
  };
  const sandbox = {
    Date,
    console: { log() {} },
    CONFIG: { FRONTEND_SPREADSHEET_ID: 'test', SHEET_NAMES: {
      STAFF: 'Staff', FT_REQUESTS: 'FT_Requests', SCHEDULE_OUTPUT: 'Schedule_Output'
    } },
    RepoStaff: { getStaffMap: () => Object.fromEntries(staff) },
    getDbSpreadsheet: () => ({ getSheetByName: name => ({
      getDataRange: () => ({ getValues: () => dbRows[name] })
    }) }),
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    Utilities: { formatDate: (date, tz, format) => date.toISOString().slice(0, format.length) },
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: name => { assert.equal(name, '115.12'); return sheet; } }),
      newRichTextValue() {
        const styles = [];
        return {
          setText(text) { this.text = text; },
          setTextStyle(start, end, color) { styles.push({ start, end, color }); },
          build() { return { text: this.text, styles }; }
        };
      },
      newTextStyle() {
        return { setForegroundColor(color) { return { build: () => color }; } };
      }
    }
  };
  vm.createContext(sandbox);
  for (const name of ['repo_schedule_sheet_sync', 'repo_FTrequests', 'scheduling_assignments']) {
    vm.runInContext(fs.readFileSync(`GAS/${name}.js`, 'utf8'), sandbox);
  }
  sandbox.exportScheduleToFrontend('2026-12');
  return { backgrounds, roster };
}

test('frontend highlights personal off and fixed requests at the employee and date intersection', () => {
  const baseline = exportRoster([]);
  const actual = exportRoster([
    ['2026-12', 'F1', '', '2026-12-01|B;2026-12-03|A;2026-12-04|A', '2026-12-01|C'],
    ['2026-12', 'F2', '', '2026-12-01|A;2026-12-01|B;2026-12-01|C', ''],
    [new Date('2026-12-01'), 'F3', '', '', '2026/12/2|A'],
    ['2026-12', 'F4', '', '2026-12-02|A', ''],
    ['2026-11', 'F3', '', '2026-11-01|A', '']
  ]);
  assert.deepEqual(actual.backgrounds, {
    ...baseline.backgrounds, R5C4: '#cfe2f3', R6C3: '#cfe2f3', R6C4: '#cfe2f3', R7C6: '#cfe2f3'
  });
  assert.deepEqual(actual.roster, baseline.roster);
  assert.deepEqual(actual.roster[1], [
    { text: 'OFF', styles: [] },
    { text: 'AC', styles: [{ start: 0, end: 1, color: 'black' }, { start: 1, end: 2, color: 'red' }] },
    { text: 'C', styles: [] },
    { text: 'A', styles: [{ start: 0, end: 1, color: 'black' }] }
  ]);
});

test('frontend restores system rest from Schedule_Output and removes stale highlights', () => {
  const result = exportRoster([], 'SYSTEM_REST ["F1","F4"]');
  assert.equal(result.backgrounds.R6C4, '#d9ead3');
  assert.equal(result.roster[1][1].text, 'AC');
  assert.equal(result.backgrounds.R5C6, null);
});
