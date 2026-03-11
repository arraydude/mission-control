# Task Comments PRD

## Product

Mission Control — Task Comments / Progress Log

## Context

Mission Control already supports:
- task creation
- task status changes
- agent assignment
- task board workflow

What is missing is a visible progress trail inside each task.

Right now, status alone is not enough.
We need a lightweight comments/progress system so agents can leave execution traces directly on the task.

## Core Goal

Every task should have a comments section where agents can:
- post progress updates
- report blockers
- record decisions
- leave the final result summary when the task is completed

## Why this matters

This improves:
- transparency
- handoffs
- trust
- async collaboration between agents
- operator visibility for Emiliano

Without comments, the board only shows state.
With comments, the board starts showing the story of execution.

## Product Principle

This is not a chat system.
This is a lightweight execution log attached to each task.

## User

Primary:
- Emiliano

Secondary:
- agents working on tasks

## Jobs To Be Done

### For Emiliano
"When I open a task, I want to quickly see what happened, what progress was made, and how it ended."

### For agents
"When I work on a task, I want to leave a visible trail of progress/blockers/results without editing the whole task body."

## Scope

This PRD covers v1 of task comments.

It should be:
- useful
- lightweight
- persistent
- integrated into the task board

It should NOT become:
- a full threaded chat system
- a Slack replacement
- a complex activity stream platform

## Functional Requirements

## 1. Comments data model
Each task should support a `comments` array.

Each comment should have at least:
- `id`
- `author`
- `type`
- `createdAt`
- `text`

### Allowed comment types
At minimum:
- `progress`
- `blocker`
- `decision`
- `result`

## 2. UI visibility
Each task card or task detail surface should expose comments clearly.

Good acceptable v1 patterns:
- expandable comments area inside card
- task drawer/panel
- accordion detail section

The important thing is that comments are visible and readable without becoming noisy.

## 3. Add comment flow
The UI must allow adding a new comment to a task.

Minimum fields:
- author (or infer from agent/user context if practical)
- type
- text

## 4. Persistence
Comments must persist in the same local task storage used by Mission Control.

## 5. Agent usage expectation
Agents should use comments as part of task execution.

Expected behavior:
- when starting work → add a `progress` comment
- when blocked → add a `blocker` comment
- when making a meaningful choice → optionally add a `decision` comment
- when finishing → add a `result` comment with final summary

## UX Requirements

### Readability
Comments should be easy to scan:
- author visible
- timestamp visible
- type visible
- text readable

### Noise control
Do not overwhelm the board.
The main task board should stay usable.
So comments should likely live behind expansion/detail, not always fully open.

### Tone
This should feel like:
- execution log
- concise progress record
- operational memory

Not like:
- social chat
- giant wall of text

## Suggested V1 UX

### In task card / detail
- comment count visible
- expand/collapse comments
- add comment form in the expanded area

### Rendering
Each comment row should show:
- author
- type badge
- relative or readable timestamp
- body text

## Integration with status changes
Commenting should be complementary to status changes.

Strong product rule:
- task status tells **where it is**
- comments tell **what happened**

## Definition of Done
This feature is successful when:

1. Tasks support persistent comments.
2. A user can add a comment from the UI.
3. Comments are visible in the task experience.
4. Comments support at least the 4 types defined above.
5. The board still feels clean and usable.
6. A completed task can contain a final summary comment.

## Suggested Implementation Order

### Phase 1
- extend task schema with `comments`
- update persistence
- add local API support for comments

### Phase 2
- add comments UI to task surface
- render existing comments
- add comment composer

### Phase 3
- polish readability and empty states
- expose comment count / compact preview

## Nice-to-have later (not required now)
- inline markdown-lite
- filtering comments by type
- richer authorship metadata
- automatic agent comment insertion tied to automation

## Deliverable Expectations

When done, report back with:
1. what changed in the schema
2. what changed in the UI
3. how comments are stored
4. whether agents can realistically use this yet
5. commit hash
