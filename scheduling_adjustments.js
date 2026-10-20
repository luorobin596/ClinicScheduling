/** Bounded roster repair and fairness optimization. No Google service writes. */
var ScheduleAdjustments = {
  coverage: function(context) {
    const findings = [];
    context.days.forEach(day => {
      if (!day.isOpen) return;
      const ids = new Set();
      Object.values(day.slots).forEach(stations => stations.ORTHO.staff.forEach(id => ids.add(id)));
      const missing = day.dayOfWeek === 6 ? [] : ['A', 'B', 'C'].filter(s => !day.slots[s] || !day.slots[s].ORTHO.staff.length);
      const shortage = Math.max(0, (day.dayOfWeek === 6 ? 1 : 2) - ids.size);
      if (missing.length || shortage) findings.push({ date: day.date, missingShifts: missing, staffShortage: shortage, staffCount: ids.size });
    });
    return findings;
  },

  validate: function(context, staff, options) {
    options = options || {};
    ScheduleAssignments.validateMetadata(context);
    const ids = new Set(staff.map(p => p.id));
    const actual = {};
    context.days.forEach(day => {
      const dailyCounts = {};
      Object.entries(day.slots).forEach(([shift, stations]) => {
        const sameShift = new Set();
        const config = day.dayOfWeek === 6 ? RulesConfig.SHIFTS.SATURDAY : RulesConfig.SHIFTS.WEEKDAY;
        if (!day.isOpen || !config[shift]) throw ScheduleAssignments.error('INTERNAL_INVALID', '休診日或無效班別有指派', { date: day.date, shift: shift });
        if (stations.ORTHO.staff.length > config[shift].req_total || stations.PEDS.staff.length > 1) {
          throw ScheduleAssignments.error('INTERNAL_INVALID', '班別超過人數上限', { date: day.date, shift: shift });
        }
        Object.entries(stations).forEach(([station, slot]) => slot.staff.forEach(id => {
          const key = ScheduleAssignments.key(day.date, shift, id);
          if (!ids.has(id) || sameShift.has(id) || context.constraints.off[key]) {
            throw ScheduleAssignments.error('INTERNAL_INVALID', '未知員工、跨科重複或違反休假', { date: day.date, shift: shift, id: id });
          }
          sameShift.add(id);
          actual[key] = station;
          dailyCounts[id] = (dailyCounts[id] || 0) + 1;
          if (dailyCounts[id] > 2) throw ScheduleAssignments.error('INTERNAL_INVALID', '每日超過兩班', { date: day.date, id: id });
        }));
      });
    });
    Object.keys(context.constraints.fixed).forEach(key => {
      if (!actual[key]) throw ScheduleAssignments.error('INTERNAL_INVALID', '指定班遺失', { key: key });
    });
    Object.keys(context.constraints.peds).forEach(key => {
      if (actual[key] !== 'PEDS') throw ScheduleAssignments.error('INTERNAL_INVALID', '小兒固定或代班遺失', { key: key });
    });
    if (context.saturdayPairingRules) context.days.forEach(day => {
      if (!day.isOpen || day.dayOfWeek !== 6 || (options.saturdayDates && !options.saturdayDates.includes(day.date))) return;
      const rule = context.saturdayPairingRules[day.date];
      if (!rule) throw ScheduleAssignments.error('INTERNAL_INVALID', '缺少週六配對限制', { date: day.date });
      const a = day.slots.A.ORTHO.staff, b = day.slots.B.ORTHO.staff;
      const maximum = rule.maxByCounts[a.length + ':' + b.length];
      const actual = a.filter(id => b.includes(id)).length;
      if (maximum === undefined || actual !== maximum) throw ScheduleAssignments.error('INTERNAL_INVALID', '週六未保留最大可行 AB 配對', {
        date: day.date, counts: { A: a.length, B: b.length }, maxAB: maximum, actualAB: actual
      });
    });
    if (options.requireMinimumCoverage && this.coverage(context).length) {
      throw ScheduleAssignments.error('COVERAGE_UNRESOLVED', '骨科最低覆蓋未達標', { findings: this.coverage(context) });
    }
    return true;
  },

  // Only touched days are cloned. Constraints are shared read-only snapshots.
  apply: function(context, operations, staff, options) {
    const candidate = Object.assign({}, context, { days: context.days.slice(),
      adjustmentHistory: (context.adjustmentHistory || []).slice() });
    const touched = new Set(operations.flatMap(op => [op.remove && op.remove.date, op.add && op.add.date]).filter(Boolean));
    candidate.days = candidate.days.map(day => touched.has(day.date) ? JSON.parse(JSON.stringify(day)) : day);
    const removed = [];
    operations.forEach(op => {
      if (!op.remove) { removed.push(null); return; }
      const from = op.remove;
      const day = candidate.days.find(d => d.date === from.date);
      const slot = day && day.slots[from.shift] && day.slots[from.shift][from.station];
      if (!slot || !slot.staff.includes(from.id) || ScheduleAssignments.isLocked(context, from.date, from.shift, from.station, from.id)) {
        throw ScheduleAssignments.error('INTERNAL_INVALID', '不能移除不存在或鎖定的指派', { position: from });
      }
      removed.push(slot.assignmentMeta[from.id]);
      slot.staff.splice(slot.staff.indexOf(from.id), 1);
      delete slot.assignmentMeta[from.id];
    });
    operations.forEach((op, index) => {
      if (!op.add) return;
      const to = op.add;
      const day = candidate.days.find(d => d.date === to.date);
      const slot = day && day.slots[to.shift] && day.slots[to.shift][to.station];
      if (!slot || !day.isOpen || to.station !== 'ORTHO' || slot.staff.includes(to.id)) {
        throw ScheduleAssignments.error('INTERNAL_INVALID', '無效或重複的調整目標', { position: to });
      }
      const meta = ScheduleAssignments.add(day, to.shift, to.station, to.id, op.source || 'COVERAGE_REPAIR');
      if (removed[index]) {
        meta.originalSource = removed[index].originalSource;
        meta.origin = removed[index].origin;
      }
    });
    this.validate(candidate, staff, Object.assign({}, options || {}, { saturdayDates: Array.from(touched) }));
    candidate.adjustmentHistory.push({ operations: JSON.parse(JSON.stringify(operations)), beforeSources: removed.map(meta => meta ? meta.source : null), afterSources: operations.map(op => op.add ? (op.source || 'COVERAGE_REPAIR') : null) });
    return candidate;
  },

  loss: function(findings) { return findings.reduce((sum, f) => sum + f.missingShifts.length + f.staffShortage, 0); },

  preservesCoverage: function(before, after) {
    const map = {};
    before.forEach(f => { map[f.date] = f; });
    return after.every(f => map[f.date] && f.staffShortage <= map[f.date].staffShortage &&
      f.missingShifts.every(s => map[f.date].missingShifts.includes(s)));
  },

  budget: function(options) {
    options = options || {};
    const now = options.now || Date.now;
    const start = now();
    return { now: now, start: start, deadline: options.deadline === undefined ? start + (options.timeLimitMs === undefined ? 10000 : options.timeLimitMs) : options.deadline,
      maxCandidates: options.maxCandidates === undefined ? 20000 : options.maxCandidates,
      maxAccepted: options.maxAccepted === undefined ? 200 : options.maxAccepted,
      evaluated: 0, accepted: 0, stop: null };
  },

  exhausted: function(budget) {
    if (budget.now() >= budget.deadline) budget.stop = 'TIME_LIMIT';
    else if (budget.evaluated >= budget.maxCandidates) budget.stop = 'CANDIDATE_LIMIT';
    else if (budget.accepted >= budget.maxAccepted) budget.stop = 'ADJUSTMENT_LIMIT';
    return !!budget.stop;
  },

  report: function(budget, before, after) {
    return { evaluated: budget.evaluated, accepted: budget.accepted, elapsedMs: budget.now() - budget.start,
      stopReason: budget.stop || 'NO_IMPROVEMENT', before: before, after: after };
  },

  // Exact daily feasibility checks only the original constraints and fixed PEDS.
  // There are at most seven <=2-shift orthopedic subsets per person, not month permutations.
  assertFeasible: function(context, staff) {
    context.days.forEach(day => {
      if (!day.isOpen) return;
      const shifts = Object.keys(day.slots);
      const config = day.dayOfWeek === 6 ? RulesConfig.SHIFTS.SATURDAY : RulesConfig.SHIFTS.WEEKDAY;
      const choices = staff.map(person => {
        const peds = shifts.filter(s => day.slots[s].PEDS.staff.includes(person.id));
        const fixed = shifts.filter(s => context.constraints.fixed[ScheduleAssignments.key(day.date, s, person.id)] && !peds.includes(s));
        const allowed = shifts.filter(s => !peds.includes(s) && !context.constraints.off[ScheduleAssignments.key(day.date, s, person.id)]);
        const subsets = [];
        for (let mask = 0; mask < (1 << allowed.length); mask++) {
          const subset = allowed.filter((s, i) => mask & (1 << i));
          if (subset.length + peds.length <= 2 && fixed.every(s => subset.includes(s))) subsets.push(subset);
        }
        return subsets.sort((a, b) => b.length - a.length);
      }).sort((a, b) => a.length - b.length);
      const counts = {};
      const visit = (index, people) => {
        if (index === choices.length) return people >= (day.dayOfWeek === 6 ? 1 : 2) &&
          (day.dayOfWeek === 6 || ['A', 'B', 'C'].every(s => counts[s] > 0));
        for (const subset of choices[index]) {
          if (subset.some(s => (counts[s] || 0) >= config[s].req_total)) continue;
          subset.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
          const found = visit(index + 1, people + (subset.length ? 1 : 0));
          subset.forEach(s => { counts[s]--; });
          if (found) return true;
        }
        return false;
      };
      if (!visit(0, 0)) throw ScheduleAssignments.error('INPUT_CONFLICT',
        `骨科最低覆蓋與當日意願/小兒固定班衝突：${day.date}`, {
          date: day.date, stage: 'COVERAGE_FEASIBILITY',
          availableOrthoShiftCapacity: choices.reduce((n, list) => n + Math.max(0, ...list.map(x => x.length)), 0),
          requiredOrthoShiftCoverage: day.dayOfWeek === 6 ? 1 : 3
        });
    });
  },

  // Candidate ordering is deterministic: dates, shifts, then sorted staff IDs.
  repair: function(context, staff, options) {
    this.validate(context, staff, { requireMinimumCoverage: false });
    this.assertFeasible(context, staff);
    const budget = this.budget(options);
    let current = context;
    const initial = this.coverage(context);
    while (this.coverage(current).length && !this.exhausted(budget)) {
      const before = this.coverage(current);
      const loss = this.loss(before);
      let best = null;
      const evaluate = operations => {
        if (this.exhausted(budget)) return false;
        budget.evaluated++;
        let trial;
        try { trial = this.apply(current, operations, staff, { requireMinimumCoverage: false }); }
        catch (error) { if (error.code !== 'INTERNAL_INVALID' && error.code !== 'INPUT_CONFLICT') throw error; return true; }
        const findings = this.coverage(trial);
        const nextLoss = this.loss(findings);
        if (nextLoss >= loss || !this.preservesCoverage(before, findings)) return true;
        const measure = ScheduleFairness.measure(trial, staff);
        if (!best || nextLoss < best.loss || (nextLoss === best.loss && (ScheduleFairness.compareScores(measure.score, best.score) < 0 || (ScheduleFairness.compareScores(measure.score, best.score) === 0 && operations.length < best.operations)))) {
          best = { context: trial, loss: nextLoss, score: measure.score, operations: operations.length };
        }
        return true;
      };
      const people = staff.slice().sort((a, b) => a.id.localeCompare(b.id));
      const problems = before.slice().sort((a, b) => {
        const availability = f => people.filter(p => Object.keys(current.days.find(d => d.date === f.date).slots).some(s =>
          !current.constraints.off[ScheduleAssignments.key(f.date, s, p.id)])).length;
        return availability(a) - availability(b) || a.date.localeCompare(b.date);
      });
      // Tier 1: same-day moves and a two-operation exchange that can release a full day.
      for (const finding of problems) {
        const day = current.days.find(d => d.date === finding.date);
        const targets = finding.missingShifts.length ? finding.missingShifts : Object.keys(day.slots);
        for (const target of targets) for (const fromShift of Object.keys(day.slots)) {
          if (fromShift === target) continue;
          for (const id of day.slots[fromShift].ORTHO.staff) {
            const remove = { date: day.date, shift: fromShift, station: 'ORTHO', id: id };
            const add = { date: day.date, shift: target, station: 'ORTHO', id: id };
            evaluate([{ remove: remove, add: add, source: 'COVERAGE_REPAIR' }]);
            for (const person of people) {
              if (person.id === id) continue;
              // Move one person's spare shift and transfer another shift to that person.
              for (const released of Object.keys(day.slots)) {
                if (!day.slots[released].ORTHO.staff.includes(person.id)) continue;
                evaluate([
                  { remove: { date: day.date, shift: released, station: 'ORTHO', id: person.id }, add: add, source: 'COVERAGE_REPAIR' },
                  { remove: remove, add: { date: day.date, shift: fromShift, station: 'ORTHO', id: person.id }, source: 'COVERAGE_REPAIR' }
                ]);
              }
            }
            if (this.exhausted(budget)) break;
          }
        }
        if (this.exhausted(budget)) break;
      }
      // Tier 2: cross-day donor moves, then two-operation swaps. Never remove sole coverage.
      if (!best && !this.exhausted(budget)) {
        const donors = this.assignments(current);
        for (const finding of problems) {
          const targetDay = current.days.find(d => d.date === finding.date);
          for (const shift of (finding.missingShifts.length ? finding.missingShifts : Object.keys(targetDay.slots))) {
            for (const donor of donors) {
              if (donor.date === finding.date) continue;
              const target = { date: finding.date, shift: shift, station: 'ORTHO', id: donor.id };
              evaluate([{ remove: donor, add: target, source: 'COVERAGE_REPAIR' }]);
              for (const other of this.assignments(current, finding.date)) {
                evaluate([
                  { remove: donor, add: target, source: 'COVERAGE_REPAIR' },
                  { remove: other, add: { date: donor.date, shift: donor.shift, station: 'ORTHO', id: other.id }, source: 'COVERAGE_REPAIR' }
                ]);
              }
              if (this.exhausted(budget)) break;
            }
            if (this.exhausted(budget)) break;
          }
          if (this.exhausted(budget)) break;
        }
      }
      // Tier 3: add only after no improving move/exchange exists in the searched space.
      if (!best && !this.exhausted(budget)) {
        for (const finding of problems) {
          const day = current.days.find(d => d.date === finding.date);
          for (const shift of (finding.missingShifts.length ? finding.missingShifts : Object.keys(day.slots))) {
            for (const person of people) {
              evaluate([{ add: { date: day.date, shift: shift, station: 'ORTHO', id: person.id }, source: 'COVERAGE_REPAIR' }]);
              if (this.exhausted(budget)) break;
            }
            if (this.exhausted(budget)) break;
          }
          if (this.exhausted(budget)) break;
        }
      }
      if (!best) break;
      current = best.context;
      budget.accepted++;
    }
    const remaining = this.coverage(current);
    const report = this.report(budget, initial, remaining);
    if (remaining.length) throw ScheduleAssignments.error(budget.stop ? 'SEARCH_LIMIT' : 'COVERAGE_UNRESOLVED',
      '未能完成骨科最低覆蓋修補（有限搜尋不代表無解）', { stage: 'COVERAGE_REPAIR', report: report, findings: remaining, initialSnapshot: { days: context.days }, bestSnapshot: { days: current.days, history: current.adjustmentHistory } });
    report.stopReason = 'COVERAGE_SATISFIED';
    return { context: current, report: report };
  },

  assignments: function(context, date) {
    const result = [];
    context.days.forEach(day => {
      if (date && day.date !== date) return;
      Object.entries(day.slots).forEach(([shift, stations]) => stations.ORTHO.staff.forEach(id => {
        if (!ScheduleAssignments.isLocked(context, day.date, shift, 'ORTHO', id)) result.push({ date: day.date, shift: shift, station: 'ORTHO', id: id });
      }));
    });
    return result;
  },

  improve: function(context, staff, options) {
    this.validate(context, staff, { requireMinimumCoverage: true });
    const budget = this.budget(options);
    let current = context;
    const before = ScheduleFairness.measure(context, staff);
    let measure = before;
    while (!this.exhausted(budget)) {
      let best = null;
      const people = staff.slice().sort((a, b) => a.id.localeCompare(b.id));
      const assignments = this.assignments(current);
      const evaluate = operations => {
        if (this.exhausted(budget)) return;
        budget.evaluated++;
        let candidate;
        try { candidate = this.apply(current, operations, staff, { requireMinimumCoverage: true }); }
        catch (error) { if (error.code !== 'INTERNAL_INVALID' && error.code !== 'INPUT_CONFLICT') throw error; return; }
        const next = ScheduleFairness.measure(candidate, staff);
        if (ScheduleFairness.compareScores(next.score, measure.score) >= 0) return;
        if (!best || ScheduleFairness.compareScores(next.score, best.measure.score) < 0) best = { context: candidate, measure: next };
      };
      // Transfers preserve each slot headcount; they can rebalance hours and singles.
      for (const from of assignments) {
        for (const person of people) {
          if (from.id === person.id) continue;
          evaluate([{ remove: from, add: Object.assign({}, from, { id: person.id }), source: 'FAIRNESS_ADJUST' }]);
          if (this.exhausted(budget)) break;
        }
        if (this.exhausted(budget)) break;
      }
      // Two-slot personnel swaps can improve weekly patterns without changing hours.
      if (!this.exhausted(budget)) {
        for (let i = 0; i < assignments.length; i++) {
          const first = assignments[i];
          for (let j = i + 1; j < assignments.length; j++) {
            const second = assignments[j];
            if (first.id === second.id || (first.date === second.date && first.shift === second.shift)) continue;
            evaluate([
              { remove: first, add: Object.assign({}, first, { id: second.id }), source: 'FAIRNESS_ADJUST' },
              { remove: second, add: Object.assign({}, second, { id: first.id }), source: 'FAIRNESS_ADJUST' }
            ]);
            if (this.exhausted(budget)) break;
          }
          if (this.exhausted(budget)) break;
        }
      }
      if (!best) break;
      current = best.context;
      measure = best.measure;
      budget.accepted++;
    }
    return { context: current, report: this.report(budget, before, measure) };
  }
};
