# Agent Task Check Rule

## Purpose

Define the operational rule that each agent should periodically check Mission Control for tasks assigned to it and act on them.

## Rule

Every agent should check the Mission Control task board every hour for tasks assigned to that agent.

## Expected behavior

For a given agent:

1. Read the Mission Control task board.
2. Find tasks where `assignedAgent` matches the agent.
3. Focus on actionable tasks first.
4. If an assigned task is actionable and the agent begins work, update the task status to `doing` and add a `progress` comment.
5. If a task cannot proceed, update the task status to `blocked`, add a `blocker` comment, and report the blocker.
6. If the task is completed, update the task status to `done` and add a `result` comment with the final summary.
7. During meaningful progress, agents should keep leaving concise `progress` comments so the task shows the execution trail.
8. Keep task state aligned with reality, not with intention.

## Status interpretation

- `inbox`: not yet triaged; only take if clearly the next action for that agent
- `ready`: should be picked up by the assigned agent
- `doing`: continue execution or report current progress
- `blocked`: do not improvise; surface the blocker clearly
- `done`: no action required

## Initial rollout

Start with these agents:
- `main`
- `mida`

Expand later to future agents once their responsibilities are stable.

## Delivery principle

These hourly checks should be quiet by default.
Agents should only announce something outward when there is:
- concrete progress
- a concrete blocker
- a meaningful status change

## Source of truth

Task data source:
- `mida/apps/mission-control/data/mission-control.db`

Agents should prefer Mission Control's SQLite-backed local data layer and helper scripts rather than any legacy JSON file assumptions.
