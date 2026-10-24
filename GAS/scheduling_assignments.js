/** Per-person provenance and immutable request constraints for one scheduling run. */
var ScheduleAssignments = {
  key: function(date, shift, id) { return JSON.stringify([date, shift, id]); },

  error: function(code, message, details) {
    const error = new Error(message);
    error.code = code;
    error.details = details || {};
    return error;
  },

  normalizeRequests: function(requests) {
    if (!Array.isArray(requests)) throw this.error('INPUT_CONFLICT', '意願資料必須為陣列');
    const result = [];
    const seen = {};
    (requests || []).forEach(request => {
      if (!request || typeof request !== 'object') throw this.error('INPUT_CONFLICT', '無效意願資料');
      let date = request.date;
      if (Object.prototype.toString.call(date) === '[object Date]') {
        date = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      date = String(date || '').trim().replace(/\//g, '-');
      const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);
      if (match) date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
      const id = String(request.staff_id || '').trim();
      const shift = String(request.shift || '').trim().toUpperCase();
      const type = String(request.type || '').trim().toLowerCase();
      const parsed = new Date(`${date}T12:00:00Z`);
      if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parsed.getTime()) ||
          parsed.toISOString().slice(0, 10) !== date || !['A', 'B', 'C'].includes(shift) ||
          !['fixed', 'off'].includes(type)) {
        throw this.error('INPUT_CONFLICT', '無效的排班意願資料', { request: request });
      }
      const key = this.key(date, shift, id);
      if (seen[key] && seen[key] !== type) {
        throw this.error('INPUT_CONFLICT', `${date} ${shift} ${id} 同時指定上班與休假`);
      }
      if (!seen[key]) result.push({ date: date, shift: shift, staff_id: id, type: type });
      seen[key] = type;
    });
    const fixedDays = {};
    result.filter(r => r.type === 'fixed').forEach(r => {
      const key = JSON.stringify([r.date, r.staff_id]);
      fixedDays[key] = (fixedDays[key] || 0) + 1;
      if (fixedDays[key] > 2) throw this.error('INPUT_CONFLICT', `${r.date} ${r.staff_id} 指定超過兩班`);
    });
    return result;
  },

  prepare: function(context, requests) {
    const normalized = this.normalizeRequests(requests);
    context.requests = normalized;
    if (requests.submittedStaffIds) context.submittedStaffIds = requests.submittedStaffIds.slice();
    else if (!context.submittedStaffIds) context.submittedStaffIds = Array.from(new Set(normalized.map(r => r.staff_id)));
    const constraints = { fixed: {}, off: {}, peds: {} };
    normalized.forEach(r => {
      if (r.date.slice(0, 7) !== context.runIdStr) {
        throw this.error('INPUT_CONFLICT', `意願日期不屬於 ${context.runIdStr}`, { request: r });
      }
      constraints[r.type][this.key(r.date, r.shift, r.staff_id)] = true;
    });
    normalized.filter(r => r.type === 'fixed').forEach(r => {
      const day = context.days.find(d => d.date === r.date);
      if (!day || !day.isOpen || !day.slots[r.shift]) throw this.error('INPUT_CONFLICT', '指定班落在休診日或不存在的班別', { request: r });
    });
    context.constraints = constraints;
    context.adjustmentHistory = [];
    context.days.forEach(day => {
      if (!day.isOpen) return;
      Object.keys(day.slots).forEach(shift => {
        day.slots[shift] = {
          ORTHO: { staff: [], off: [], assignmentMeta: {}, note: '' },
          PEDS: { staff: [], off: [], assignmentMeta: {}, note: '' }
        };
      });
    });
    return normalized;
  },

  add: function(day, shift, station, id, source, origin, lockReasons) {
    const slot = day.slots[shift] && day.slots[shift][station];
    if (!slot || !source) throw this.error('INTERNAL_INVALID', '指派位置或來源不存在', { date: day.date, shift: shift, id: id });
    if (!slot.assignmentMeta) slot.assignmentMeta = {};
    origin = origin || 'AUTO';
    lockReasons = lockReasons || [];
    if (slot.staff.includes(id)) {
      const existing = slot.assignmentMeta[id];
      if (!existing) throw this.error('INTERNAL_INVALID', '既有指派缺少來源', { date: day.date, shift: shift, id: id });
      existing.lockReasons = Array.from(new Set(existing.lockReasons.concat(lockReasons)));
      return existing;
    }
    slot.staff.push(id);
    slot.assignmentMeta[id] = {
      source: source, originalSource: source, origin: origin, lockReasons: lockReasons.slice()
    };
    return slot.assignmentMeta[id];
  },

  isLocked: function(context, date, shift, station, id) {
    const constraints = context.constraints;
    if (!constraints) throw this.error('INTERNAL_INVALID', '缺少原始意願限制');
    const key = this.key(date, shift, id);
    const day = context.days.find(d => d.date === date);
    const slot = day && day.slots[shift] && day.slots[shift][station];
    const meta = slot && slot.assignmentMeta && slot.assignmentMeta[id];
    return !!(constraints.fixed[key] || constraints.peds[key] || station === 'PEDS' ||
      (meta && meta.lockReasons.length));
  },

  validateMetadata: function(context) {
    context.days.forEach(day => Object.keys(day.slots).forEach(shift => {
      Object.keys(day.slots[shift]).forEach(station => {
        const slot = day.slots[shift][station];
        const metadata = slot.assignmentMeta || {};
        if (new Set(slot.staff).size !== slot.staff.length ||
            Object.keys(metadata).length !== slot.staff.length) {
          throw this.error('INTERNAL_INVALID', '指派與來源數量不一致', { date: day.date, shift: shift, station: station, staffIds: slot.staff.slice(), metadataIds: Object.keys(metadata) });
        }
        slot.staff.forEach(id => {
          const meta = metadata[id];
          if (!meta || !meta.source || !meta.originalSource || !meta.origin || !Array.isArray(meta.lockReasons)) {
            throw this.error('INTERNAL_INVALID', `缺少逐人來源：${day.date} ${shift} ${station} ${id}`, { date: day.date, shift: shift, station: station, id: id });
          }
        });
      });
    }));
    return true;
  }
};
