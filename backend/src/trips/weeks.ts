const DAY_MS = 24 * 60 * 60 * 1000;

// How many weekly targets a trip's plan has. Weeks run 7 days from the start
// date; the last one also takes the days left over before the end date, so a
// 50-day window is 7 weeks with an 8-day last week, not 7 weeks and a stub.
// Dates are YYYY-MM-DD, both inclusive.
export function tripWeekCount(startDate, endDate) {
  const days = (Date.parse(endDate) - Date.parse(startDate)) / DAY_MS + 1;
  return Math.max(1, Math.floor(days / 7));
}
