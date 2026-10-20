/** Statistics and lexicographic policy shared by scheduling and evaluation. */
var ScheduleFairness = {
  compareScores: function(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const delta = (a[i] || 0) - (b[i] || 0);
      if (Math.abs(delta) > 1e-9) return delta < 0 ? -1 : 1;
    }
    return 0;
  },

  dispersion: function(values) {
    if (!values.length) return [0, 0];
    const sum = values.reduce((n, v) => n + v, 0);
    return [Math.max(...values) - Math.min(...values),
      Math.max(0, values.length * values.reduce((n, v) => n + v * v, 0) - sum * sum)];
  },

  measure: function(context, staff) {
    const constraints = context.constraints;
    if (!constraints) throw ScheduleAssignments.error('INTERNAL_INVALID', '公平性統計缺少意願快照');
    const weeks = SchedulingEngine._groupDaysByWeek(context.days);
    const people = staff.map(person => {
      const result = { id: person.id, hours: 0, capacityHours: 0, attainment: null,
        voluntarySingle: 0, involuntarySingle: 0, leaveUnits: 0, weekly: [],
        capacityKnown: Array.isArray(context.submittedStaffIds) && context.submittedStaffIds.includes(person.id) };
      weeks.forEach((days, index) => {
        const weekly = { week: index + 1, AC: 0, BC: 0, AB: 0 };
        days.forEach(day => {
          if (!day.isOpen) return;
          const shifts = Object.keys(day.slots);
          const fixed = shifts.filter(s => constraints.fixed[ScheduleAssignments.key(day.date, s, person.id)]);
          const off = shifts.filter(s => constraints.off[ScheduleAssignments.key(day.date, s, person.id)]);
          let units = 0;
          if (off.length === shifts.length) units = 2;
          else if (fixed.length === 1 && off.length === shifts.length - 1) units = 1;
          else if (off.length && !(fixed.length === 2 && off.length === shifts.length - 2)) {
            result.capacityKnown = false;
          }
          result.leaveUnits += units;
          result.capacityHours += (2 - units) * 4;
          const work = this.workContribution(context, day, person.id);
          result.hours += work.hours;
          if (['AC', 'BC', 'AB'].includes(work.pattern)) weekly[work.pattern]++;
          result.voluntarySingle += work.voluntarySingle;
          result.involuntarySingle += work.involuntarySingle;
        });
        result.weekly.push(weekly);
      });
      if (!result.capacityHours && result.hours) {
        throw ScheduleAssignments.error('INTERNAL_INVALID', '應排工時為零卻有工作', { id: person.id });
      }
      if (result.capacityKnown && result.capacityHours > 0) result.attainment = result.hours / result.capacityHours;
      if (!result.capacityKnown) result.capacityHours = null;
      return result;
    });
    return { staff: people, score: this.scoreStaff(people, weeks.map((days, i) => days.some(d => d.isOpen) ? i : -1).filter(i => i >= 0)),
      warnings: people.filter(p => !p.capacityKnown).map(p => ({ id: p.id, code: 'CAPACITY_UNKNOWN' })) };
  },

  workContribution: function(context, day, id, assigned) {
    const shifts = Object.keys(day.slots);
    if (!assigned) assigned = shifts.filter(shift => {
      const count = Object.values(day.slots[shift]).filter(slot => slot.staff.includes(id)).length;
      if (count > 1) throw ScheduleAssignments.error('INTERNAL_INVALID', '同時段跨科重複', { date: day.date, id: id, shift: shift });
      return count === 1;
    });
    const fixed = shifts.filter(s => context.constraints.fixed[ScheduleAssignments.key(day.date, s, id)]);
    const off = shifts.filter(s => context.constraints.off[ScheduleAssignments.key(day.date, s, id)]);
    const voluntary = assigned.length === 1 && fixed.length === 1 && fixed[0] === assigned[0] && off.length === shifts.length - 1;
    return { hours: assigned.length * 4, pattern: assigned.slice().sort().join(''),
      voluntarySingle: voluntary ? 1 : 0, involuntarySingle: assigned.length === 1 && !voluntary ? 1 : 0 };
  },

  // The same aggregation is used by full-month measurement and Saturday deltas.
  scoreStaff: function(people, activeWeeks) {
    const singles = this.dispersion(people.map(p => p.involuntarySingle));
    const hours = this.dispersion(people.filter(p => p.attainment !== null).map(p => p.attainment));
    const ac = [], bc = [], ab = [];
    activeWeeks.forEach(index => {
      ac.push(this.dispersion(people.map(p => p.weekly[index].AC)));
      bc.push(this.dispersion(people.map(p => p.weekly[index].BC)));
      ab.push(this.dispersion(people.map(p => p.weekly[index].AB)));
    });
    const total = (list, index) => list.reduce((sum, value) => sum + value[index], 0);
    return singles.concat(hours, [
      Math.max(0, ...ac.map(v => v[0])), total(ac, 0), total(ac, 1),
      Math.max(0, ...bc.map(v => v[0]), ...ab.map(v => v[0])),
      total(bc, 0) + total(ab, 0), total(bc, 1) + total(ab, 1)
    ]);
  }
};
