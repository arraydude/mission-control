# ACP Runs Visibility PRD

## Product

Mission Control — ACP / Claude Code Run Visibility

## Context

Mission Control is evolving into a real control room for agents and automation.
Now that ACP is operational, it is important that the control room reflects that reality.

At the moment, Claude Code / ACP work can happen outside the visible Mission Control surface.
That creates a gap:
- work is running
- but the operator cannot easily see it in the dashboard

## Core Goal

Mission Control should visibly show when ACP-powered coding runs (such as Claude Code) are active, recent, or completed.

## Why this matters

This improves:
- operator trust
- visibility into real work happening in the system
- clarity around who/what is currently running
- coherence between orchestration and UI

Without ACP run visibility, Mission Control is missing an important class of execution.

## Product Principle

This should feel like a clean operational surface, not a noisy job log wall.

The operator should be able to answer quickly:
- is Claude Code / ACP running right now?
- what is it working on?
- where is it running?
- when did it last update?
- did it finish / fail / keep running?

## User

Primary:
- Emiliano

## Jobs To Be Done

"When Claude Code or another ACP harness is running, I want Mission Control to show that clearly so I can understand active execution without guessing."

## Scope

This PRD covers v1 of ACP run visibility.

It should support:
- visibility of recent/current ACP runs
- clear status
- useful summary fields
- integration into existing Mission Control surfaces

It should NOT become:
- a full observability suite
- a deep distributed tracing system
- an overwhelming stream of raw events

## Functional Requirements

## 1. Detect ACP runs
Mission Control should read available local/runtime state to detect ACP runs.

The implementation can be pragmatic.
Use the best available local source(s) to identify:
- active ACP sessions/runs
- recent completed ACP runs
- their basic metadata

## 2. Core ACP run fields
For each ACP run shown, include as many of these as are reliably available:
- agent/harness name (for example Claude Code)
- runtime type (`acp`)
- current state/status:
  - running
  - completed
  - failed
  - idle/recent if useful
- task summary / prompt summary if safely available
- working directory/repo if useful
- start time / last update time
- optional recent result summary if available

## 3. Dashboard integration
Mission Control Dashboard should expose ACP activity in a quick-glance way.

Good acceptable patterns:
- Active Runs card/section
- ACP activity strip
- recent active execution panel

This should be compact and high-signal.

## 4. Detailed visibility
There should also be a more detailed surface somewhere appropriate, such as:
- Sessions view
- Agents view
- dedicated ACP/Run section if naturally needed

The important point is that the operator can drill down beyond just a dashboard badge.

## 5. Readability
The UI must remain clean.
Do not dump raw internals noisily.
Use concise rows/cards/status badges.

## UX Requirements

## Dashboard
The dashboard should answer quickly:
- is Claude Code running?
- what is the most important active ACP work?

## Drilldown
A more detailed surface should help answer:
- what task is running?
- where?
- with what status?
- what happened last?

## Noise control
Avoid flooding the dashboard with many tiny historical runs.
Prefer:
- active runs
- a few recent runs
- status summaries

## Definition of Done
This feature is successful when:

1. Mission Control shows active/recent ACP runs.
2. Claude Code activity is visible when it is running.
3. The dashboard gives useful quick-glance visibility.
4. There is a reasonable drilldown surface.
5. The UI remains readable and trustworthy.

## Suggested Implementation Order

### Phase 1
- identify local ACP run/session source
- normalize ACP run data into Mission Control backend layer

### Phase 2
- add compact dashboard visibility for active/recent ACP runs

### Phase 3
- add a detailed ACP run section into Sessions or another appropriate view

### Phase 4
- polish labels/status/timestamps and empty states

## Nice-to-have later (not required now)
- open run detail
- log snippets
- stop/retry controls
- direct links from ACP run to related task card

## Deliverable Expectations

When done, report back with:
1. where ACP run data comes from
2. what is shown on Dashboard
3. where the detailed view lives
4. any limitations of the current mapping
5. commit hash
