# Mission Control Git Workflow

## Goal

Keep `main` stable.
All meaningful work should land through pull requests.

## Rules

1. No direct pushes to `main`.
2. Every agent works on its own branch.
3. Every branch should map to a task or clearly scoped change.
4. Every PR should be reviewed before merge.
5. The author should not self-approve.
6. A task should not move to `done` until the PR is merged (or the change is explicitly abandoned/blocked).

## Branch naming

Use short, scoped branch names:

- `mida/<task-slug>`
- `claude/<task-slug>`
- `main/<task-slug>`
- `fix/<topic>`
- `chore/<topic>`

Examples:
- `mida/task-editing`
- `claude/agent-logs`
- `main/react-query-migration`

## PR flow

1. Pick up a Mission Control task.
2. Move the task to `doing`.
3. Create a branch.
4. Implement the change.
5. Run validation before opening/closing work:
   - `npm run build`
   - `npm run lint` (when available)
   - formatting/verify checks as applicable
6. Open a PR against `main`.
7. Request review.
8. Address feedback.
9. Merge only after approval.
10. Update the task with a final `result` comment and move it to `done`.

## Review standard

A review should check:
- scope matches task/PRD
- no obvious regressions
- UI/UX stays coherent
- build/validation passes
- no unnecessary debt or random changes

## Mission Control task linkage

Every meaningful PR should reference the related Mission Control task in the description if possible.

## Preferred merge behavior

- squash merge for most feature branches
- keep history readable
- avoid noisy commit chains in `main`
