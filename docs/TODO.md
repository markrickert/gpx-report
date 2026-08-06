# TODO

Tracks work that is planned/wanted but not yet implemented, plus gaps found when auditing the other `docs/*.md` files against the actual code. Keep this updated: per the rule in `CLAUDE.md`, any time the user asks for something to be built/changed, add it here first (even if it's about to be implemented in the same session) and check it off (with a short note, not a deletion) once it ships.

## Planned features

- [ ] **`.slpz`/Slopes-export file support.** User exports ski activities from the Slopes app in `.slpz`-family format (no sample file in the repo yet) — need to ingest/log these alongside `.gpx`/`.igc`. Format details, and whether `gpxparser` can handle it or a new parser is needed, still require research before implementation.
- [ ] **Max-width cap on Dashboard/ActivityDetail on very wide browsers.** `.content` already sets `max-width: 1400px` + `margin: 0 auto`, but the main body reportedly still reads too wide/edge-to-edge on an ultra-wide monitor. Needs checking on an actual wide viewport — likely a tighter cap and/or capping inner elements (chart/map) rather than the outer wrapper.
- [ ] **Graceful degradation without JavaScript.** The frontend is a pure client-rendered Vite/React SPA with an empty `<div id="root">` — JS disabled currently means a blank page. Fixing this for real needs SSR/static pre-rendering, a genuine architecture shift, not a small tweak. Scope (which routes, read-only vs. the editing/trim features that need client interactivity anyway) still needs a decision before committing to a framework.

## Done

- [x] **Edit activity title, written back to source GPX file** (2026-08-06) — `updateActivityTitle` mutation rewrites `<trk><name>` via `gpx/writer.js` and re-runs `processFile()`; inline Edit/Save/Cancel on `ActivityDetail.jsx`.
- [x] **Editable activity type, from a preselected list** (2026-08-06) — dropdown (shared `activityTypes.js`) next to the type badge; `updateActivityType` writes `<trk><type>` and re-syncs via `processFile()`.
- [x] **`.igc` file support (paragliding)** (2026-08-06) — new `igc/parser.js` parses IGC B-records into the same shape as GPX parsing; `processor.js`/the watcher dispatch by file extension. Title/type editing stays `.gpx`-only (writer.js is GPX-XML-specific).
- [x] **Trim editing on the elevation profile** (2026-08-06) — drag handles on the elevation chart set a keep-range; `trimActivity` mutation deletes out-of-range `<trkpt>`s via `writer.js` and re-runs `processFile()`. Along the way, fixed a recharts bug where `Reference*` components silently no-op against a duplicate-value category axis.
- [x] **Trim/crop handles fixed on mobile** (2026-08-06) — root cause was a real bug (the handle shape dropped recharts' touch/mouse handlers), not just missing scroll-suppression CSS. Fixed the handler bug and added `touch-action: none` as defense-in-depth.
- [x] **Bigger, grey trim handles** (2026-08-06) — swapped the small blue circles for a taller grey pill, vertically centered on the chart instead of pinned to the top.
- [x] **Rounded elevation Y-axis tick labels** (2026-08-06) — `tickFormatter` rounds ticks to whole numbers instead of raw GPX decimal precision.
- [x] **Tighter Y-axis range on the elevation profile** (2026-08-06) — explicit `domain` (`[min - 10, max + 10]`) instead of the default 0-based range.

- [x] **Dashboard activity list route thumbnail** (2026-08-06) — small client-built SVG polyline per row instead of live tile maps (cheap at 50-rows-per-page scale, no tile-server load).
- [x] **Dashboard infinite scroll** (2026-08-06) — paginated `GET_DASHBOARD` (`$limit`/`$offset`) + `IntersectionObserver` sentinel, resets on filter change.
- [x] **Entrance animation for dashboard list items on scroll** (2026-08-06) — fade/slide-in via a shared `IntersectionObserver`; respects `prefers-reduced-motion`.
- [x] **km/miles unit toggle** (2026-08-06) — `units.jsx` context (localStorage-persisted) + nav toggle button, wired through Dashboard and ActivityDetail (including the elevation chart's axis/domain).

- [x] **`aggregatedStatsByType` query wired up** (2026-08-06) — new `/stats` tab, table of per-activity-type totals/averages.
- [x] **Stats page: activity heatmap-by-time-of-year** (2026-08-06) — hand-rolled GitHub-style calendar heatmap on `/stats` (no new dependency), with year and activity-type filters; confirms seasonal patterns like ski activities clustering in Nov/Dec.
- [x] **Hover-synced position dot on map + elevation profile** (2026-08-06) — shared `hoverIndex` state on `ActivityDetail.jsx`; hovering the chart shows a dot on the map and vice versa, via the same `xAxisId="idx"` indexing the trim handles use.
- [x] **Heatmap tab of all activity locations** (2026-08-06) — new `/heatmap` tab, `leaflet.heat` density map over the theme-aware basemap, plus a "color by elevation" mode (4 quartile-banded heat layers). New sampled `heatmapPoints` query (max 300 points/route) keeps the payload to ~3.8MB instead of tens of MB at full GPS resolution.

- [x] **Nicer-looking activity stats + overall visual design pass + dark mode** (2026-08-06) — CSS custom properties + `:root[data-theme="dark"]` across the app, icon-card metric tiles on `ActivityDetail.jsx`, active-nav-link styling, general polish (hover states, radii, dark-aware chart tooltip).
  - **Manual light/dark toggle** (2026-08-06) — `theme.jsx` context resolves an explicit localStorage override over the live `prefers-color-scheme`, since OS-preference-only didn't let the user force light mode independent of the system setting. Toggle button in the nav; no flash on load via an inline `index.html` script.
  - **Dark map tiles** (2026-08-06) — `ActivityDetail.jsx`'s Leaflet layer switches to CARTO's dark basemap when the theme is dark, OSM otherwise.

- [x] **Browser-based file viewer/editor → code-server** (2026-08-06) — started as a read-only docs viewer with git history, superseded in the same session by a full `code-server` container (bind-mounted read-write, Tailscale-only, `--auth none`).
- [x] **Code-server exposed as a tab in the frontend** (2026-08-06) — `/code` route iframes code-server at the app's current hostname, no new exposure.
- [x] **Code tab switched to https via a Caddy site** (2026-08-06) — dedicated Caddy site + `VITE_CODE_SERVER_URL` build arg fixed mixed-content blocking; also fixed a stray content-width bug affecting Dashboard/Code.

- [x] **Linting/formatting: ESLint + Prettier with pre-commit hooks** (2026-08-06) — separate ESLint 9 flat configs per subproject (React rules for frontend), shared root Prettier config, new root `package.json` hosting husky + lint-staged (`.husky/pre-commit` → `eslint --fix` + `prettier --write` on staged files). Existing source left unformatted/unfixed (11 pre-existing files flagged by Prettier, noted as a separate future cleanup, not bundled in).
- [x] **PWA installability** (2026-08-06) — `vite-plugin-pwa` generates the manifest + service worker; generated icon set (no prior logo existed). Scope deliberately stops at an installable app shell — no offline GraphQL/data caching, that's a materially bigger feature.
- [x] **In-app GPS recording** (2026-08-06) — new `/record` page records via `navigator.geolocation.watchPosition()`, builds a GPX document client-side, and saves it through a new `saveRecordedActivity` mutation (server-generated filename only, no client-supplied path) into the existing file-watcher ingestion pipeline. Foreground-only by design — backgrounding/locking the screen pauses tracking, a real background-capture experience needs a native app.

## Known gaps

- [ ] **No DB migration tooling.** `backend/db/init.sql` only runs against a fresh volume. Any schema change to an already-deployed instance needs a manual `psql`/`ALTER` step. Fine for now (single-user, low change rate) but worth a lightweight migration runner if schema churn picks up.
- [ ] **No automated tests or typecheck config anywhere in the repo.** ESLint/Prettier now exist (see Done above); tests and typechecking are still unaddressed.
- [ ] **No auth on the API or frontend.** Acceptable for now since the intended deployment is Caddy + Tailscale (see `docs/SETUP.md` §6 reverse-proxy notes), but if the API/frontend domains are ever exposed outside Tailscale, this becomes a real gap, not just a v1 simplification.

## Explicitly out of scope for v1 (not gaps, just noting so they don't get re-litigated)

- No in-app GPX upload/file management — files are expected to arrive via Syncthing or manual drop into `data/gpx/`.
- No multi-user support.
