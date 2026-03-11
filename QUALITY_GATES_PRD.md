# Quality Gates PRD

## Product

Mission Control — Lint, Prettier, and Pre-Completion Validation

## Context

Mission Control is now evolving quickly through multiple contributors and agents.
That speed is useful, but it increases the risk of:
- style drift
- avoidable regressions
- broken builds
- tasks being marked done even though the project is not healthy

The product needs a lightweight, explicit quality gate.

## Core Goal

Add basic project quality standards and make them part of agent workflow.

This includes:
1. linting
2. formatting
3. required validation before an agent closes a task

## Product Principle

The quality system should be practical, not oppressive.
It should help agents ship safely without turning Mission Control into a ceremony-heavy project.

## Scope

This PRD covers:
- lint setup for Mission Control
- prettier setup for Mission Control
- documented workflow expectation that agents validate build/health before closing a task

## Non-Goals

Do NOT build now:
- a giant CI system
- overcomplicated repo-wide monorepo tooling
- heavy pre-commit pipelines if they become annoying
- perfectionist style bikeshedding

## Functional Requirements

## 1. Lint support
Mission Control should have a working lint command.

Expected result:
- developers/agents can run a single command to check code quality
- major obvious issues are caught before completion

Acceptable command shape:
- `npm run lint`

## 2. Prettier support
Mission Control should have a working formatting setup.

Expected result:
- consistent formatting across files
- simple formatting command

Acceptable command shape:
- `npm run format`
- optionally `npm run format:check`

## 3. Documented validation workflow
Agents working on Mission Control should validate project health before closing a task.

Minimum expected validation before closing a task:
- build succeeds
- no relevant lint errors remain
- formatting is applied or checked

## 4. Agent completion rule
Agents should not mark a task as `done` unless they have performed the relevant validation for the scope of their change.

### Default validation rule
Before setting task status to `done`, the agent should ensure:
- `npm run build` passes
- `npm run lint` passes (or known acceptable exceptions are documented)
- formatting is applied / checked

If validation fails:
- the task should not be closed as done
- the agent should either:
  - fix the issue
  - or set the task to `blocked` with a comment explaining the failure

## UX / Workflow Requirements

## 1. Agent clarity
This should be clearly documented so agents do not need to guess what “done” means.

## 2. Lightweight commands
The quality commands should be short and obvious.

## 3. Reliability over ceremony
The point is:
- protect the product
- reduce regressions
- increase trust

Not:
- force unnecessary process

## Suggested Deliverables

### Project/tooling
- lint config if missing or incomplete
- prettier config if missing or incomplete
- package.json scripts for lint/format/checks

### Documentation
A short section in Mission Control docs/README describing the required validation workflow.

### Optional helper
If useful, a single command such as:
- `npm run verify`
that runs the core quality gates

## Definition of Done
This PRD is successful when:

1. Mission Control has usable lint support.
2. Mission Control has usable prettier support.
3. Agents have a documented rule to validate before closing a task.
4. The project is easier to keep healthy as multiple agents change it.

## Suggested Implementation Order

### Phase 1
- inspect current linting situation
- add/fix `npm run lint`

### Phase 2
- add prettier config + scripts

### Phase 3
- add combined validation/verify command if it improves workflow

### Phase 4
- update docs so agents know the completion rule

## Deliverable Expectations

When done, report back with:
1. what lint setup exists now
2. what prettier setup exists now
3. what scripts were added/changed
4. how agents should validate before closing tasks
5. commit hash
