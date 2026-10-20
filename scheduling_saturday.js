/** First allocation of Saturday shifts; candidates never mutate the input roster. */
var SaturdayAllocator = {
  combinations: function*(items, count, start, prefix) {
    start = start || 0;
    prefix = prefix || [];
    if (count === 0) { yield prefix; return; }
    for (let i = start; i <= items.length - count; i++) {
      yield* this.combinations(items, count - 1, i + 1, prefix.concat(items[i]));
    }
  },

  entry: function(context, day, staff) {
    const eligible = {}, locked = {}, targets = {}, choices = {};
    const config = RulesConfig.SHIFTS.SATURDAY;
    ['A', 'B'].forEach(shift => {
      locked[shift] = day.slots[shift].ORTHO.staff.slice().sort();
      eligible[shift] = staff.filter(person => {
        if (locked[shift].includes(person.id)) return true;
        const assigned = Object.keys(day.slots).filter(s => Object.values(day.slots[s]).some(slot => slot.staff.includes(person.id)));
        return assigned.length < 2 && !assigned.includes(shift) &&
          !context.constraints.off[ScheduleAssignments.key(day.date, shift, person.id)];
      }).map(person => person.id).sort();
      targets[shift] = Math.min(config[shift].req_total, eligible[shift].length);
      choices[shift] = eligible[shift].filter(id => !locked[shift].includes(id));
    });
    const supply = new Set(['A', 'B'].flatMap(s => choices[s])).size;
    if (!targets.A && !targets.B) throw ScheduleAssignments.error('INPUT_CONFLICT', '週六無可用骨科人員', { stage: 'SATURDAY_ALLOCATION', date: day.date });
    return { day: day, locked: locked, targets: targets, choices: choices, supply: supply };
  },

  legal: function(context, day, plan, staff) {
    return staff.every(person => {
      let count = 0;
      for (const shift of Object.keys(day.slots)) {
        const peds = day.slots[shift].PEDS.staff.includes(person.id);
        const ortho = (plan[shift] || day.slots[shift].ORTHO.staff).includes(person.id);
        if ((peds && ortho) || ((peds || ortho) && context.constraints.off[ScheduleAssignments.key(day.date, shift, person.id)])) return false;
        if (peds || ortho) count++;
      }
      return count <= 2;
    });
  },

  pairCount: function(plan) {
    return plan.A.filter(id => plan.B.includes(id)).length;
  },

  // Original fixed/off/PEDS constraints determine the table, never current auto staff.
  pairingRule: function(context, day, staff) {
    const config = RulesConfig.SHIFTS.SATURDAY;
    let states = { '0:0': 0 };
    staff.forEach(person => {
      const peds = Object.keys(day.slots).filter(s => day.slots[s].PEDS.staff.includes(person.id));
      const required = ['A', 'B'].filter(s => {
        const key = ScheduleAssignments.key(day.date, s, person.id);
        return !peds.includes(s) && (context.constraints.fixed[key] ||
          (day.slots[s].ORTHO.staff.includes(person.id) && ScheduleAssignments.isLocked(context, day.date, s, 'ORTHO', person.id)));
      });
      const patterns = [];
      for (let mask = 0; mask < 4; mask++) {
        const shifts = ['A', 'B'].filter((_, index) => mask & (1 << index));
        if (shifts.length + peds.length > 2 || !required.every(s => shifts.includes(s)) ||
            shifts.some(s => peds.includes(s) || context.constraints.off[ScheduleAssignments.key(day.date, s, person.id)])) continue;
        patterns.push({ a: Number(shifts.includes('A')), b: Number(shifts.includes('B')), ab: shifts.length === 2 ? 1 : 0 });
      }
      const next = {};
      Object.keys(states).forEach(key => {
        const counts = key.split(':').map(Number);
        patterns.forEach(pattern => {
          const a = counts[0] + pattern.a, b = counts[1] + pattern.b;
          if (a > config.A.req_total || b > config.B.req_total) return;
          const target = a + ':' + b, pairs = states[key] + pattern.ab;
          next[target] = Math.max(next[target] === undefined ? -1 : next[target], pairs);
        });
      });
      states = next;
    });
    return Object.freeze({ maxByCounts: Object.freeze(states) });
  },

  candidate: function(context, day, plan, base, weekIndex, activeWeeks, contributions) {
    const people = base.staff.map(person => {
      const assigned = Object.keys(day.slots).filter(s => day.slots[s].PEDS.staff.includes(person.id) || (plan[s] || day.slots[s].ORTHO.staff).includes(person.id));
      const before = contributions[person.id];
      const after = ScheduleFairness.workContribution(context, day, person.id, assigned);
      const next = Object.assign({}, person, { weekly: person.weekly.slice(),
        hours: person.hours + after.hours - before.hours,
        voluntarySingle: person.voluntarySingle + after.voluntarySingle - before.voluntarySingle,
        involuntarySingle: person.involuntarySingle + after.involuntarySingle - before.involuntarySingle });
      next.weekly[weekIndex] = Object.assign({}, person.weekly[weekIndex]);
      ['AC', 'BC', 'AB'].forEach(pattern => {
        next.weekly[weekIndex][pattern] += (after.pattern === pattern ? 1 : 0) - (before.pattern === pattern ? 1 : 0);
      });
      if (person.capacityKnown && person.capacityHours === 0 && next.hours) throw ScheduleAssignments.error('INTERNAL_INVALID', '應排工時為零卻有工作', { id: person.id });
      next.attainment = person.attainment === null ? null : next.hours / person.capacityHours;
      return next;
    });
    return { staff: people, score: ScheduleFairness.scoreStaff(people, activeWeeks), warnings: base.warnings };
  },

  // Fairness equality is required before this deterministic calendar-week tie break.
  preferPlan: function(plan, other, order) {
    for (const id of order) {
      const count = p => Number(p.A.includes(id)) + Number(p.B.includes(id));
      if (count(plan) !== count(other)) return count(plan) > count(other);
    }
    for (const id of order) for (const shift of ['A', 'B']) {
      if (plan[shift].includes(id) !== other[shift].includes(id)) return plan[shift].includes(id);
    }
    return JSON.stringify(plan) < JSON.stringify(other);
  },

  patterns: function(context, staff) {
    return staff.map(person => {
      const result = { id: person.id, AB: 0, A: 0, B: 0, unassigned: 0 };
      context.days.filter(d => d.isOpen && d.dayOfWeek === 6).forEach(day => {
        const pattern = ScheduleFairness.workContribution(context, day, person.id).pattern;
        if (pattern) result[pattern] = (result[pattern] || 0) + 1;
        else result.unassigned++;
      });
      return result;
    });
  },

  allocate: function(context, staff, options) {
    options = Object.assign({}, SATURDAY_ALLOCATION_OPTIONS, options || {});
    ScheduleAdjustments.validate(context, staff, { requireMinimumCoverage: false });
    const now = options.now || Date.now;
    const started = now(), deadline = started + options.timeLimitMs;
    const current = Object.assign({}, context, { days: context.days.map(day => day.dayOfWeek === 6 && day.isOpen ? JSON.parse(JSON.stringify(day)) : day) });
    const weeks = SchedulingEngine._groupDaysByWeek(current.days);
    const weekByDate = {};
    weeks.forEach((days, index) => days.forEach(day => { weekByDate[day.date] = index; }));
    const activeWeeks = weeks.map((days, i) => days.some(day => day.isOpen) ? i : -1).filter(i => i >= 0);
    const entries = current.days.filter(day => day.dayOfWeek === 6 && day.isOpen).map(day => this.entry(current, day, staff))
      .sort((a, b) => a.supply - b.supply || a.day.date.localeCompare(b.day.date));
    const pairingRules = {};
    entries.forEach(entry => { pairingRules[entry.day.date] = this.pairingRule(context, entry.day, staff); });
    current.saturdayPairingRules = Object.freeze(pairingRules);
    let base = ScheduleFairness.measure(current, staff);
    const report = { days: [], before: base, after: null, elapsedMs: 0, fullMeasurements: 1, patternsBefore: this.patterns(context, staff) };
    for (const entry of entries) {
      const day = entry.day, dayStart = now(), index = weekByDate[day.date];
      const order = SchedulingEngine._getWeeklyStaffOrder(staff, index).map(p => p.id);
      const maxAB = pairingRules[day.date].maxByCounts[entry.targets.A + ':' + entry.targets.B];
      if (maxAB === undefined) throw ScheduleAssignments.error('SATURDAY_TARGET_UNREACHABLE', '週六指定與目標人數無合法配對方案', { stage: 'SATURDAY_ALLOCATION', date: day.date, targets: entry.targets });
      const contributions = {};
      staff.forEach(p => { contributions[p.id] = ScheduleFairness.workContribution(current, day, p.id); });
      let best = null, evaluated = 0, legalPlans = 0, stopReason = 'COMPLETE', usedTieBreak = false;
      search: for (const A of this.combinations(entry.choices.A, entry.targets.A - entry.locked.A.length)) {
        for (const B of this.combinations(entry.choices.B, entry.targets.B - entry.locked.B.length)) {
          if (now() >= deadline) { stopReason = 'TIME_LIMIT'; break search; }
          const plan = { A: entry.locked.A.concat(A).sort(), B: entry.locked.B.concat(B).sort() };
          if (!this.legal(current, day, plan, staff)) continue;
          legalPlans++;
          if (this.pairCount(plan) !== maxAB) continue;
          if (evaluated >= options.maxCandidatesPerDay) { stopReason = 'CANDIDATE_LIMIT'; break search; }
          const measure = this.candidate(current, day, plan, base, index, activeWeeks, contributions);
          evaluated++;
          if (options.onCandidate) options.onCandidate({ date: day.date, plan: JSON.parse(JSON.stringify(plan)), score: measure.score.slice() });
          const comparison = best ? ScheduleFairness.compareScores(measure.score, best.measure.score) : -1;
          if (comparison < 0) { best = { plan: plan, measure: measure }; usedTieBreak = false; }
          else if (comparison === 0) {
            usedTieBreak = true;
            if (this.preferPlan(plan, best.plan, order)) best = { plan: plan, measure: measure };
          }
        }
      }
      if (!best) throw ScheduleAssignments.error(stopReason === 'COMPLETE' ? 'SATURDAY_TARGET_UNREACHABLE' : 'SEARCH_LIMIT',
        '週六分配未取得完整合法方案', { stage: 'SATURDAY_ALLOCATION', date: day.date, targets: entry.targets, evaluated: evaluated, stopReason: stopReason });
      ['A', 'B'].forEach(shift => best.plan[shift].forEach(id => {
        if (!day.slots[shift].ORTHO.staff.includes(id)) ScheduleAssignments.add(day, shift, 'ORTHO', id, 'AUTO_SAT_' + shift);
      }));
      ScheduleAdjustments.validate(current, staff, { requireMinimumCoverage: false });
      base = best.measure;
      report.days.push({ date: day.date, targets: entry.targets, actual: { A: day.slots.A.ORTHO.staff.length, B: day.slots.B.ORTHO.staff.length },
        locked: entry.locked, plan: best.plan, maxAB: maxAB, actualAB: this.pairCount(best.plan), minSingles: entry.targets.A + entry.targets.B - 2 * maxAB, legalPlans: legalPlans, evaluated: evaluated, complete: stopReason === 'COMPLETE', stopReason: stopReason,
        score: base.score, order: order, usedTieBreak: usedTieBreak, elapsedMs: now() - dayStart });
    }
    // Independent full recomputation catches cache drift before exposing the result.
    const verified = ScheduleFairness.measure(current, staff);
    report.fullMeasurements++;
    if (ScheduleFairness.compareScores(verified.score, base.score) !== 0) throw ScheduleAssignments.error('INTERNAL_INVALID', '週六增量統計與完整統計不一致');
    report.after = verified;
    report.patternsAfter = this.patterns(current, staff);
    report.elapsedMs = now() - started;
    current.saturdayAllocationReport = report;
    return { context: current, report: report };
  }
};
