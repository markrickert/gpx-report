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
 * How many weekly targets a trip's plan has: weeks run 7 days from the start
 * date, and the last one also takes the days left over before the end date.
 * Matches tripWeekCount in backend/src/trips/weeks.ts.
 */
export function tripWeekCount(startDate: string, endDate: string) {
  return Math.max(1, Math.floor((dayNumber(endDate) - dayNumber(startDate) + 1) / 7));
}

type Plan = {
  goalMeters: number;
  startDate: string;
  endDate: string;
  weeklyTargetsMeters?: number[] | null;
  goalMaxMeters?: number | null;
  weeklyTargetsMaxMeters?: number[] | null;
};

/** The top of a goal given as a range, as a plan of its own. Null for a single goal. */
export function tripMaxPlan(plan: Plan): Plan | null {
  if (plan.goalMaxMeters == null) return null;
  return {
    goalMeters: plan.goalMaxMeters,
    startDate: plan.startDate,
    endDate: plan.endDate,
    weeklyTargetsMeters: plan.weeklyTargetsMaxMeters,
  };
}

/**
 * The target as days-from-start against cumulative meters, one point per week
 * boundary: a straight line to the goal, or the trip's weekly plan when it has one.
 */
export function tripTargetLine({ goalMeters, startDate, endDate, weeklyTargetsMeters }: Plan) {
  const totalDays = dayNumber(endDate) - dayNumber(startDate) + 1;
  if (!weeklyTargetsMeters?.length) {
    return [
      { day: 0, meters: 0 },
      { day: totalDays, meters: goalMeters },
    ];
  }
  let meters = 0;
  return [
    { day: 0, meters: 0 },
    ...weeklyTargetsMeters.map((target, i) => {
      meters += target;
      return { day: i === weeklyTargetsMeters.length - 1 ? totalDays : 7 * (i + 1), meters };
    }),
  ];
}

/**
 * Where someone stands against the target line (see tripTargetLine): 0 on the
 * day before startDate, the goal at the end of endDate. Both dates are
 * inclusive, and today counts as a day still left to train on. With a range,
 * the plain figures are against its bottom and the Max ones against its top.
 */
export function tripPace({
  totalMeters,
  today = localDate(),
  ...plan
}: Plan & {
  totalMeters: number;
  today?: string;
}) {
  const { goalMeters, startDate, endDate, weeklyTargetsMeters = null } = plan;
  const maxPlan = tripMaxPlan(plan);
  const max = maxPlan && tripPace({ ...maxPlan, totalMeters, today });
  const start = dayNumber(startDate);
  const end = dayNumber(endDate);
  const now = dayNumber(today);
  const totalDays = end - start + 1;
  const elapsedDays = Math.min(Math.max(now - start + 1, 0), totalDays);
  const daysRemaining = Math.min(Math.max(end - now + 1, 0), totalDays);
  const remainingMeters = Math.max(goalMeters - totalMeters, 0);

  // Walk the target line to today.
  const line = tripTargetLine({ goalMeters, startDate, endDate, weeklyTargetsMeters });
  let expectedMeters = 0;
  let throughThisWeekMeters = goalMeters;
  for (let i = 1; i < line.length; i++) {
    const [from, to] = [line[i - 1], line[i]];
    const done = Math.min(Math.max(elapsedDays - from.day, 0), to.day - from.day);
    expectedMeters += ((to.meters - from.meters) * done) / (to.day - from.day);
    if (elapsedDays > from.day || i === 1) throughThisWeekMeters = to.meters;
  }

  const expectedMaxMeters = max?.expectedMeters ?? expectedMeters;

  return {
    expectedMeters,
    // Zero anywhere inside a range: negative under its bottom, positive over its top.
    aheadMeters: totalMeters - Math.min(Math.max(totalMeters, expectedMeters), expectedMaxMeters),
    inRange: max != null && totalMeters >= expectedMeters && totalMeters <= expectedMaxMeters,
    daysRemaining,
    // With under a week left, "per week" is just what's left.
    neededPerWeekMeters: daysRemaining ? remainingMeters / Math.max(daysRemaining / 7, 1) : 0,
    neededPerWeekMaxMeters: max?.neededPerWeekMeters ?? null,
    // With a weekly plan: what's left to reach the plan's total through the
    // end of the current week. Null without one.
    neededThisWeekMeters: !weeklyTargetsMeters?.length
      ? null
      : daysRemaining
        ? Math.max(throughThisWeekMeters - totalMeters, 0)
        : 0,
    neededThisWeekMaxMeters: max?.neededThisWeekMeters ?? null,
    isPast: now > end,
  };
}
