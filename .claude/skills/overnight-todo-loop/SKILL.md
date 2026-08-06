---
name: overnight-todo-loop
description: Autonomous, unattended sweep through docs/TODO.md's Planned features, one background agent at a time, paced to survive long unattended windows without hitting usage limits. Use when the user asks for an overnight/autonomous run through open TODOs (e.g. "/goal get through the todos by morning", "work through the backlog while I'm away").
---

Codifies the pattern used on 2026-08-06 to clear gpx-report's TODO backlog overnight with no user intervention. Read this fully before starting — it's the ruleset, not a suggestion.

## 1. Build the work list

Read `docs/TODO.md`'s `## Planned features` section top to bottom. For each item, decide **do** or **skip** before touching anything:

**Skip only for a real concern**, and say so in one sentence to the user before moving on:
- Missing spec/sample data you cannot verify against (e.g. an undocumented file format with no example file in the repo).
- Requires an architecture-level decision only the user can make (e.g. "should we adopt SSR" — a scope pivot, not an implementation detail).
- A genuine correctness/safety question you can't resolve by reading the code (e.g. "this touches auth and I can't tell if it's exploitable").

**Do not skip** for ordinary ambiguity ("exact approach still to be worked out" in the ticket) — that's normal scope for an agent to resolve with a documented judgment call, not a reason to punt. Make the call, note it in the commit/TODO entry, move on.

Order the remaining items simplest/lowest-risk first — it builds a track record of clean commits before tackling anything gnarly, and a stuck item late in the night doesn't block everything behind it. Explicit dependencies between items (e.g. "GPS recording depends on PWA installability landing first") override simple/risk ordering — respect them.

## 2. One agent at a time, fully briefed

Launch exactly one background `Agent` (`subagent_type: general-purpose`, default direct-repo isolation — no worktree needed for a single-writer sequential loop) per TODO item. Never launch the next until the current one has landed a commit (or reported a genuine concern).

Each brief must be self-contained — the agent has no memory of this conversation:
- Point it at `CLAUDE.md` first, for deployment mechanics and behavioral rules.
- Name the exact files/patterns to reuse (don't make it rediscover conventions this codebase already settled — CSS variable theming, the `xAxisId="idx"` chart pattern, the file-based ingestion pipeline, etc.).
- State the verification method explicitly (rebuild the right `docker compose` service, drive it with Playwright + system chromium since no `chromium-cli` is installed here, screenshot, check both light/dark theme and mobile viewport where relevant).
- Require it to update `docs/TODO.md` (move item to Done, present-tense description) and sweep other `docs/*.md` if now stale, then commit — one commit per item, not batched.
- Give it an explicit stop clause: genuine safety/correctness doubt → stop and report, don't commit. Otherwise finish fully autonomously, no questions back to the user.
- Anything with a new server-side write surface (new mutation writing files, new disk paths) needs an explicit line about not trusting client-supplied paths/filenames.

## 3. Pacing and usage-limit awareness

- After launching an agent, call `ScheduleWakeup` with a **1800s fallback** and a reason naming what you're waiting on. This is a heartbeat, not a poll loop — the harness notifies you automatically when the agent finishes; the wakeup only covers a missed/delayed notification.
- When a wakeup fires and the prior agent hasn't completed: check `git log`/`git status` first. If there's no new commit, check whether the agent's transcript file is still growing (`stat` its `.jsonl` under `~/.claude/projects/.../subagents/`) before assuming it's stuck — a heavy task (e.g. a new full page + backend resolver + Playwright verification) can legitimately run 10+ minutes. If it's still actively writing, re-arm the wakeup and keep waiting. Do not launch a duplicate agent for the same item.
- If the harness process itself gets interrupted mid-task (you'll see a `status: stopped` notification instead of `completed`, with a note that the transcript is preserved), **resume the same agent via `SendMessage` to its id** — don't start a fresh one. Check `git status`/disk state first so the resume message tells it exactly what's already done vs. still pending; nothing is lost, work-in-progress sits uncommitted on disk.
- If you hit an actual usage-limit signal (explicit quota/rate-limit error, not just a slow task), stop launching new agents immediately. Leave a clear note of what shipped, what's left, and why you stopped, then either schedule a much longer wakeup (past the likely reset window) or end the loop — don't retry into the same limit in a tight cycle.
- Never run two TODO-item agents in parallel. The whole point of one-at-a-time is bounded resource usage per unit time, same reasoning as this codebase's own ingestion-concurrency rule in `CLAUDE.md`.

## 4. Stopping conditions

The loop ends cleanly when any of:
- `docs/TODO.md`'s Planned features list is empty except for items explicitly skipped with a stated reason.
- The user-given time window elapses.
- A real usage-limit is hit.

In every case, leave the repo in a committed, working state (never stop mid-agent with uncommitted changes hanging) and be ready to summarize on request: what shipped (with commit hashes), what was skipped and why, what's still open.
