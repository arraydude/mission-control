# Agent Identity Emoji PRD

## Product

Mission Control — Agent Identity Emoji in Tasks

## Context

Mission Control tasks already show the assigned agent by name.

However, agents now also have explicit identities, including an identity emoji.
Showing only the agent name misses an opportunity to make the board more legible and more human-readable at a glance.

## Core Goal

Whenever a task shows an assigned agent, Mission Control should also show that agent’s identity emoji next to the name.

## Why this matters

This improves:
- fast visual recognition
- scannability of the board
- personality/coherence of the agent system
- reduced cognitive load when scanning many cards

## Product Principle

The emoji is a compact identity signal, not decoration.
It should help recognition without becoming noisy.

## User

Primary:
- Emiliano

## Job To Be Done

"When I scan tasks, I want to recognize the assigned agent faster, not just read the text name every time."

## Scope

This PRD covers v1 of agent identity emoji support in tasks.

It should:
- show emoji next to assigned agent name where tasks display assignee
- use available identity metadata when possible
- degrade gracefully if no emoji exists

## Functional Requirements

## 1. Display emoji with assigned agent
Wherever a task card or task detail shows the assigned agent, show:
- identity emoji
- agent name

Example:
- `🛠️ Mida`
- `🎛️ main` (or whatever identity mapping is correct)

## 2. Data source
The app should derive the emoji from the agent’s identity data where practical.

Acceptable v1 approaches:
- read agent identity metadata from known agent files
- derive from current live agent data if enriched there
- use a small mapping layer if necessary for v1

## 3. Graceful fallback
If an agent has no known emoji:
- show name only
- do not break layout

## 4. Consistency
The same agent should render consistently across:
- board cards
- task detail dialog
- create/edit task flows if assignee previews are shown

## UX Requirements

- emoji should improve scanning, not dominate the card
- spacing should be clean
- name should still remain readable
- fallback should look intentional

## Definition of Done
This feature is successful when:

1. Assigned agents in tasks show their identity emoji next to their name.
2. The UI remains clean and readable.
3. Agents without emoji degrade gracefully.
4. The same representation is used consistently across task surfaces.

## Suggested Implementation Order

### Phase 1
- define source/mapping for agent identity emoji
- wire it into task rendering

### Phase 2
- apply to task detail surface and any assignee controls/previews

### Phase 3
- polish spacing/consistency

## Deliverable Expectations

When done, report back with:
1. where emoji data comes from
2. where it now appears in the UI
3. fallback behavior
4. commit hash
