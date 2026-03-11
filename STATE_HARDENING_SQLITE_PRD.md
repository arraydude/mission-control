# State Hardening PRD

## Product

Mission Control — State Hardening with SQLite + Local Backend

## Context

Mission Control began with local JSON-backed task state, which was acceptable for early prototyping.

That is no longer sufficient.

The product now has multiple concurrent actors touching state:
- UI task creation/editing
- task comments
- dispatcher logic
- agent automation
- helper scripts
- periodic background checks

This creates race conditions and unreliable state when using flat JSON files as the main source of truth.

## Core Problem

Mission Control needs reliable local state.

Current JSON-based state is too fragile because it lacks:
- transactional updates
- safe concurrent writes
- reliable locking semantics
- normalized data for comments/dispatch history
- a durable source of truth for automation-heavy workflows

## Core Goal

Migrate Mission Control state management from ad-hoc JSON file mutation to a local SQLite-backed system with a lightweight local backend/API.

## Product Principle

Mission Control should remain:
- local-first
- lightweight
- pragmatic
- easy to run

This is not a cloud backend initiative.
This is a local reliability upgrade.

## Why this matters

This should improve:
- correctness of task state
- reliability of dispatch
- safe concurrent updates
- auditability of task/comment/dispatch history
- future tooling for Clawdito and other agents

## Scope

This PRD covers the first hardening phase only.

Focus on moving the **core mutable board state** into SQLite:
- tasks
- comments
- dispatch metadata/events

Do NOT expand scope unnecessarily.

## Non-Goals

Do NOT build now:
- remote multi-user sync
- auth/permissions
- cloud hosting
- heavy ORM complexity if not needed
- large analytics layer
- broad migration of every Mission Control feature into a full backend platform

## Architecture Direction

## 1. Source of truth
Mission Control should use a local SQLite database as the source of truth.

Suggested location:
- `apps/mission-control/data/mission-control.db`

## 2. Local backend/API
Mission Control should expose a lightweight local API for reading and mutating state.

The UI should stop directly depending on raw JSON task file semantics.

## 3. Dispatcher integration
The dispatcher should read/write against SQLite, not against a JSON file.

## 4. Agent/helper integration
The system should support lightweight helper/CLI operations against the same source of truth.

This is important because Clawdito/agents may later need reliable task operations such as:
- claim task
- set status
- add comment
- complete task

## Data Model

## Tasks
Suggested fields:
- `id`
- `title`
- `description`
- `priority`
- `status`
- `assignedAgent`
- `createdAt`
- `updatedAt`

Optional/supporting fields as needed:
- `createdBy`
- `archivedAt`

## Task comments
Separate table for comments.

Suggested fields:
- `id`
- `taskId`
- `author`
- `type`
- `text`
- `createdAt`

## Task dispatch metadata/events
Prefer normalized dispatch event/history instead of embedding ad-hoc mutable dispatch blobs forever.

Suggested event/log table:
- `id`
- `taskId`
- `agentId`
- `eventType`
- `message`
- `createdAt`

Optional task-level derived fields can still exist for convenience, for example:
- `lastDispatchedAt`
- `dispatchAttempts`
- `lastDispatchError`

But the event history should be durable and queryable.

## API Requirements

The API can remain local and simple.

Minimum target endpoints:
- `GET /api/mission-control/tasks`
- `POST /api/mission-control/tasks`
- `PATCH /api/mission-control/tasks/:id`
- `POST /api/mission-control/tasks/:id/comments`
- `GET /api/mission-control/tasks/:id/comments`

Recommended next endpoints if practical:
- `POST /api/mission-control/tasks/:id/dispatch`
- `POST /api/mission-control/tasks/:id/status`
- `GET /api/mission-control/tasks/:id/events`

## Migration Strategy

This should be done incrementally and safely.

## Phase 1 — Schema + storage
Build SQLite schema and initialization logic for:
- tasks
- task_comments
- task_dispatch_events

## Phase 2 — Data access layer
Create a clean local data layer for:
- list tasks
- create task
- update task
- list/add comments
- record dispatch events

## Phase 3 — API migration
Switch the Mission Control API to use SQLite-backed reads/writes.

At this point the UI should continue working, but against the DB-backed API.

## Phase 4 — Dispatcher migration
Move dispatcher logic off JSON mutation and onto SQLite.

This is one of the highest-value outcomes because it reduces state corruption/race conditions.

## Phase 5 — Helper/CLI support
Add a small helper interface for automation use.

Examples:
- claim task
- set status
- add comment
- complete task

This can be a CLI script or a local internal adapter.

## Migration Rules

- preserve existing task data if possible
- migrate from current JSON task file into SQLite once
- avoid destructive deletion before verifying DB-backed behavior
- keep fallback/visibility during transition if useful

## Reliability Requirements

The new system should:
- survive concurrent read/write better than JSON
- update `updatedAt` correctly
- preserve comments and dispatch history
- prevent disappearing or overwritten tasks during normal usage

## UI/Product Requirements

The UI should not need to visibly change much because of this migration.

This is a backend/state reliability improvement first.

If anything should improve from the user perspective, it is:
- fewer strange state regressions
- fewer disappearing tasks
- more trustworthy task transitions
- more reliable comments and dispatch tracking

## Definition of Done

This project is successful when:

1. Mission Control task state is backed by SQLite.
2. UI reads/writes happen through the local API backed by SQLite.
3. Comments are persisted in SQLite.
4. Dispatcher uses SQLite instead of mutating JSON directly.
5. Existing task workflows still work.
6. State reliability is materially better than before.

## Risks / Tradeoffs

### Tradeoff
This adds some backend complexity compared to a single JSON file.

### Why it is worth it
The product has already outgrown file-based state mutation.
This is now a necessary foundation upgrade, not premature architecture.

## Deliverable Expectations

When done, report back with:
1. schema/tables created
2. what was migrated off JSON
3. what still remains file-backed
4. how the dispatcher changed
5. what helper surface now exists for agents
6. commit hash
