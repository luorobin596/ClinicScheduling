'use strict';
const crypto = require('node:crypto');
const {calendar, MONTHS} = require('./expanded-calendar.cjs');
const {toRequests, leaveUnits} = require('./leave-model.cjs');
const {inspectOriginalIntent} = require('./expanded-input-screen.cjs');
const MODES = ['full', 'half', 'mixed'];
const GROUPS = ['random', 'one-extra-week', 'two-same-week', 'two-different-weeks', 'saturday', 'one-minimum-week', 'negative-saturday'];
const STAFF = Array.from({length: 5}, (_, i) => ({id: `FT00${i + 1}`, name: `測試員工${i + 1}`}));
const hash = data => crypto.createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(items, random) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function descriptors(size) {
  if (![200, 5000, 10000].includes(size)) throw new Error('Size must be 200, 5000 or 10000');
  const rows = [];
  MONTHS.forEach((month, monthIndex) => GROUPS.forEach(group => {
    if (group === 'negative-saturday') {
      const count = size === 200 ? [3, 3, 2][monthIndex] : [67, 67, 66][monthIndex] * (size / 5000);
      for (let rank = 0; rank < count; rank++) rows.push({month, group, mode: MODES[rank % 3], rank});
      return;
    }
    MODES.forEach((mode, modeIndex) => {
      let count;
      if (group === 'one-minimum-week') {
        const extra = modeIndex === monthIndex;
        count = size === 200 ? (extra ? 2 : 1) : (extra ? 34 : 33) * (size / 5000);
      } else count = size === 200 ? 4 : 100 * (size / 5000);
      for (let rank = 0; rank < count; rank++) rows.push({month, group, mode, rank});
    });
  }));
  return rows.map(row => {
    const sampleId = `${row.month}_${row.group}_${row.mode}_${String(row.rank).padStart(4, '0')}`;
    return {...row, sampleId, seed: parseInt(hash(sampleId).slice(0, 8), 16)};
  });
}

function generateCandidate(descriptor, candidateSeed = descriptor.seed) {
  const {month, group, mode, rank, seed} = descriptor;
  const selectionRank = rank + MODES.indexOf(mode) * 37 + MONTHS.indexOf(month) * 101;
  const cal = calendar(month), random = randomFor(candidateSeed), events = [], weekly = [];
  const open = cal.days.filter(d => d.isOpen);
  const forced = new Map(STAFF.map(s => [s.id, []]));
  let saturday = null;
  if (['saturday', 'negative-saturday'].includes(group)) {
    const saturdays = open.filter(d => d.weekday === 6);
    saturday = saturdays[Math.floor(rank / 3) % saturdays.length].date;
    const count = group === 'negative-saturday' ? 5 : 2 + (rank % 100 + MODES.indexOf(mode) + MONTHS.indexOf(month)) % 3;
    // Rotate combinations instead of always giving low IDs the Saturday leave.
    const combinations = [];
    const choose = (start, ids) => {
      if (ids.length === count) { combinations.push(ids); return; }
      for (let i = start; i < STAFF.length; i++) choose(i + 1, ids.concat(STAFF[i].id));
    };
    choose(0, []);
    for (const id of combinations[Math.floor(rank / 3) % combinations.length]) forced.get(id).push(saturday);
  }
  if (group.includes('week')) {
    let ids;
    if (group.startsWith('two-')) {
      const pairs = STAFF.flatMap((a, i) => STAFF.slice(i + 1).map(b => [a.id, b.id]))
        .filter(pair => group !== 'two-same-week' || pair.join(',') !== 'FT002,FT003');
      ids = pairs[selectionRank % pairs.length];
    } else ids = [STAFF[selectionRank % STAFF.length].id];
    const weekOptions = [];
    for (let a = 0; a < cal.fullWeeks.length; a++) {
      if (group === 'two-different-weeks') {
        for (let b = 0; b < cal.fullWeeks.length; b++) if (a !== b) weekOptions.push([a, b]);
      } else weekOptions.push(ids.map(() => a));
    }
    const period = ids.length === 1 ? STAFF.length : (group === 'two-same-week' ? 9 : 10);
    const selected = weekOptions[Math.floor(selectionRank / period) % weekOptions.length];
    ids.forEach((id, i) => {
      const days = cal.fullWeeks[selected[i]];
      const dates = days.filter(d => d.isOpen).map(d => d.date);
      forced.set(id, dates);
      weekly.push({id, start: days[0].date, end: days[6].date, openDays: dates.length,
        extraWholeWeek: group !== 'one-minimum-week'});
    });
  }
  const leaveSummary = STAFF.map(person => {
    const dates = forced.get(person.id);
    const forcedEvents = dates.map(date => ({staff_id: person.id, date, kind: 'full', allocation: weekly.some(w => w.id === person.id && w.extraWholeWeek) ? 'extra' : 'basic'}));
    events.push(...forcedEvents);
    const extraWholeWeek = weekly.some(w => w.id === person.id && w.extraWholeWeek);
    let remaining = extraWholeWeek ? cal.discretionaryUnits : Math.max(0, cal.discretionaryUnits - dates.length * 2);
    const available = shuffled(open.filter(d => !dates.includes(d.date) &&
      // Keep the exact number of full-day absentees on the designated Saturday.
      !(saturday === d.date && mode === 'full')), random);
    let fullDays;
    if (mode === 'full') fullDays = remaining / 2;
    else if (mode === 'half') fullDays = 0;
    else {
      const maxFull = Math.floor(remaining / 2) - 1;
      fullDays = maxFull > 0 ? 1 + Math.floor(random() * maxFull) : 0;
    }
    const halfDays = remaining - fullDays * 2;
    if (available.length < fullDays + halfDays) throw new Error(`Not enough leave dates: ${descriptor.sampleId}`);
    let cursor = 0;
    for (let i = 0; i < fullDays; i++) {
      let day = available[cursor++];
      if (day.date === saturday) {
        const next = available.findIndex((d, n) => n >= cursor && d.date !== saturday);
        if (next < 0) throw new Error('Cannot keep Saturday full-day absentee count');
        [available[cursor - 1], available[next]] = [available[next], available[cursor - 1]];
        day = available[cursor - 1];
      }
      events.push({staff_id: person.id, date: day.date, kind: 'full', allocation: 'basic'});
    }
    for (let i = 0; i < halfDays; i++) {
      const day = available[cursor++], shifts = day.weekday === 6 ? ['A', 'B'] : ['A', 'B', 'C'];
      events.push({staff_id: person.id, date: day.date, kind: 'half', work: [shifts[Math.floor(random() * shifts.length)]], allocation: 'basic'});
    }
    const own = events.filter(e => e.staff_id === person.id);
    const units = own.reduce((n, event) => n + leaveUnits(event), 0);
    const expectedUnits = extraWholeWeek ? cal.discretionaryUnits + dates.length * 2 : Math.max(cal.discretionaryUnits, dates.length * 2);
    if (units !== expectedUnits || new Set(own.map(e => e.date)).size !== own.length) throw new Error('Leave budget or dates mismatch');
    return {id: person.id, basicDaysOff: cal.basicDaysOff, fixedClosedDays: cal.fixedClosedDays,
      discretionaryUnits: cal.discretionaryUnits, fullDays: own.filter(e => e.kind === 'full').length,
      halfDays: own.filter(e => e.kind === 'half').length, leaveUnits: units,
      extraUnits: units - cal.discretionaryUnits, totalDaysOff: cal.fixedClosedDays + units / 2,
      expectedCapacityHours: open.length * 8 - units * 4};
  });
  const fixture = {...descriptor, staff: STAFF.map(s => ({...s})), events,
    settings: {closedDates: cal.closedDates, minDaysOff: cal.basicDaysOff}, leaveSummary,
    scenario: {weekly, saturday, expectedConflict: group === 'negative-saturday', modeExceptions: group !== 'random'}};
  fixture.requests = toRequests(events);
  return fixture;
}
function generateFixture(descriptor, {maxAttempts = 1000} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10000) throw new Error('maxAttempts must be an integer from 1 to 10000');
  const rejected = [], rejectionCounts = {};
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Keep sampleId, mandatory leave, employee/week rotation and mode fixed.
    // Only redraw the remaining original leave intentions, never inspect an auto roster.
    const candidateSeed = attempt === 0 ? descriptor.seed : parseInt(hash(`${descriptor.sampleId}/coordinated-input-v2/${attempt}`).slice(0, 8), 16);
    const fixture = generateCandidate(descriptor, candidateSeed);
    const result = inspectOriginalIntent(fixture);
    if (result.accepted) {
      fixture.sampling = {policy: 'COORDINATED_ORIGINAL_INTENT_V2', acceptedAttempt: attempt,
        candidateSeed, rejectedCount: rejected.length, rejectionCounts, rejected,
        allowedConflictDate: result.allowedConflictDate};
      return fixture;
    }
    const category = result.reason.details.stage || result.reason.message.split('：')[0];
    rejectionCounts[category] = (rejectionCounts[category] || 0) + 1;
    rejected.push({attempt, candidateSeed, requestHash: hash(fixture.requests), ...result.reason});
  }
  const error = new Error(`休假意願協調達到 ${maxAttempts} 次上限：${descriptor.sampleId}；未產生可凍結樣本，不能改換情境或冒充測試通過。`);
  error.code = 'INPUT_GENERATION_EXHAUSTED';
  error.details = {descriptor, maxAttempts, rejectionCounts, rejected};
  throw error;
}
module.exports = {MODES, GROUPS, STAFF, hash, descriptors, generateFixture, generateCandidate};
