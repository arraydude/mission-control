# Mission Control

Operational dashboard for OpenClaw state, now with a lightweight agent task board.

## What became real

Mission Control is now a live operational surface instead of a static shell.

It reads real local OpenClaw state and shows:

- configured agents from `~/.openclaw/openclaw.json`
- whether each configured agent has a store on disk
- per-agent session counts, recent session counts, and latest activity
- recent sessions across agents with channel/model/session-file metadata
- gateway service/runtime/listening state from `openclaw gateway status`
- operational blockers derived from gateway warnings, stale agent/session state, missing stores, and orphan agent stores on disk
- configured channels and their current policies from `openclaw.json`
- a persistent task board for operational work across `Inbox`, `Ready`, `Doing`, `Blocked`, and `Done`

## Task board v1

The board is intentionally simple and fast:

- create tasks from the UI
- set title, notes, priority, initial status, and assigned agent
- move a task between statuses from the card itself
- reassign the responsible agent from the card itself
- see whether the assigned agent is currently active or idle when that agent exists in OpenClaw state
- keep task work visible in the same surface as the live ops dashboard

## Persistence

Task data is stored locally in:

- `apps/mission-control/data/mission-control.db`

The Vite dev server and preview server expose local API endpoints for the board:

- `GET /api/mission-control/tasks`
- `POST /api/mission-control/tasks`
- `PATCH /api/mission-control/tasks/:id`

This keeps persistence pragmatic and local to the machine running Mission Control, while giving task state a transactional SQLite-backed source of truth.

## What is still rough

- updates are polling-based, not websocket/SSE/live push
- task movement is select-based, not drag-and-drop
- session rows are metadata-first; task summaries are not extracted from conversation history yet
- there are no direct controls yet for restarting the gateway, opening logs, or drilling into a session

## How the data layer works

The Vite server/preview process exposes local API endpoints:

- `GET /api/openclaw/state`
- `GET /api/mission-control/tasks`
- `POST /api/mission-control/tasks`
- `PATCH /api/mission-control/tasks/:id`

Those endpoints read local OpenClaw files directly on the machine where Mission Control is running and return normalized data for the React UI.

## State source of truth

Mission Control task state now uses SQLite as the source of truth:

- `apps/mission-control/data/mission-control.db`

Legacy JSON files are treated as migration backups only and should not be considered live state.

## Task status helper

Mission Control also includes a simple CLI helper for automations/agents to update board status directly:

```bash
node scripts/task-status.mjs --agent main --from ready --to doing
node scripts/task-status.mjs --agent mida --from doing --to blocked --note "Blocked on missing API"
node scripts/task-status.mjs --agent main --contains "Claude Code SubAgent" --to done
```

Current sources:

- `~/.openclaw/openclaw.json`
- `~/.openclaw/agents/*/sessions/sessions.json`
- `~/.openclaw/subagents/runs.json` when present
- `openclaw gateway status`
- gateway log file path reported by `openclaw gateway status`
- `apps/mission-control/data/mission-control.db`

## Development

```bash
cd apps/mission-control
npm install
npm run dev
```

Default local dev port:

- `4174`

Open:

- `http://127.0.0.1:4174`

## Preview the production build locally

```bash
cd apps/mission-control
npm run build
npm run preview
```

The local APIs also work in preview mode, so the built app still reads real OpenClaw state on the same machine and keeps the task board editable.

## Tomorrow-morning usage

1. Open Mission Control.
2. Check the live agent/gateway state at the top.
3. Create a task in the left-hand capture panel.
4. Assign an agent owner and set the starting lane.
5. Use the board to move work across `Inbox → Ready → Doing → Blocked → Done` as the morning unfolds.
- Use `npm run build` before shipping UI changes to keep Mission Control healthy.
