# TODO

Tracks work that is planned/wanted but not yet implemented, plus gaps found when auditing the other `docs/*.md` files against the actual code. Keep this updated: per the rule in `CLAUDE.md`, any time the user asks for something to be built/changed, add it here first (even if it's about to be implemented in the same session) and check it off (with a short note, not a deletion) once it ships.

## Planned features

- [ ] **Graceful degradation without JavaScript.** The frontend is a pure client-rendered Vite/React SPA with an empty `<div id="root">` — JS disabled currently means a blank page. Fixing this for real needs SSR/static pre-rendering, a genuine architecture shift, not a small tweak. Scope (which routes, read-only vs. the editing/trim features that need client interactivity anyway) still needs a decision before committing to a framework.

## Done

- [x] **Unit tests for GPX/IGC/`.skiz` parsers, Vitest added as test runner** (2026-08-06) — `backend/src/{gpx,igc,skiz}/parser.test.js`, 23 tests covering happy-path metric computation, title/activity-type resolution and fallbacks, malformed-input handling, and the "too few points" error paths. `npm test` (backend) runs `vitest run`. Backend-only for now — no parser/pure-function code on the frontend to prioritize next.
- [x] **Dark-mode map background flashes white before tiles load** (2026-08-06) — `.activity-map`/`.heatmap-map` get `var(--bg-elevated)` background under `:root[data-theme="dark"]`, so no white flash before CARTO's dark tiles finish loading.
- [x] **Thousands separators on Dashboard summary stats** (2026-08-06) — `formatDistance`/`formatElevation` in `units.jsx` and `totalActivities` in Dashboard.jsx now use `toLocaleString()` for grouping.
- [x] **`.skiz` file support (Ski Tracks app exports)** (2026-08-06) — new `skiz/parser.js` unzips the export via `adm-zip` and parses its headerless `Nodes.csv`, with title/activity type regex-extracted from `Track.xml`; reuses `igc/parser.js`'s `haversineMeters` for distance/speed/elevation stats. `processor.js`/watcher dispatch by extension. First implementation guessed the wrong format entirely (researched a similarly-named but unrelated "Slopes" app export before any real sample was available); corrected once 91 real `.skiz` files turned up — recovered from the Syncthing container's writable layer, where they'd been stranded at `/GpxSync` (a stale pre-bind-mount sync path, not a volume) since before `data/gpx` was bind-mounted — and copied into `data/gpx`, all 91 parsing and ingesting cleanly.
- [x] **Title/type/trim editing for `.skiz` activities** (2026-08-06) — new `skiz/writer.js` mirrors `gpx/writer.js`: rewrites `Track.xml`'s `name`/`activity` attributes and drops out-of-range `Nodes.csv` lines for trim, re-zipping via `adm-zip`. Resolvers/`ActivityDetail.jsx`'s `isEditable()` now allow `.gpx` and `.skiz` (still not `.igc`). Verified live against a real deployed activity — mutation round-tripped through the actual `.skiz` file, hash changed, title read back correctly.
- [x] **Tighter max-width cap on Dashboard/ActivityDetail** (2026-08-06) — `.content` wrapper cut from 1400px to 1100px; fixes both the activity list's edge-to-edge feel and the flat, stretched look of the map/elevation chart on ultra-wide monitors.
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
- [x] **Code tab follows the dashboard's dark/light toggle** (2026-08-06) — new `setCodeServerTheme` mutation writes `workbench.colorTheme` into code-server's `settings.json` (shared `code_server_data` volume, now also mounted into `backend`); `CodeEditor.jsx` calls it on theme change and reloads the iframe. Also fixed a pre-existing bug where `code_server_data` was mounted at `/home/coder/.local` while the container actually runs as root (`$HOME=/root`), so editor settings were silently not persisting across recreates — moved the mount to `/root/.local`.
- [x] **Map zoom buttons respect dark mode** (2026-08-06) — Leaflet's default `.leaflet-control-zoom` buttons stayed white-on-black in dark mode; added `:root[data-theme="dark"]` overrides in `styles.css` using the existing `--bg-elevated`/`--text`/`--border` vars.

- [x] **Linting/formatting: ESLint + Prettier with pre-commit hooks** (2026-08-06) — separate ESLint 9 flat configs per subproject (React rules for frontend), shared root Prettier config, new root `package.json` hosting husky + lint-staged (`.husky/pre-commit` → `eslint --fix` + `prettier --write` on staged files). Existing source left unformatted/unfixed (11 pre-existing files flagged by Prettier, noted as a separate future cleanup, not bundled in).
- [x] **PWA installability** (2026-08-06) — `vite-plugin-pwa` generates the manifest + service worker; generated icon set (no prior logo existed). Scope deliberately stops at an installable app shell — no offline GraphQL/data caching, that's a materially bigger feature.
- [x] **In-app GPS recording** (2026-08-06) — new `/record` page records via `navigator.geolocation.watchPosition()`, builds a GPX document client-side, and saves it through a new `saveRecordedActivity` mutation (server-generated filename only, no client-supplied path) into the existing file-watcher ingestion pipeline. Foreground-only by design — backgrounding/locking the screen pauses tracking, a real background-capture experience needs a native app.
- [x] **Code editor white flash in dark mode fixed** (2026-08-06) — `.code-editor-frame` iframe had no background, so its blank default-white document showed through until code-server's own dark theme painted in; now `background: var(--bg-elevated)`, same pattern as the earlier map-tile flash fix.

## Known gaps

- [ ] **No DB migration tooling.** `backend/db/init.sql` only runs against a fresh volume. Any schema change to an already-deployed instance needs a manual `psql`/`ALTER` step. Fine for now (single-user, low change rate) but worth a lightweight migration runner if schema churn picks up.
- [ ] **No typecheck config anywhere in the repo.** ESLint/Prettier and backend parser unit tests now exist (see Done above); typechecking is still unaddressed, and frontend/GraphQL-layer test coverage remains thin.
- [ ] **No auth on the API or frontend.** Acceptable for now since the intended deployment is Caddy + Tailscale (see `docs/SETUP.md` §6 reverse-proxy notes), but if the API/frontend domains are ever exposed outside Tailscale, this becomes a real gap, not just a v1 simplification.

## Explicitly out of scope for v1 (not gaps, just noting so they don't get re-litigated)

- No in-app GPX upload/file management — files are expected to arrive via Syncthing or manual drop into `data/gpx/`.
- No multi-user support.
