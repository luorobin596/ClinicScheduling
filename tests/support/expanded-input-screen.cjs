'use strict';
const {engine} = require('./engine-harness.cjs');

// Reuse the actual fixed/PEDS rules and exact DAILY input-feasibility check.
// Do not call initial scheduling, Saturday allocation, repair or fairness search.
// One sandbox per settings/staff combination avoids loading six modules on every draw.
const sandboxes = new Map();
function inspectOriginalIntent(fixture) {
  const cacheKey = JSON.stringify([fixture.staff, fixture.settings]);
  if (!sandboxes.has(cacheKey)) sandboxes.set(cacheKey, engine([], {staff: fixture.staff, settings: fixture.settings}));
  const loaded = sandboxes.get(cacheKey);
  try {
    const context = loaded.e.createContext(fixture.month);
    context.staffList = fixture.staff;
    const requests = Object.assign(fixture.requests.slice(), {submittedStaffIds: fixture.staff.map(s => s.id)});
    loaded.e._fillFixedShifts(context, loaded.rules, requests);
    const allowedConflictDate = fixture.scenario.expectedConflict ? fixture.scenario.saturday : null;
    if (allowedConflictDate) {
      const target = context.days.find(day => day.date === allowedConflictDate);
      if (!target || !target.isOpen || target.dayOfWeek !== 6 || !fixture.staff.every(person =>
        ['A', 'B'].every(shift => fixture.requests.some(request => request.staff_id === person.id &&
          request.date === allowedConflictDate && request.shift === shift && request.type === 'off')))) {
        throw new Error('Negative Saturday fixture must deliberately block every staff member on an open Saturday');
      }
    }
    loaded.adjustments.assertFeasible({...context, days: context.days.filter(day => day.date !== allowedConflictDate)}, fixture.staff);
    return {accepted: true, allowedConflictDate};
  } catch (error) {
    // An internal error is not an invalid leave draw: stop and surface it.
    if (error.code !== 'INPUT_CONFLICT') throw error;
    return {accepted: false, reason: {code: error.code, message: error.message, details: error.details || {}}};
  }
}
module.exports = {inspectOriginalIntent};
