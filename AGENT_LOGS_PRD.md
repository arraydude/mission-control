# Agent Logs PRD

## Product

Mission Control — Agent Logs in Agents View

## Context

Mission Control already shows agent roster and operational state, but the Agents view still lacks one of the most useful operator capabilities:

**the ability to inspect logs for a specific agent directly from that agent's page/view.**

Right now, the operator can see that an agent exists or is active, but not easily understand:
- what it has been doing
- what errors or warnings appeared
- what recent execution traces look like

## Core Goal

Extend the Agents experience so each agent has a dedicated detail surface that includes recent logs for that agent.

## Why this matters

This improves:
- debugging
- trust
- operator visibility
- faster diagnosis of failures
- easier handoff between overview and investigation

Without logs, the Agents view answers:
- "who exists?"

With logs, it starts answering:
- "what is this agent actually doing?"
- "what went wrong?"
- "does this agent look healthy?"

## Product Principle

This is not a full observability platform.
This is a lightweight operator-facing log inspection surface inside Mission Control.

## User

Primary:
- Emiliano

Secondary:
- Clawdito / operator agents using Mission Control as a control room

## Job To Be Done

"When I inspect an agent in Mission Control, I want to see recent logs relevant to that agent so I can quickly understand its behavior, progress, or failures without leaving the product."

## Scope

This PRD covers v1 of agent log visibility.

It should be:
- useful
- readable
- local-first
- clearly connected to the agent being viewed

It should NOT become:
- a full log management system
- a heavy SIEM/observability product
- an infinite-scroll raw terminal dump with no structure

## Functional Requirements

## 1. Per-agent detail surface
The Agents view should let the user inspect an individual agent more deeply.

Acceptable UX patterns:
- dedicated agent detail panel
- dialog/drawer
- split layout with roster on one side and detail on the other

The important point is:
- each agent should have its own detail surface
- logs should belong to that surface

## 2. Recent logs section
Each agent detail view should include a recent logs section.

The logs section should show the most relevant recent entries available for that agent.

At minimum, each log entry should show:
- timestamp
- severity if available
- message/content

If source or subsystem is available and useful, show it too.

## 3. Data source strategy
Use pragmatic local sources.

Possible acceptable sources:
- OpenClaw local agent/session stores
- gateway logs filtered by agent/session context where feasible
- session metadata/log artifacts that can be mapped to an agent

The implementation should be practical.
If exact agent-only logs are hard to isolate perfectly, v1 can use the best available filtered or correlated recent log data, as long as the UI is honest about what it is showing.

## 4. Readability and trust
Logs should be readable and scannable.

The UI should avoid dumping unreadable walls of text.

Good v1 features:
- capped number of recent entries
- monospace or semi-monospace for raw log text if appropriate
- clear empty state when no logs are available
- visually distinct levels for error/warn/info if available

## 5. Empty/error states
If logs cannot be found or mapped for an agent, show a clear message such as:
- no recent logs found
- no agent-specific logs available yet
- log source unavailable

The user should not mistake absence of data for a broken UI.

## UX Requirements

## Agents view structure
The Agents page should become more useful than a flat roster.

The user should be able to:
1. scan the roster
2. pick an agent
3. inspect details
4. read recent logs

## Log presentation
Strong preference:
- compact list with timestamp and severity badges
- expandable full message if needed

Alternative acceptable v1:
- clean raw log block limited to recent entries

## Noise control
Do not overload the main roster with logs.
Logs should appear in the selected agent detail surface, not inline for every card at once.

## Definition of Done
This feature is successful when:

1. The Agents section supports drilling into an individual agent.
2. The selected agent shows a recent logs section.
3. Logs are readable and clearly tied to that agent/context as best as practical.
4. Empty states are clear when no logs are available.
5. The Agents experience becomes meaningfully more useful for debugging and inspection.

## Suggested Implementation Order

### Phase 1
- decide/detail the agent inspection UX pattern
- add selected agent state
- add agent detail surface

### Phase 2
- implement recent log retrieval for the selected agent
- normalize/cap entries for display

### Phase 3
- add visual polish to severity/timestamps/empty states
- improve readability

## Nice-to-have later (not required now)
- search within agent logs
- severity filters
- open full raw log file
- link from session row to agent log context
- live streaming logs

## Deliverable Expectations

When done, report back with:
1. what UX pattern was chosen for agent detail
2. where logs are coming from
3. how reliable the agent-to-log mapping is in v1
4. what changed in the UI
5. commit hash
