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
          const assigned = shifts.filter(s => {
            const stations = Object.values(day.slots[s]);
            const occurrences = stations.filter(slot => slot.staff.includes(person.id)).length;
            if (occurrences > 1) throw ScheduleAssignments.error('INTERNAL_INVALID', '同時段跨科重複', { date: day.date, id: person.id, shift: s });
            return occurrences === 1;
          }).sort();
          result.hours += assigned.length * 4;
          const pattern = assigned.join('');
          if (['AC', 'BC', 'AB'].includes(pattern)) weekly[pattern]++;
          if (assigned.length === 1) {
            const voluntary = fixed.length === 1 && fixed[0] === assigned[0] && off.length === shifts.length - 1;
            result[voluntary ? 'voluntarySingle' : 'involuntarySingle']++;
          }
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
    const singles = this.dispersion(people.map(p => p.involuntarySingle));
    const hours = this.dispersion(people.filter(p => p.attainment !== null).map(p => p.attainment));
    const ac = [], bc = [], ab = [];
    weeks.forEach((days, index) => {
      if (!days.some(d => d.isOpen)) return;
      ac.push(this.dispersion(people.map(p => p.weekly[index].AC)));
      bc.push(this.dispersion(people.map(p => p.weekly[index].BC)));
      ab.push(this.dispersion(people.map(p => p.weekly[index].AB)));
    });
    const total = (list, index) => list.reduce((sum, value) => sum + value[index], 0);
    const score = singles.concat(hours, [
      Math.max(0, ...ac.map(v => v[0])), total(ac, 0), total(ac, 1),
      Math.max(0, ...bc.map(v => v[0]), ...ab.map(v => v[0])),
      total(bc, 0) + total(ab, 0), total(bc, 1) + total(ab, 1)
    ]);
    return { staff: people, score: score,
      warnings: people.filter(p => !p.capacityKnown).map(p => ({ id: p.id, code: 'CAPACITY_UNKNOWN' })) };
  }
};
