# Task Dispatcher PRD

## Product

Mission Control — Deterministic Task Dispatcher

## Context

Mission Control already has:
- a task board
- assigned agents
- status workflow
- live operational visibility

What is still missing is a reliable mechanism that turns assigned `ready` tasks into actual execution without relying on heavyweight LLM polling every minute.

## Core Goal

Implement a lightweight deterministic dispatcher inside Mission Control that periodically checks for actionable tasks and dispatches them to the correct agent.

## Product Principle

The dispatcher should be:
- cheap
- deterministic
- low-noise
- reliable
- agent-triggering, not agent-replacing

This is not a thinking layer.
This is an orchestration layer.

## Why this matters

This improves:
- automation of task pickup
- reduced manual overhead
- lower token waste
- faster execution flow
- better trust in Mission Control as an orchestration surface

## Scope

This PRD covers v1 of a local dispatcher.

It should:
- run inside the Mission Control context
- watch for actionable tasks
- dispatch them to known agents
- avoid duplicate dispatches
- surface blockers when dispatch is not possible

It should NOT:
- become a general workflow engine
- implement complex retry policies
- replace agent judgment
- solve every queueing/orchestration problem

## Initial Operating Rules

### Polling strategy
Use a lightweight deterministic check loop.

### Actionable status
Only tasks with:
- `status == ready`

should be considered dispatchable.

### Initial supported agents
Support these first:
- `main`
- `mida`

### If assigned agent does not exist or is unavailable
Treat that as a blocker/warning condition.

### Notifications
Notify Emiliano only when there is a real blocker.
Do not create noisy progress chatter for every dispatch.

## Functional Requirements

## 1. Dispatcher loop
Mission Control should include a local dispatcher loop or server-side interval that:
1. reads the current task board
2. finds tasks with `status == ready`
3. checks whether the assigned agent is eligible and known
4. dispatches the task to the assigned agent

## 2. Duplicate prevention
The dispatcher must avoid repeatedly dispatching the same task every cycle.

Acceptable v1 approaches:
- `lastDispatchedAt`
- `dispatchLock`
- `dispatchState`
- `dispatchAttempts`

The implementation can be pragmatic, but duplicate firing should be prevented.

## 3. Dispatch target
For v1, dispatch to the assigned agent through the local OpenClaw-compatible path available in the environment.

The exact integration can be pragmatic as long as it works reliably.

## 4. Task mutation / metadata
The dispatcher may add lightweight metadata to tasks to support orchestration.

Acceptable examples:
- `lastDispatchedAt`
- `dispatchAttempts`
- `dispatchLock`
- `lastDispatchError`

This metadata should help the system be reliable without cluttering the main UX.

## 5. Blocker handling
If a task is assigned to:
- an unknown agent
- an unavailable/unroutable agent
- or dispatch fails in a meaningful way

then Mission Control should:
- mark the task or note the dispatch issue clearly
- create a blocker/warning signal
- optionally add a comment/log entry
- notify Emiliano only for real blockers

## 6. Integration with current task state rules
The dispatcher should not itself pretend the work is done.
Its job is to dispatch work.

The assigned agent remains responsible for:
- changing `ready -> doing` when it actually starts
- changing to `blocked` when blocked
- changing to `done` when completed

## UX / Product Requirements

## 1. Operator visibility
The system should make dispatching legible.
At minimum, there should be enough state for Emiliano to understand:
- whether a task was dispatched recently
- whether dispatch failed
- whether a task is waiting for agent pickup

This can initially live more in metadata/comments than in polished UI if needed.

## 2. Low noise
Do not spam Telegram or Mission Control with routine dispatch chatter.
Only escalate when meaningful.

## Suggested V1 Architecture

### Preferred approach
Implement the dispatcher in the Mission Control local backend/dev server layer.

Possible pattern:
- background interval on the local server process
- reads `data/mission-control-tasks.json`
- dispatches via local OpenClaw-compatible invocation

This is preferred over using an LLM agent to poll every minute.

## Data Model Suggestions

Task model may gain fields like:
- `lastDispatchedAt`
- `dispatchAttempts`
- `dispatchLock`
- `lastDispatchError`

These are implementation-support fields, not primary product fields.

## Definition of Done

This feature is successful when:

1. The system checks for `ready` tasks automatically.
2. Tasks assigned to `main` or `mida` can be dispatched automatically.
3. Duplicate dispatching is prevented reasonably.
4. Real dispatch failures surface as blockers/warnings.
5. Emiliano is only notified on blockers, not on every routine dispatch.
6. The implementation stays lightweight and deterministic.

## Suggested Implementation Order

### Phase 1
- define task dispatch metadata
- implement task scan loop
- detect actionable tasks (`ready`)

### Phase 2
- dispatch to `main` and `mida`
- prevent duplicate dispatch

### Phase 3
- add blocker handling + notification path
- expose enough visibility for operator trust

## Nice-to-have later (not required now)
- retries/backoff
- more agent types
- per-task dispatch history
- UI for dispatcher health
- pause/resume dispatcher controls

## Deliverable Expectations

When done, report back with:
1. how the dispatcher runs
2. how dispatching works
3. how duplicates are prevented
4. how blocker notifications work
5. what metadata was added to tasks
6. commit hash
