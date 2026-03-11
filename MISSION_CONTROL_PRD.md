# Mission Control PRD

## Product

Tribe Mission Control

## Purpose

Turn Mission Control from a static mock dashboard into a real operational control surface for Emiliano's agent workflow.

The next version should prioritize **useful live visibility** over visual novelty.

## Core Problem

The current UI looks promising, but the most important information is still hardcoded:

- agent roster
- metrics
- timeline
- blockers
- current work

That means the app is not yet helping Emiliano operate agents in real time.

## Product Goal

Mission Control v1 should become the place where Emiliano can open one screen and immediately understand:

- which agents exist
- which agents are active
- what sessions are currently alive
- what is blocked or unhealthy
- what needs attention next

## Primary User

Emiliano

## Primary Job To Be Done

"When I open Mission Control, I want immediate operational awareness of my agent system so I can decide what to do next without digging through dashboards, terminals, or guesswork."

## Scope of This PRD

This PRD is for the **first real-data version** of Mission Control.

It is **not** a full product redesign.
It is **not** a multi-page admin suite.
It is **not** a polished analytics platform.

It is a practical first version of a real control room.

## North Star

Replace static confidence theater with real operational visibility.

## Must-Have Outcomes

### 1. Real agent roster
The UI must show real OpenClaw agents instead of hardcoded cards.

For each agent, display at least:
- name
- whether it exists in the current system
- session count if available
- active / inactive signal
- last update if available
- useful path/store info if available

### 2. Real session visibility
The UI should show recent or active sessions if feasible.

At minimum, Mission Control should expose:
- session identity
- associated agent
- recent activity timestamp
- basic model/context info if available and useful

### 3. Real operational warnings
Mission Control should include at least one section that surfaces real system issues or blockers.

Examples:
- gateway service not loaded
- stale/unknown agent state
- channels unhealthy
- no active sessions
- missing config or model/runtime issues

### 4. Live-feeling metrics
The top metrics row should be derived from real data where possible.

Examples:
- active agents
- active sessions
- known warnings/blockers
- agents with recent activity

It is acceptable if some metrics are still partially derived heuristics, as long as they are no longer static fiction.

## Functional Requirements

## Data source strategy
Implement a real data layer for Mission Control.

Preferred approach:
- fetch data from OpenClaw-accessible local system/state
- use a thin backend adapter if needed
- keep the implementation pragmatic

Acceptable sources may include:
- OpenClaw status output
- agent/session stores
- local JSON/session files
- lightweight local API if needed

The exact mechanism is flexible, but the result must visibly show real data.

## UI sections

### A. Overview metrics
Keep the current overview card row, but populate it from real state.

### B. Agent roster
Keep the current roster concept, but replace hardcoded entries with live data.

### C. Recent sessions / activity
Add or replace a section so Emiliano can see what is actually active/recent.

### D. Operational blockers
Add a section that surfaces real issues from the system.

## Non-Goals

Do not do these in this iteration unless required for the real-data unlock:
- major visual redesign
- auth system
- role management
- historical analytics warehouse
- advanced filtering UI
- notifications center
- speculative multi-tenant abstractions

## UX Principles

- useful in under 10 seconds
- low ambiguity
- readable at a glance
- no fake numbers
- no decorative complexity without operational value

## Product Rules

- real data beats polished mock data
- partial truth is acceptable if clearly real
- if something is still mocked, it should be minimal and obvious
- avoid overengineering the backend for v1

## Technical Direction

The implementation can introduce a lightweight local data adapter if needed.

Good direction:
- small server endpoint or local file reader
- one normalized payload for the frontend
- keep frontend simple and data-driven

Bad direction:
- giant architecture rewrite
- big framework change
- complex state machine before live data exists

## Definition of Done

Mission Control v1 is considered successful when:

1. Opening the app shows real agent information.
2. At least one major section is fully powered by live data.
3. The app visibly reflects actual OpenClaw state rather than hardcoded placeholders.
4. Emiliano can use the screen to answer: "what is running, what is blocked, and what needs attention?"
5. The app still looks coherent and feels like Mission Control.

## Suggested Implementation Order

1. Add a local data adapter / source.
2. Wire overview metrics to real data.
3. Replace hardcoded agent cards with real agent roster.
4. Add sessions/activity panel.
5. Add real blockers/warnings panel.
6. Clean up remaining mocked content.

## Deliverable Expectations

When this work is done, report back with:
- what is now real
- what is still mocked
- where the data comes from
- what the next product step should be

## Recommended Next Step After This PRD

After Agent & Session Live State is working, the next likely upgrade should be:
- task queue / assignments
or
- per-agent drilldown

But only after the control room stops being static.
