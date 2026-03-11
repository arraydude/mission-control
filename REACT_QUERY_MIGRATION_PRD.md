# React Query Migration PRD

## Product

Mission Control — React Query Migration

## Context

Mission Control has grown beyond a simple static frontend.
It now includes:
- live operational dashboard data
- task board state
- task creation and updates
- comments/progress logs
- agent detail views
- agent log views
- dispatcher-related state
- periodic refresh/polling

As the product grows, manual fetch + local state patterns become increasingly fragile and harder to reason about.

## Core Goal

Introduce React Query into Mission Control in a structured way so that data fetching, mutations, polling, cache invalidation, and optimistic UX become more reliable and easier to maintain.

## Product Principle

This migration should improve:
- correctness
- UI consistency
- maintainability
- trustworthiness of data refresh
- developer velocity

It should NOT become a giant architectural rewrite done in one unsafe jump.

## Requirement for implementation

Claude Code should explicitly load and use the `react-query-best-practices` skill while implementing this migration.

That skill should inform:
- query key structure
- mutation design
- invalidation/refetch patterns
- separation of server state vs UI state
- polling/revalidation behavior

## Non-Goals

Do NOT:
- rewrite every component at once
- redesign the whole app visually
- migrate purely local UI state into React Query if it is not server state
- introduce unnecessary abstraction layers
- break Mission Control while chasing ideal architecture

## Migration Philosophy

Do this incrementally.
Each phase should leave the app working and more trustworthy than before.

---

# Phase Plan

## Phase 1 — Foundation

### Goal
Add React Query cleanly to the app and establish the baseline patterns.

### Deliverables
- install/configure React Query
- add QueryClient provider at app root
- define query key strategy
- establish one shared API/query layer or helper pattern

### Product rule
Keep the foundation simple. Do not overabstract yet.

### Definition of done
- app has React Query provider
- query keys follow a consistent scheme
- no visible regressions

---

## Phase 2 — Tasks as first-class server state

### Goal
Migrate the most important operational surface first: tasks.

### Scope
Use React Query for:
- task list fetch
- task creation
- task updates
- task comments fetch/mutations if practical in the same pass

### Why this phase matters
Tasks are the operational core of Mission Control.
If React Query is only applied in one place first, this is the right place.

### Deliverables
- `useTasks` query
- task creation mutation
- task update mutation
- invalidation/refetch strategy
- comments integrated if the implementation remains clean

### Definition of done
- task board no longer relies on fragile manual fetch/state loops
- mutations update the UI reliably
- cache invalidation is predictable

---

## Phase 3 — Comments and task detail flows

### Goal
Make task detail interactions more trustworthy and easier to maintain.

### Scope
React Query for:
- task comments fetch
- add comment mutation
- task detail refresh behavior
- dialog/detail invalidation after edits

### UX target
Task detail should feel responsive and coherent when:
- editing a task
- adding comments
- changing status
- assigning agents

### Definition of done
- task detail uses query/mutation flows cleanly
- comment and edit operations do not require awkward manual state syncing

---

## Phase 4 — Agent detail and logs

### Goal
Apply React Query to richer read surfaces that benefit from cache and refetch behavior.

### Scope
Use React Query for:
- agent detail fetch
- agent logs fetch
- session/agent detail data where appropriate

### Product target
The Agents view should feel more stable and less manually stitched together.

### Definition of done
- agent detail/log views use React Query patterns
- loading and refresh behavior feels more predictable

---

## Phase 5 — Polling, invalidation, and freshness

### Goal
Replace ad-hoc polling/manual update logic with cleaner React Query-driven freshness control.

### Scope
- align polling intervals with actual product needs
- reduce unnecessary re-renders
- use targeted invalidation instead of broad reset behavior
- ensure background refresh feels calm, not disruptive

### Product rule
Background automation should feel invisible unless the data meaningfully changes.

### Definition of done
- no ugly “page reboot” feeling from refresh cycles
- data freshness is reliable
- refresh behavior is understandable and maintainable

---

## Phase 6 — Optimistic UX and polish (optional after core stability)

### Goal
Improve UX where React Query enables cleaner interaction.

### Possible scope
- optimistic task updates where safe
- better mutation loading states
- toast/success/error feedback
- clearer stale/loading transitions

### Constraint
Only do this after the earlier phases are stable.

### Definition of done
- mutations feel smoother without reducing trust

---

# Technical Guidance

## Use React Query for server state, not everything
Good candidates:
- tasks
- comments
- agent detail/log data
- dashboard data blocks fed from local API

Not everything should go into React Query.
Examples that can stay local/UI state:
- active tab/view
- dialog open/close state
- temporary form inputs
- local filters/search text

## Query key discipline
Use stable query keys.
Examples:
- `['tasks']`
- `['task', taskId]`
- `['task-comments', taskId]`
- `['agents']`
- `['agent', agentId]`
- `['agent-logs', agentId]`
- `['openclaw-state']`

## Mutation discipline
Mutations should:
- have clear responsibility
- invalidate only what needs refresh
- avoid broad cache nukes unless necessary

## Error handling
The app should move toward clearer loading/error states around server state.
Do not leave components in ambiguous half-updated states.

---

# Risks

## Risk 1 — Refactor too broad
If too much is migrated at once, Mission Control could regress.

### Mitigation
Ship phase by phase.

## Risk 2 — Mixing React Query with existing ad-hoc state badly
A half-migrated app can get confusing if patterns are inconsistent.

### Mitigation
Migrate feature slices cleanly.

## Risk 3 — Overengineering
React Query should simplify the product, not create a new abstraction maze.

### Mitigation
Prefer straightforward hooks and query keys over fancy frameworks.

---

# Definition of Success

This migration is successful when:

1. Mission Control becomes easier to maintain.
2. Task workflows become more reliable in the UI.
3. Polling and refresh behavior become calmer and less fragile.
4. Agent/detail/log surfaces become easier to reason about.
5. The app feels more trustworthy, not more complicated.

---

# Suggested Implementation Order for Claude Code

1. Load and follow `react-query-best-practices`
2. Phase 1 — Foundation
3. Phase 2 — Tasks
4. Phase 3 — Comments/detail flows
5. Phase 4 — Agent detail/logs
6. Phase 5 — Polling/invalidation cleanup
7. Phase 6 only if earlier phases are stable

---

# Deliverable Expectations

When the work is done, report back with:
1. which phases were completed
2. what parts of Mission Control now use React Query
3. what remains on legacy/manual fetch logic
4. how polling/invalidation changed
5. commit hash(es)
