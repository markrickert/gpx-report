# TODO

Tracks work that is planned/wanted but not yet implemented, plus gaps found when auditing the other `docs/*.md` files against the actual code (2026-08-06). Keep this updated: per the rule in `CLAUDE.md`, any time the user asks for something to be built/changed, add it here first (even if it's about to be implemented in the same session) and check it off (with a short note, not a deletion) once it ships.

## Done

- [x] **Browser-based file viewer/editor** (2026-08-06) — asked for a simple read-only docs viewer with git history first; built it (`/docs` page + `repoTree`/`repoFile`/`fileHistory`/`fileDiff` GraphQL resolvers), then superseded it in the same session with a `code-server` service (`docker-compose.yml`) once write access became the actual goal — full VS Code in the browser, bind-mounted read-write at the repo root, port 8443, `--auth none` (Tailscale-only, no public exposure). The custom viewer code was removed rather than kept alongside it. See `docs/SETUP.md` §7.

## Known gaps

- [ ] **Dashboard activity list has no visual per-activity indicator.** Each list item (`frontend/src/pages/Dashboard.jsx`) is text-only (type, date, distance, duration). Wanted: a small representative map thumbnail or activity-type icon per row, so the list is scannable at a glance instead of by reading text.
- [ ] **No pagination / "load more" on the Dashboard activity list.** `activities(limit, offset)` supports paging, but `frontend/src/pages/Dashboard.jsx` calls it with a hardcoded `limit: 50` and never passes `offset`. Activities beyond the 50 most recent (optionally filtered by type) are currently invisible in the UI with no way to reach them.
- [ ] **`aggregatedStatsByType` query is unused.** It's fully implemented in the resolvers/schema but no frontend page calls it — there's no per-activity-type breakdown view (e.g. "total running distance this year").
- [ ] **No DB migration tooling.** `backend/db/init.sql` only runs against a fresh volume. Any schema change to an already-deployed instance needs a manual `psql`/`ALTER` step. Fine for now (single-user, low change rate) but worth a lightweight migration runner if schema churn picks up.
- [ ] **No automated tests, lint, or typecheck config anywhere in the repo.** Noted as current state in `CLAUDE.md`; flagging here as something to eventually add rather than silently keep deferring.
- [ ] **No auth on the API or frontend.** Acceptable for now since the intended deployment is Caddy + Tailscale (see `docs/SETUP.md` §6 reverse-proxy notes), but if the API/frontend domains are ever exposed outside Tailscale, this becomes a real gap, not just a v1 simplification.

## Explicitly out of scope for v1 (not gaps, just noting so they don't get re-litigated)

- No in-app GPX upload/file management — files are expected to arrive via Syncthing or manual drop into `data/gpx/`.
- No multi-user support.
