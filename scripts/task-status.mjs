#!/usr/bin/env node
/**
 * Mission Control Task Status Changer (SQLite-backed)
 *
 * Usage:
 *   node scripts/task-status.mjs --agent <name> --from <status> --to <status> [--id <taskId>] [--contains <text>] [--comment <text>] [--comment-type <type>]
 *
 * Comment types: progress, blocker, decision, result
 */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const DB_PATH = path.join(ROOT, 'data', 'mission-control.db')
const COMMENT_TYPES = new Set(['progress', 'blocker', 'decision', 'result'])

function usage() {
  console.error(`Usage:
  node scripts/task-status.mjs --agent <name> --from <status> --to <status> [--id <taskId>] [--contains <text>] [--comment <text>] [--comment-type <type>]

Comment types: progress, blocker, decision, result

Examples:
  node scripts/task-status.mjs --agent main --from ready --to doing
  node scripts/task-status.mjs --agent mida --id 123 --to blocked --comment "Needs API endpoint" --comment-type blocker
  node scripts/task-status.mjs --agent main --from doing --to done --comment "Completed successfully" --comment-type result
`)
  process.exit(1)
}

const args = process.argv.slice(2)
const getArg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const agent = getArg('--agent')
const from = getArg('--from')
const to = getArg('--to')
const id = getArg('--id')
const contains = getArg('--contains')
const comment = getArg('--comment')
const commentType = getArg('--comment-type') || 'progress'

if (!agent || !to) usage()

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const taskColumns = new Set(
  db.prepare("PRAGMA table_info(tasks)").all().map((column) => String(column.name))
)
const hasClaimColumns = taskColumns.has('claimedBy') && taskColumns.has('claimedAt')

// Build query
let sql = 'SELECT * FROM tasks WHERE assignedAgent = ?'
const params = [agent]

if (id) {
  sql += ' AND id = ?'
  params.push(id)
}
if (from) {
  sql += ' AND status = ?'
  params.push(from.toLowerCase())
}

sql += ' ORDER BY updatedAt DESC'

let candidates = db.prepare(sql).all(...params)

if (contains) {
  const q = contains.toLowerCase()
  candidates = candidates.filter((t) => `${t.title || ''} ${t.description || ''}`.toLowerCase().includes(q))
}

const task = candidates[0]
if (!task) {
  console.error('No matching task found')
  db.close()
  process.exit(3)
}

const now = Date.now()

const update = db.transaction(() => {
  db.prepare('UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?').run(to, now, task.id)

  // Clear claim when moving back to inbox/ready when claim columns exist.
  if (hasClaimColumns && (to === 'inbox' || to === 'ready')) {
    db.prepare('UPDATE tasks SET claimedBy = NULL, claimedAt = NULL WHERE id = ?').run(task.id)
  }

  if (comment) {
    const type = COMMENT_TYPES.has(commentType) ? commentType : 'progress'
    db.prepare('INSERT INTO task_comments (id, taskId, author, type, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
      randomUUID(), task.id, agent, type, comment, now
    )
  }

  // Auto transition comment. Use "progress" instead of "system" because some migrated DBs
  // still have the older CHECK constraint that only allows progress/blocker/decision/result.
  db.prepare('INSERT INTO task_comments (id, taskId, author, type, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
    randomUUID(), task.id, 'system', 'progress', `Status changed: ${task.status} → ${to} (by ${agent})`, now
  )
})

update()
db.close()

console.log(JSON.stringify({
  ok: true,
  id: task.id,
  title: task.title,
  agent,
  from: from || null,
  to,
  comment: comment || null,
  commentType: comment ? commentType : null,
  updatedAt: now,
}, null, 2))
