# Task Editing PRD

## Product

Mission Control — Task Editing

## Context

Mission Control already supports:
- task creation
- task status changes
- agent assignment
- task comments/progress direction
- task board workflow

However, once a task exists, editing is still too limited.

To make the task board truly operational, Emiliano needs to be able to modify tasks after creation without awkward workarounds.

## Core Goal

Allow tasks in Mission Control to be edited cleanly and directly from the UI.

## Why this matters

This improves:
- accuracy of task definitions
- flexibility as work evolves
- trust in the board as a live operational surface
- reduced friction when refining tasks
- less stale task metadata

Without editing, tasks decay.
With editing, the board remains usable as work changes.

## Product Principle

Editing should feel simple, direct, and safe.
This is not a complex form-builder.
It is a clean operational task editor.

## User

Primary:
- Emiliano

Secondary:
- agents using Mission Control as an execution board

## Job To Be Done

"When a task changes, I want to quickly edit it in Mission Control so the board reflects reality instead of outdated intent."

## Scope

This PRD covers v1 of task editing.

It should support editing core task properties.
It should NOT become a full workflow customizer.

## Functional Requirements

## 1. Editable task fields
At minimum, Mission Control should support editing these fields for an existing task:
- title
- description / notes
- priority
- status
- assigned agent

If comments already exist, comments are separate from task editing and do not need to be merged into the same form unless it is natural.

## 2. Editing surface
Task editing should happen in a clear dedicated interaction.

Preferred UX:
- task detail dialog that supports editing
- or edit mode inside the dialog

The important point is:
- editing should feel more intentional than inline chaos
- the user should clearly know when they are changing task properties

## 3. Persistence
Edits must persist in the same local task storage used by Mission Control.

## 4. Updated timestamp
Whenever a task is edited, `updatedAt` should refresh.

## 5. Board coherence
After editing:
- the board should reflect changes immediately
- lane movement should stay correct if status changes
- assignee display should update immediately

## UX Requirements

## Readability
Editing should not make the board itself messy.
The board should remain optimized for scanning.

## Confidence
The user should feel confident that edits were saved.

V1 acceptable options:
- explicit save button
- small success feedback
- dialog closes after save if appropriate

## Safety
Avoid accidental destructive edits.
Editing should be deliberate.

## Definition of Done
This feature is successful when:

1. Existing tasks can be edited from the UI.
2. Core fields (title, notes, priority, status, assigned agent) are editable.
3. Changes persist locally.
4. `updatedAt` updates correctly.
5. The board reflects the updated task immediately.
6. The editing experience feels clear and intentional.

## Suggested Implementation Order

### Phase 1
- extend local API to support task updates for editable fields
- ensure persistence and `updatedAt`

### Phase 2
- add editing surface in the task detail flow
- support editing core fields

### Phase 3
- polish save/cancel behavior
- add lightweight success feedback if needed

## Nice-to-have later (not required now)
- partial autosave
- field-level edit history
- task duplication
- archive/delete

## Deliverable Expectations

When done, report back with:
1. what fields are editable now
2. what UI pattern was chosen
3. how save/update works
4. commit hash
