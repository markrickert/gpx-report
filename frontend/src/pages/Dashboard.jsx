import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@apollo/client";
import { Link } from "react-router-dom";
import {
  GET_DASHBOARD,
  GET_ON_THIS_DAY,
  UPDATE_ACTIVITY_TYPE,
  DELETE_ACTIVITY,
} from "../graphql/queries.js";
import {
  useUnits,
  formatDistance,
  formatElevation,
  formatSpeed,
  distanceValue,
  distanceUnitLabel,
  elevationValue,
  elevationUnitLabel,
} from "../units.jsx";
import { ACTIVITY_TYPES } from "../activityTypes.js";
import { activityTypeLabel } from "../activityTypeIcons.js";
import { downloadCsv } from "../csv.js";

const PAGE_SIZE = 50;

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const THUMBNAIL_SIZE = 48;
const THUMBNAIL_PADDING = 4;

// routeThumbnail arrives already sampled down to a handful of [lat, lon]
// pairs by the activities query (see backend/src/graphql/resolvers.js) —
// no further downsampling needed here.
function routeThumbnailPoints(routeThumbnail) {
  if (!routeThumbnail || routeThumbnail.length < 2) return null;

  const lats = routeThumbnail.map((p) => p[0]);
  const lons = routeThumbnail.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latRange = maxLat - minLat || 1e-9;
  const lonRange = maxLon - minLon || 1e-9;

  const drawable = THUMBNAIL_SIZE - THUMBNAIL_PADDING * 2;
  const scale = drawable / Math.max(latRange, lonRange);
  const offsetX = THUMBNAIL_PADDING + (drawable - lonRange * scale) / 2;
  const offsetY = THUMBNAIL_PADDING + (drawable - latRange * scale) / 2;

  return routeThumbnail
    .map(([lat, lon]) => {
      const x = offsetX + (lon - minLon) * scale;
      const y = offsetY + (maxLat - lat) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function RouteThumbnail({ routeThumbnail }) {
  const points = routeThumbnailPoints(routeThumbnail);
  if (!points)
    return <div className="activity-thumbnail activity-thumbnail-empty" aria-hidden="true" />;

  return (
    <svg
      className="activity-thumbnail"
      viewBox={`0 0 ${THUMBNAIL_SIZE} ${THUMBNAIL_SIZE}`}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function OnThisDayCard() {
  const { unit } = useUnits();
  const { data } = useQuery(GET_ON_THIS_DAY);
  const activities = data?.onThisDay;
  if (!activities || activities.length === 0) return null;

  return (
    <section className="on-this-day">
      <h2>On This Day</h2>
      <ul className="on-this-day-list">
        {activities.map((activity) => {
          const yearsAgo = new Date().getFullYear() - new Date(activity.startTime).getFullYear();
          return (
            <li key={activity.id}>
              <Link to={`/activities/${activity.id}`}>
                {activity.title} — {yearsAgo} {yearsAgo === 1 ? "year" : "years"} ago (
                {activityTypeLabel(activity.activityType)},{" "}
                {formatDistance(activity.distanceMeters, unit)})
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function Dashboard() {
  const { unit } = useUnits();
  const [activityType, setActivityType] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const {
    data: freshData,
    previousData,
    loading,
    error,
    fetchMore,
    refetch,
  } = useQuery(GET_DASHBOARD, {
    variables: {
      activityType: activityType || undefined,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset: 0,
    },
  });
  const data = freshData ?? previousData;

  const [activities, setActivities] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef(null);
  const [visibleDelays, setVisibleDelays] = useState(() => new Map());
  const entranceObserverRef = useRef(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkType, setBulkType] = useState(ACTIVITY_TYPES[0]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState(null);
  const [updateActivityType] = useMutation(UPDATE_ACTIVITY_TYPE);
  const [deleteActivity] = useMutation(DELETE_ACTIVITY);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkError(null);
  };

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkRetype = async () => {
    setBulkError(null);
    setBulkBusy(true);
    try {
      await Promise.all(
        [...selectedIds].map((id) =>
          updateActivityType({ variables: { id, activityType: bulkType } }),
        ),
      );
      await refetch();
      exitSelectMode();
    } catch (e) {
      setBulkError(e.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (
      !window.confirm(
        `Delete ${selectedIds.size} selected ${selectedIds.size === 1 ? "activity" : "activities"} permanently? This removes each activity and its source file and cannot be undone.`,
      )
    ) {
      return;
    }
    setBulkError(null);
    setBulkBusy(true);
    try {
      await Promise.all([...selectedIds].map((id) => deleteActivity({ variables: { id } })));
      await refetch();
      exitSelectMode();
    } catch (e) {
      setBulkError(e.message);
    } finally {
      setBulkBusy(false);
    }
  };

  useEffect(() => {
    entranceObserverRef.current = new IntersectionObserver(
      (entries) => {
        const newlyVisible = entries.filter((entry) => entry.isIntersecting);
        if (newlyVisible.length === 0) return;
        setVisibleDelays((prev) => {
          const next = new Map(prev);
          let staggerIndex = 0;
          newlyVisible.forEach((entry) => {
            const id = entry.target.dataset.activityId;
            if (!next.has(id)) {
              next.set(id, Math.min(staggerIndex, 8) * 60);
              staggerIndex += 1;
            }
            entranceObserverRef.current.unobserve(entry.target);
          });
          return next;
        });
      },
      { rootMargin: "0px 0px -40px 0px", threshold: 0.1 },
    );
    return () => entranceObserverRef.current.disconnect();
  }, []);

  const observeListItem = (node) => {
    if (node) entranceObserverRef.current?.observe(node);
  };

  useEffect(() => {
    if (data?.activities) {
      setActivities(data.activities);
      setHasMore(data.activities.length === PAGE_SIZE);
    }
  }, [data]);

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      async (entries) => {
        if (!entries[0].isIntersecting || loadingMoreRef.current || !hasMore) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
        try {
          const res = await fetchMore({
            variables: {
              activityType: activityType || undefined,
              search: search || undefined,
              limit: PAGE_SIZE,
              offset: activities.length,
            },
          });
          const newItems = res.data.activities;
          setActivities((prev) => [...prev, ...newItems]);
          setHasMore(newItems.length === PAGE_SIZE);
        } finally {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, activities.length, activityType, search, fetchMore]);

  if (loading && !data) return <p>Loading...</p>;
  if (error) return <p>Error loading dashboard: {error.message}</p>;

  const { activitySummary } = data;

  const exportCsv = () => {
    downloadCsv(`activities-${new Date().toISOString().slice(0, 10)}.csv`, activities, [
      { header: "Title", accessor: (a) => a.title },
      { header: "Type", accessor: (a) => a.activityType },
      { header: "Date", accessor: (a) => new Date(a.startTime).toLocaleString() },
      {
        header: `Distance (${distanceUnitLabel(unit)})`,
        accessor: (a) => distanceValue(a.distanceMeters, unit).toFixed(2),
      },
      { header: "Duration", accessor: (a) => formatDuration(a.durationSeconds) },
      {
        header: `Elevation Gain (${elevationUnitLabel(unit)})`,
        accessor: (a) =>
          a.totalElevationGain == null
            ? ""
            : Math.round(elevationValue(a.totalElevationGain, unit)),
      },
      { header: "Avg Speed", accessor: (a) => formatSpeed(a.avgSpeedMps, unit) },
    ]);
  };

  return (
    <div>
      <section className="summary-grid">
        <div className="summary-tile">
          <span className="summary-value">{activitySummary.totalActivities.toLocaleString()}</span>
          <span className="summary-label">Activities</span>
        </div>
        <div className="summary-tile">
          <span className="summary-value">
            {formatDistance(activitySummary.totalDistanceMeters, unit)}
          </span>
          <span className="summary-label">Total Distance</span>
        </div>
        <div className="summary-tile">
          <span className="summary-value">
            {formatDuration(activitySummary.totalDurationSeconds)}
          </span>
          <span className="summary-label">Total Duration</span>
        </div>
        <div className="summary-tile">
          <span className="summary-value">
            {formatElevation(activitySummary.totalElevationGainMeters ?? 0, unit)}
          </span>
          <span className="summary-label">Elevation Gain</span>
        </div>
      </section>

      <OnThisDayCard />

      <div className="filter-row">
        <label htmlFor="activityType">Filter by type: </label>
        <select
          id="activityType"
          value={activityType}
          onChange={(e) => setActivityType(e.target.value)}
        >
          <option value="">All</option>
          {ACTIVITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <label htmlFor="titleSearch">Search: </label>
        <input
          id="titleSearch"
          type="text"
          placeholder="Search by title..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        {loading && data && <span className="filter-loading">Searching…</span>}
      </div>

      <div className="button-row">
        <button type="button" onClick={exportCsv} disabled={activities.length === 0}>
          Download CSV
        </button>
        <button
          type="button"
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          disabled={activities.length === 0}
        >
          {selectMode ? "Cancel Selection" : "Select"}
        </button>
      </div>

      {selectMode && selectedIds.size > 0 && (
        <div className="bulk-action-bar">
          <span>{selectedIds.size} selected</span>
          <select value={bulkType} onChange={(e) => setBulkType(e.target.value)}>
            {ACTIVITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleBulkRetype} disabled={bulkBusy}>
            Retype Selected
          </button>
          <button
            type="button"
            className="bulk-delete-button"
            onClick={handleBulkDelete}
            disabled={bulkBusy}
          >
            Delete Selected
          </button>
          {bulkError && <span className="bulk-action-error">{bulkError}</span>}
        </div>
      )}

      <ul className="activity-list">
        {activities.map((activity) => (
          <li
            key={activity.id}
            ref={observeListItem}
            data-activity-id={activity.id}
            className={[
              visibleDelays.has(String(activity.id)) ? "visible" : "",
              activity.activityType === "Unknown" ? "activity-unknown" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ transitionDelay: `${visibleDelays.get(String(activity.id)) ?? 0}ms` }}
          >
            <div className="activity-list-row">
              {selectMode && (
                <input
                  type="checkbox"
                  className="activity-list-checkbox"
                  aria-label={`Select ${activity.title}`}
                  checked={selectedIds.has(activity.id)}
                  onChange={() => toggleSelected(activity.id)}
                />
              )}
              <Link to={`/activities/${activity.id}`} className="activity-list-link">
                <RouteThumbnail routeThumbnail={activity.routeThumbnail} />
                <div>
                  <div className="activity-list-title">{activity.title}</div>
                  <div className="activity-list-meta">
                    {activity.activityType === "Unknown" && (
                      <span className="activity-unknown-badge">Needs review</span>
                    )}
                    {activityTypeLabel(activity.activityType)} —{" "}
                    {new Date(activity.startTime).toLocaleString()} —{" "}
                    {formatDistance(activity.distanceMeters, unit)} —{" "}
                    {formatDuration(activity.durationSeconds)}
                    {activity.locationName && (
                      <>
                        {" "}
                        — <span className="activity-list-location">{activity.locationName}</span>
                      </>
                    )}
                  </div>
                </div>
              </Link>
            </div>
          </li>
        ))}
        {activities.length === 0 && <li>No activities found.</li>}
      </ul>
      {hasMore && <div ref={sentinelRef} className="activity-list-sentinel" />}
      {loadingMore && <p>Loading more...</p>}
    </div>
  );
}
