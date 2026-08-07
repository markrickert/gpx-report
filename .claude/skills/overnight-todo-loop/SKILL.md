---
name: overnight-todo-loop
description: Autonomous, unattended sweep through docs/TODO.md's Planned features, one background agent at a time, paced to survive long unattended windows without hitting usage limits. Use when the user asks for an overnight/autonomous run through open TODOs (e.g. "/goal get through the todos by morning", "work through the backlog while I'm away").
---

Read this fully before starting — it's the ruleset, not a suggestion.

## 0. Pull check

`git fetch`, then `git rev-list HEAD..origin/main --count`. Nonzero → `git pull --ff-only`, then re-read `docs/TODO.md` (the pulled commits may have added/removed/edited items — build the work list off the post-pull file, not a stale read). Fast-forward fails (diverged history) → stop and report, don't force anything.

This is running overnight/unattended — a same-night human edit landing mid-run is unlikely, so expect this check to almost always be a no-op. It's here for the case a change *did* land (last-minute manual commit before the loop started, previous day's edit not yet pulled) — cheap to check, expensive to miss.

## 1. Build the work list

Read `docs/TODO.md`'s unfinished tasks. For each, decide **do** or **skip** before touching anything.

**Skip only for a real concern** (say so in one sentence, then move on):
- Missing spec/sample data you can't verify against (undocumented format, no example file in repo).
- An architecture-level decision only the user can make (a scope pivot, not an implementation detail).
- A genuine correctness/safety question you can't resolve by reading the code.

**Don't skip for ordinary ambiguity** ("exact approach TBD" in the ticket) — that's normal scope to resolve with a documented judgment call. Make the call, note it in the commit/TODO entry, move on.

Order remaining items simplest/lowest-risk first — builds a track record of clean commits before anything gnarly, and a stuck item late in the night doesn't block the rest. Explicit dependencies between items override this ordering — respect them.

## 2. One agent at a time, fully briefed

Launch exactly one background `Agent` (`subagent_type: general-purpose`, default direct-repo isolation — no worktree needed) per TODO item. Never launch the next until the current one has landed a commit or reported a genuine concern.

Each brief is self-contained — the agent has no memory of this conversation. Include:
- Point it at `CLAUDE.md` first, for deployment mechanics and behavioral rules.
- Name exact files/patterns to reuse — don't make it rediscover conventions already settled here (CSS variable theming, the `xAxisId="idx"` chart pattern, the file-based ingestion pipeline, etc.).
- State the verification method explicitly: rebuild the right `docker compose` service, drive it with Playwright + system chromium (no `chromium-cli` here), screenshot, check light/dark theme and mobile viewport where relevant.
- Require it to update `docs/TODO.md` (move item to Done, present-tense description), sweep other `docs/*.md` if now stale, then commit — one commit per item, not batched.
- Give it an explicit stop clause: genuine safety/correctness doubt → stop and report, don't commit. Otherwise finish fully autonomously, no questions back to the user.
- Any new server-side write surface (mutation writing files, new disk paths) needs an explicit line about not trusting client-supplied paths/filenames.

## 3. Pacing and usage-limit awareness

- After launching an agent, call `ScheduleWakeup` with a **1800s fallback** naming what you're waiting on. This is a heartbeat, not a poll loop — the harness notifies you automatically when the agent finishes; the wakeup only covers a missed/delayed notification.
- Wakeup fires but the agent hasn't completed: check `git log`/`git status` first. No new commit yet? Check whether its transcript (`.jsonl` under `~/.claude/projects/.../subagents/`) is still growing before assuming it's stuck — a heavy task can legitimately run 10+ minutes. Still writing → re-arm the wakeup and keep waiting. Never launch a duplicate agent for the same item.
- Harness interrupted mid-task (a `status: stopped` notification instead of `completed`, transcript preserved) → **resume the same agent via `SendMessage` to its id**, don't start fresh. Check `git status`/disk state first so the resume message states exactly what's done vs. pending; nothing is lost, work-in-progress sits uncommitted on disk.
- Real usage-limit signal (explicit quota/rate-limit error, not just a slow task) → stop launching new agents immediately. Leave a clear note of what shipped, what's left, why you stopped, then either schedule a much longer wakeup (past the likely reset window) or end the loop. Don't retry into the same limit in a tight cycle.
- Never run two TODO-item agents in parallel — same one-at-a-time-for-bounded-resource-usage reasoning as this codebase's ingestion-concurrency rule in `CLAUDE.md`.

## 4. Stopping conditions

End cleanly when any of:
- `docs/TODO.md`'s Planned features list is empty except items explicitly skipped with a stated reason.
- The user-given time window elapses.
- A real usage-limit is hit.

Always leave the repo committed and working (never stop mid-agent with uncommitted changes hanging). Be ready to summarize on request: what shipped (with commit hashes), what was skipped and why, what's still open.
