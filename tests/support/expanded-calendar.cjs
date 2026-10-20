'use strict';

// Clinic calendar agreed for this campaign; ordinary Saturdays remain open.
const HOLIDAYS = Object.freeze({
  '2026-09': ['2026-09-25', '2026-09-28'],
  '2026-10': ['2026-10-09', '2026-10-10', '2026-10-25', '2026-10-26'],
  '2026-11': []
});
function calendar(month) {
  if (!Object.hasOwn(HOLIDAYS, month)) throw new Error(`Unsupported campaign month: ${month}`);
  const [year, number] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const closedDates = HOLIDAYS[month].slice();
  const days = Array.from({length: count}, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    return {date, weekday, isOpen: weekday !== 0 && !closedDates.includes(date)};
  });
  const weekendDays = days.filter(d => [0, 6].includes(d.weekday)).length;
  const weekdayHolidays = days.filter(d => d.weekday > 0 && d.weekday < 6 && closedDates.includes(d.date)).length;
  const fixedClosedDays = days.filter(d => !d.isOpen).length;
  const basicDaysOff = weekendDays + weekdayHolidays;
  const fullWeeks = days.filter(d => d.weekday === 0).map(d => {
    const start = days.indexOf(d);
    return days.slice(start, start + 7);
  }).filter(week => week.length === 7);
  return {month, days, closedDates, fullWeeks, weekendDays, weekdayHolidays,
    fixedClosedDays, basicDaysOff, discretionaryUnits: (basicDaysOff - fixedClosedDays) * 2};
}
module.exports = {calendar, MONTHS: Object.keys(HOLIDAYS)};
