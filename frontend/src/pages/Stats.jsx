import { useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import {
  GET_STATS_BY_TYPE,
  GET_ACTIVITY_DATES,
  GET_ACTIVITY_STREAK,
  GET_YEAR_OVER_YEAR_COMPARISON,
  GET_TRAINING_LOAD,
} from "../graphql/queries.js";
import {
  useUnits,
  formatDistance,
  formatElevation,
  distanceValue,
  distanceUnitLabel,
  elevationValue,
  elevationUnitLabel,
} from "../units.jsx";
import { downloadCsv } from "../csv.js";

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function dateKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

// Builds a Sunday-aligned grid of weeks covering Jan 1 - Dec 31 of `year`.
function buildYearWeeks(year) {
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  const start = new Date(jan1);
  start.setDate(start.getDate() - start.getDay());
  const weeks = [];
  let cursor = new Date(start);
  while (cursor <= dec31) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + DAY_MS);
    }
    weeks.push(week);
  }
  return weeks;
}

function levelFor(count) {
  if (!count) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

function ActivityHeatmap({ activities }) {
  const years = useMemo(() => {
    const set = new Set(activities.map((a) => new Date(a.startTime).getFullYear()));
    return [...set].sort((a, b) => b - a);
  }, [activities]);

  const types = useMemo(() => {
    const set = new Set(activities.map((a) => a.activityType));
    return [...set].sort();
  }, [activities]);

  const [year, setYear] = useState(years[0]);
  const [activityType, setActivityType] = useState("All");

  const countsByDay = useMemo(() => {
    const counts = new Map();
    for (const a of activities) {
      if (activityType !== "All" && a.activityType !== activityType) continue;
      const key = dateKey(new Date(a.startTime));
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [activities, activityType]);

  const weeks = useMemo(() => buildYearWeeks(year), [year]);

  if (years.length === 0) return null;

  // Figure out which week column each month starts in, for header labels.
  const monthLabelByWeek = new Map();
  let lastMonth = -1;
  weeks.forEach((week, weekIndex) => {
    const firstOfMonthDay = week.find(
      (d) => d.getFullYear() === year && d.getMonth() !== lastMonth,
    );
    if (firstOfMonthDay) {
      monthLabelByWeek.set(weekIndex, MONTH_LABELS[firstOfMonthDay.getMonth()]);
      lastMonth = firstOfMonthDay.getMonth();
    }
  });

  return (
    <div className="heatmap-card">
      <div className="heatmap-header-row">
        <h2>Activity Heatmap</h2>
        <div className="heatmap-selectors">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <select value={activityType} onChange={(e) => setActivityType(e.target.value)}>
            <option value="All">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="calendar-heatmap-wrap">
        <div className="calendar-heatmap">
          <div className="calendar-heatmap-months">
            {weeks.map((_, weekIndex) => (
              <span key={weekIndex} className="calendar-heatmap-month-label">
                {monthLabelByWeek.get(weekIndex) || ""}
              </span>
            ))}
          </div>
          <div className="calendar-heatmap-grid">
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="calendar-heatmap-week">
                {week.map((day, dayIndex) => {
                  if (day.getFullYear() !== year) {
                    return (
                      <div
                        key={dayIndex}
                        className="calendar-heatmap-cell calendar-heatmap-cell-empty"
                      />
                    );
                  }
                  const count = countsByDay.get(dateKey(day)) || 0;
                  const level = levelFor(count);
                  return (
                    <div
                      key={dayIndex}
                      className={`calendar-heatmap-cell calendar-heatmap-level-${level}`}
                      title={`${day.toLocaleDateString()}: ${count} activit${count === 1 ? "y" : "ies"}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="calendar-heatmap-legend">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} className={`calendar-heatmap-cell calendar-heatmap-level-${level}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function formatDelta(current, previous) {
  if (previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "+" : "";
  return {
    text: `${sign}${pct.toFixed(0)}%`,
    positive: pct >= 0,
  };
}

function YearOverYearComparison({ comparison, unit }) {
  const { currentYear, previousYear } = comparison;

  const tiles = [
    {
      label: "Activities",
      current: currentYear.activityCount.toLocaleString(),
      delta: formatDelta(currentYear.activityCount, previousYear.activityCount),
    },
    {
      label: "Distance",
      current: formatDistance(currentYear.totalDistanceMeters, unit),
      delta: formatDelta(currentYear.totalDistanceMeters, previousYear.totalDistanceMeters),
    },
    {
      label: "Elevation Gain",
      current: formatElevation(currentYear.totalElevationGainMeters, unit),
      delta: formatDelta(
        currentYear.totalElevationGainMeters,
        previousYear.totalElevationGainMeters,
      ),
    },
  ];

  return (
    <section>
      <h2>
        {currentYear.year} vs {previousYear.year} (Jan 1&ndash;today)
      </h2>
      <div className="summary-grid">
        {tiles.map((tile) => (
          <div className="summary-tile" key={tile.label}>
            <span className="summary-value">{tile.current}</span>
            <span className="summary-label">{tile.label}</span>
            {tile.delta && (
              <span
                className={`summary-delta ${
                  tile.delta.positive ? "summary-delta-positive" : "summary-delta-negative"
                }`}
              >
                {tile.delta.text} vs {previousYear.year}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Stats() {
  const { unit } = useUnits();
  const { data, loading, error } = useQuery(GET_STATS_BY_TYPE);
  const {
    data: datesData,
    loading: datesLoading,
    error: datesError,
  } = useQuery(GET_ACTIVITY_DATES);
  const {
    data: streakData,
    loading: streakLoading,
    error: streakError,
  } = useQuery(GET_ACTIVITY_STREAK);
  const {
    data: yoyData,
    loading: yoyLoading,
    error: yoyError,
  } = useQuery(GET_YEAR_OVER_YEAR_COMPARISON);
  const { data: loadData, loading: loadLoading, error: loadError } = useQuery(GET_TRAINING_LOAD);

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error loading stats: {error.message}</p>;

  const stats = data.aggregatedStatsByType;

  const exportCsv = () => {
    downloadCsv("stats-by-type.csv", stats, [
      { header: "Type", accessor: (r) => r.activityType },
      { header: "Count", accessor: (r) => r.count },
      {
        header: `Total Distance (${distanceUnitLabel(unit)})`,
        accessor: (r) => distanceValue(r.totalDistanceMeters, unit).toFixed(2),
      },
      { header: "Total Duration", accessor: (r) => formatDuration(r.totalDurationSeconds) },
      {
        header: `Avg Distance (${distanceUnitLabel(unit)})`,
        accessor: (r) => distanceValue(r.averageDistanceMeters, unit).toFixed(2),
      },
      { header: "Avg Duration", accessor: (r) => formatDuration(r.averageDurationSeconds) },
      {
        header: `Avg Elevation Gain (${elevationUnitLabel(unit)})`,
        accessor: (r) =>
          r.averageElevationGainMeters == null
            ? ""
            : Math.round(elevationValue(r.averageElevationGainMeters, unit)),
      },
    ]);
  };

  return (
    <div>
      <h1>Stats</h1>

      {!streakLoading && !streakError && (
        <section className="summary-grid">
          <div className="summary-tile">
            <span className="summary-value">
              {streakData.activityStreak.currentStreakDays.toLocaleString()}
            </span>
            <span className="summary-label">Current Streak (days)</span>
          </div>
          <div className="summary-tile">
            <span className="summary-value">
              {streakData.activityStreak.longestStreakDays.toLocaleString()}
            </span>
            <span className="summary-label">Longest Streak (days)</span>
          </div>
        </section>
      )}

      {!loadLoading && !loadError && (
        <section className="summary-grid">
          <div className="summary-tile">
            <span className="summary-value">
              {formatDistance(loadData.trainingLoad.acuteDistanceMeters, unit)}
            </span>
            <span className="summary-label">Acute Load (7-day)</span>
          </div>
          <div className="summary-tile">
            <span className="summary-value">
              {formatDistance(loadData.trainingLoad.chronicWeeklyAvgDistanceMeters, unit)}
            </span>
            <span className="summary-label">Chronic Load (28-day weekly avg)</span>
          </div>
          <div className="summary-tile">
            <span className="summary-value">
              {loadData.trainingLoad.ratio == null ? "–" : loadData.trainingLoad.ratio.toFixed(2)}
            </span>
            <span className="summary-label">
              Training Load Ratio ({loadData.trainingLoad.label})
            </span>
          </div>
        </section>
      )}

      {!yoyLoading && !yoyError && (
        <YearOverYearComparison comparison={yoyData.yearOverYearComparison} unit={unit} />
      )}

      {!datesLoading && !datesError && datesData.activities.length > 0 && (
        <ActivityHeatmap activities={datesData.activities} />
      )}

      <h2>By Activity Type</h2>
      {stats.length === 0 ? (
        <p>No activities yet.</p>
      ) : (
        <>
          <div className="button-row">
            <button type="button" onClick={exportCsv}>
              Download CSV
            </button>
          </div>
          <div className="stats-table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Count</th>
                  <th>Total Distance</th>
                  <th>Total Duration</th>
                  <th>Avg Distance</th>
                  <th>Avg Duration</th>
                  <th>Avg Elevation Gain</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((row) => (
                  <tr key={row.activityType}>
                    <td>{row.activityType}</td>
                    <td>{row.count}</td>
                    <td>{formatDistance(row.totalDistanceMeters, unit)}</td>
                    <td>{formatDuration(row.totalDurationSeconds)}</td>
                    <td>{formatDistance(row.averageDistanceMeters, unit)}</td>
                    <td>{formatDuration(row.averageDurationSeconds)}</td>
                    <td>{formatElevation(row.averageElevationGainMeters, unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
