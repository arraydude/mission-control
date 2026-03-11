# Mission Control Task Board PRD

## Product

Mission Control — Task Board Expansion

## Context

Mission Control v1 already evolved beyond a static shell and now exposes real OpenClaw operational state.

The next product step is to turn Mission Control into a place where Emiliano can not only **observe** agent state, but also **create and assign work**.

This PRD defines that next step in a way that is intentionally buildable overnight:
- clear phases
- atomic changes
- useful before complete

## Core Product Goal

Add a lightweight Trello-like task board to Mission Control so Emiliano can:

- create tasks
- see work status clearly
- assign a task to an agent
- move work through a small number of stages
- use the board alongside live operational visibility

## Product Principle

This is not a generic project-management app.
This is an **agent operations board**.

The board should answer:
- what needs doing?
- who should take it?
- where is it stuck?
- what is done?

## User

Emiliano

## Job To Be Done

"When I am operating multiple agents, I want one place where I can create work, assign it to the right agent, and track its state without losing the live operational picture."

## Non-Goals

Do NOT build these now unless they are trivial side effects:
- full Trello clone
- drag-and-drop perfection
- permissions system
- comments/activity log system
- due dates/calendars
- notifications engine
- multi-user collaboration
- deep analytics

## Success Criteria for Tomorrow Morning

By tomorrow morning, Mission Control should:

1. still show the live operational dashboard
2. include a usable task board
3. allow task creation from the UI
4. allow assigning an agent to a task
5. allow changing a task status
6. persist task state locally
7. feel coherent in UI/UX, not bolted on randomly

---

# Phase Plan

## Phase 1 — Board Foundation (must happen)

### Outcome
Mission Control gets a persistent task board with basic columns and cards.

### Required UX
Board with columns:
- Inbox
- Ready
- Doing
- Blocked
- Done

### Card fields
Each task card should support at least:
- id
- title
- description or notes
- status
- assignedAgent
- updatedAt

### Persistence
Store board data locally in a simple and durable way.

Acceptable examples:
- local JSON file
- lightweight local store
- small app-local persistence layer

Keep it simple.

### Atomic changes
1. Add task data model.
2. Add local persistence layer.
3. Add board UI with 5 columns.
4. Render task cards from stored data.

### Definition of done
- tasks persist across reloads
- board is visible and readable
- no fake sample cards unless clearly seeded intentionally

---

## Phase 2 — Task Creation (must happen)

### Outcome
Emiliano can create tasks directly from Mission Control.

### Required UX
Simple task creation flow, such as:
- inline form
- modal
- side panel

### Minimum fields on create
- title
- description/notes (optional but preferred)
- status (default: Inbox)
- assignedAgent (optional)

### Atomic changes
1. Add create-task UI.
2. Validate minimum fields.
3. Persist new task.
4. Refresh board immediately after creation.

### Definition of done
- Emiliano can create a task without touching code/files
- created task appears immediately in the board

---

## Phase 3 — Agent Assignment (must happen)

### Outcome
Tasks can be assigned to a known agent.

### Product rule
Agent assignment must be explicit and visible.

### Required behavior
- task can be unassigned
- task can be assigned to a real known agent
- assignment is shown clearly on the card

### Preferred UX
Use known live agent list from Mission Control’s real data layer.

### Atomic changes
1. Reuse/derive known agents from current live state.
2. Add agent selector in create/edit flow.
3. Show assigned agent on card.
4. Persist assignment.

### Definition of done
- assignment works with real agents
- unassigned state is visually clear

---

## Phase 4 — Status Changes (must happen)

### Outcome
Tasks can move between workflow states.

### Acceptable UX
Any of these are acceptable for v1:
- dropdown change
- quick action buttons
- lightweight move controls

Drag-and-drop is optional, not required.

### Atomic changes
1. Add status-update interaction.
2. Persist updated status.
3. Update `updatedAt`.
4. Reflect movement in board UI.

### Definition of done
- a task can reliably move from Inbox to another state
- movement survives reload

---

## Phase 5 — Integration with Live Ops Dashboard (must happen)

### Outcome
The board feels like part of Mission Control, not a disconnected mini-app.

### UX expectation
Good acceptable patterns:
- tabs (Overview / Tasks)
- split layout
- dashboard sections with board beneath

### Product requirement
The live ops state should remain accessible.

### Atomic changes
1. Integrate board into current Mission Control layout.
2. Preserve access to live agent/session/blocker sections.
3. Make navigation between ops view and task board obvious.

### Definition of done
- Mission Control still works as control room
- board is part of the same product surface

---

## Phase 6 — Useful Polish (only if time remains)

### Outcome
Small UX improvements that increase clarity without bloating scope.

### Good examples
- task count per column
- empty states
- priority badge
- clearer updated timestamps
- highlight tasks assigned to active agents
- focus section: “needs attention now”

### Do not do
- heavy animations
- large visual redesign
- feature sprawl

---

# Data & Architecture Guidance

## Preferred data split
Use two clear layers:

1. **live ops state**
   - from OpenClaw / session data / gateway state
2. **task board state**
   - from local board persistence

These can be merged in the frontend view model.

## Keep architecture pragmatic
Good:
- small adapter
- one API endpoint for live state
- one API/file for board state

Bad:
- giant backend rewrite
- overdesigned domain model
- building infrastructure before shipping usefulness

---

# UX Guidance

## Tone
Mission Control should feel:
- sharp
- operational
- calm under load
- high signal, low fluff

## Card design priorities
- title readable fast
- assignee obvious
- status obvious
- minimal noise

## Board priorities
- clarity over density
- at-a-glance usability
- fast updates

---

# Definition of Success

This PRD succeeds if tomorrow morning Emiliano can:

1. open Mission Control
2. see real agent/session/system state
3. switch to or view a task board
4. create a task
5. assign it to an agent
6. move it through statuses
7. trust the board enough to start using it

---

# Suggested Build Order Tonight

1. Phase 1 — Board foundation
2. Phase 2 — Task creation
3. Phase 3 — Agent assignment
4. Phase 4 — Status changes
5. Phase 5 — Integrate with dashboard
6. Phase 6 — Useful polish only if time remains

---

# Deliverable Format Back To Clawdito / Emiliano

When this work is ready, report in this format:

1. What was built
2. Which phases are complete
3. What is real vs still rough
4. Where task data is stored
5. Commit hash(es)
6. How Emiliano should use it tomorrow morning
