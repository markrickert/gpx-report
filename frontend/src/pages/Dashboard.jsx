import { useEffect, useRef, useState } from "react";
import { useQuery } from "@apollo/client";
import { Link } from "react-router-dom";
import { GET_DASHBOARD } from "../graphql/queries.js";
import { useUnits, formatDistance, formatElevation } from "../units.jsx";
import { ACTIVITY_TYPES } from "../activityTypes.js";

const PAGE_SIZE = 50;

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const THUMBNAIL_SIZE = 48;
const THUMBNAIL_PADDING = 4;
const THUMBNAIL_MAX_POINTS = 60;

function routeThumbnailPoints(coordinates) {
  if (!coordinates || coordinates.length < 2) return null;

  const step = Math.max(1, Math.floor(coordinates.length / THUMBNAIL_MAX_POINTS));
  const sampled = coordinates.filter((_, i) => i % step === 0);

  const lats = sampled.map((p) => p.lat);
  const lons = sampled.map((p) => p.lon);
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

  return sampled
    .map((p) => {
      const x = offsetX + (p.lon - minLon) * scale;
      const y = offsetY + (maxLat - p.lat) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function RouteThumbnail({ coordinates }) {
  const points = routeThumbnailPoints(coordinates);
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

export default function Dashboard() {
  const { unit } = useUnits();
  const [activityType, setActivityType] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const { data, loading, error, fetchMore } = useQuery(GET_DASHBOARD, {
    variables: {
      activityType: activityType || undefined,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset: 0,
    },
  });

  const [activities, setActivities] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef(null);
  const [visibleDelays, setVisibleDelays] = useState(() => new Map());
  const entranceObserverRef = useRef(null);

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

      <ul className="activity-list">
        {activities.map((activity) => (
          <li
            key={activity.id}
            ref={observeListItem}
            data-activity-id={activity.id}
            className={visibleDelays.has(String(activity.id)) ? "visible" : ""}
            style={{ transitionDelay: `${visibleDelays.get(String(activity.id)) ?? 0}ms` }}
          >
            <Link to={`/activities/${activity.id}`} className="activity-list-link">
              <RouteThumbnail coordinates={activity.route.coordinates} />
              <div>
                <div className="activity-list-title">{activity.title}</div>
                <div className="activity-list-meta">
                  {activity.activityType} — {new Date(activity.startTime).toLocaleString()} —{" "}
                  {formatDistance(activity.distanceMeters, unit)} —{" "}
                  {formatDuration(activity.durationSeconds)}
                </div>
              </div>
            </Link>
          </li>
        ))}
        {activities.length === 0 && <li>No activities found.</li>}
      </ul>
      {hasMore && <div ref={sentinelRef} className="activity-list-sentinel" />}
      {loadingMore && <p>Loading more...</p>}
    </div>
  );
}
