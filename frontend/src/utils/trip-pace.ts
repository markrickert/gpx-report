const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Today in the viewer's own timezone, as the YYYY-MM-DD the server uses for trip dates. */
export function localDate(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Where someone stands against a straight line from 0 on the day before
 * startDate to the goal at the end of endDate. Both dates are inclusive, and
 * today counts as a day still left to train on.
 */
export function tripPace({
  goalMeters,
  startDate,
  endDate,
  totalMeters,
  today = localDate(),
}: {
  goalMeters: number;
  startDate: string;
  endDate: string;
  totalMeters: number;
  today?: string;
}) {
  const start = dayNumber(startDate);
  const end = dayNumber(endDate);
  const now = dayNumber(today);
  const totalDays = end - start + 1;
  const elapsedDays = Math.min(Math.max(now - start + 1, 0), totalDays);
  const daysRemaining = Math.min(Math.max(end - now + 1, 0), totalDays);
  const expectedMeters = (goalMeters * elapsedDays) / totalDays;
  const remainingMeters = Math.max(goalMeters - totalMeters, 0);

  return {
    expectedMeters,
    aheadMeters: totalMeters - expectedMeters,
    daysRemaining,
    // With under a week left, "per week" is just what's left.
    neededPerWeekMeters: daysRemaining ? remainingMeters / Math.max(daysRemaining / 7, 1) : 0,
    isPast: now > end,
  };
}
