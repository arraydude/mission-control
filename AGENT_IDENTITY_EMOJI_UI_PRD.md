# Agent Identity Emoji UI PRD

## Product

Mission Control — Agent Identity Emoji Across Dashboard and Agents View

## Context

Mission Control is increasingly agent-centric.
Agents now have explicit identities, including identity emojis.
Those emoji should not appear only in task assignee contexts — they should also improve recognition across the broader Mission Control UI.

## Core Goal

Show identity emojis consistently in places where agents are represented, especially:
- Dashboard section for active agents
- Agents view / roster / detail surfaces

## Why this matters

This improves:
- faster visual recognition of agents
- personality and coherence of the system
- lower cognitive effort when scanning active agent state
- stronger sense that agents are distinct working entities

## Product Principle

Identity emoji are compact recognition markers.
They should support usability, not create noise.

## User

Primary:
- Emiliano

## Job To Be Done

"When I scan Dashboard or Agents, I want to recognize agents quickly by both name and identity marker, especially when they are active."

## Scope

This PRD covers v1 of identity emoji support outside task cards.

Primary surfaces:
1. Dashboard active agents section
2. Agents view / roster
3. Agent detail surfaces where natural

## Functional Requirements

## 1. Dashboard active agents
In the Dashboard area that shows active agents / agent summary, display:
- identity emoji
- agent name

If there is a distinct section for active agents, that section should clearly show the emoji for each active agent.

## 2. Agents view
In the Agents page, show identity emoji anywhere agent identity is a first-class element, such as:
- roster cards
- selected agent header
- detail surface title

## 3. Data source
Use available agent identity metadata or a pragmatic mapping strategy.

Acceptable v1:
- derive emoji from identity files
- derive from already-known app data if enriched
- use a local mapping layer if necessary

## 4. Graceful fallback
If an agent has no known emoji:
- show name only
- no broken spacing/layout

## 5. Consistency
The same agent should render with the same emoji everywhere in the app where identity is shown.

## UX Requirements

- emoji should improve scan speed
- emoji should not dominate the UI
- spacing and alignment should remain clean
- active agents section should feel sharper/more glanceable with emoji present

## Definition of Done
This feature is successful when:

1. Dashboard active agent representations show identity emoji.
2. Agents view surfaces show identity emoji where appropriate.
3. Fallbacks remain clean for agents without emoji.
4. The result feels more legible and more coherent, not noisier.

## Suggested Implementation Order

### Phase 1
- define/confirm identity emoji source
- wire dashboard active agents section

### Phase 2
- apply to Agents roster/detail surfaces

### Phase 3
- spacing/alignment polish

## Deliverable Expectations

When done, report back with:
1. where emoji data comes from
2. where it now appears in Dashboard
3. where it now appears in Agents view
4. fallback behavior
5. commit hash
