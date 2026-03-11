#!/usr/bin/env node
/**
 * Mission Control Task Helper CLI (SQLite-backed)
 *
 * Lightweight helper for agent/automation task operations against SQLite.
 *
 * Commands:
 *   list [--status <status>] [--agent <name>]     List tasks
 *   get <taskId>                                   Get task details
 *   claim <taskId> --agent <name>                  Claim a task (set assignee + status to doing)
 *   status <taskId> --to <status>                  Set task status
 *   comment <taskId> --agent <name> --text <text> [--type <type>]  Add comment
 *   complete <taskId> --agent <name> [--comment <text>]            Complete task (set done + optional comment)
 *   events <taskId>                                List dispatch events
 */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const DB_PATH = path.join(ROOT, 'data', 'mission-control.db')
const COMMENT_TYPES = new Set(['progress', 'blocker', 'decision', 'result'])

function getDb() {
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

const args = process.argv.slice(2)
const command = args[0]

function getArg(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function json(obj) {
  console.log(JSON.stringify(obj, null, 2))
}

function die(msg) {
  console.error(msg)
  process.exit(1)
}

function usage() {
  console.error(`Usage: node scripts/task-helper.mjs <command> [options]

Commands:
  list [--status <status>] [--agent <name>]     List tasks
  get <taskId>                                   Get task with comments
  claim <taskId> --agent <name>                  Claim task (assign + set doing)
  status <taskId> --to <status>                  Set task status
  comment <taskId> --agent <name> --text <text> [--type <type>]  Add comment
  complete <taskId> --agent <name> [--comment <text>]            Mark done + optional comment
  events <taskId>                                List dispatch events
`)
  process.exit(1)
}

if (!command) usage()

const db = getDb()
const now = Date.now()

try {
  switch (command) {
    case 'list': {
      let sql = 'SELECT * FROM tasks'
      const conditions = []
      const params = []
      const status = getArg('--status')
      const agent = getArg('--agent')

      if (status) { conditions.push('status = ?'); params.push(status) }
      if (agent) { conditions.push('assignedAgent = ?'); params.push(agent) }

      if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`
      sql += ' ORDER BY updatedAt DESC'

      const tasks = db.prepare(sql).all(...params)
      json({ count: tasks.length, tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, assignedAgent: t.assignedAgent })) })
      break
    }

    case 'get': {
      const taskId = args[1]
      if (!taskId) die('Usage: task-helper.mjs get <taskId>')
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)
      if (!task) die('Task not found')
      const comments = db.prepare('SELECT * FROM task_comments WHERE taskId = ? ORDER BY createdAt ASC').all(taskId)
      json({ ...task, comments })
      break
    }

    case 'claim': {
      const taskId = args[1]
      const agent = getArg('--agent')
      if (!taskId || !agent) die('Usage: task-helper.mjs claim <taskId> --agent <name>')
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)
      if (!task) die('Task not found')
      if (task.status !== 'ready') die(`Cannot claim task in "${task.status}" status — must be "ready"`)
      if (task.claimedBy) die(`Task already claimed by "${task.claimedBy}"`)
      db.transaction(() => {
        db.prepare('UPDATE tasks SET assignedAgent = ?, status = ?, claimedBy = ?, claimedAt = ?, updatedAt = ? WHERE id = ?').run(agent, 'doing', agent, now, now, taskId)
        db.prepare('INSERT INTO task_comments (id, taskId, author, type, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
          randomUUID(), taskId, 'system', 'system', `Task claimed by ${agent}`, now
        )
      })()
      json({ ok: true, id: taskId, agent, status: 'doing', claimedBy: agent, claimedAt: now })
      break
    }

    case 'status': {
      const taskId = args[1]
      const to = getArg('--to')
      if (!taskId || !to) die('Usage: task-helper.mjs status <taskId> --to <status>')
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)
      if (!task) die('Task not found')
      db.prepare('UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?').run(to, now, taskId)
      json({ ok: true, id: taskId, from: task.status, to })
      break
    }

    case 'comment': {
      const taskId = args[1]
      const agent = getArg('--agent')
      const text = getArg('--text')
      const type = getArg('--type') || 'progress'
      if (!taskId || !agent || !text) die('Usage: task-helper.mjs comment <taskId> --agent <name> --text <text> [--type <type>]')
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)
      if (!task) die('Task not found')
      const commentType = COMMENT_TYPES.has(type) ? type : 'progress'
      const id = randomUUID()
      db.transaction(() => {
        db.prepare('INSERT INTO task_comments (id, taskId, author, type, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(id, taskId, agent, commentType, text, now)
        db.prepare('UPDATE tasks SET updatedAt = ? WHERE id = ?').run(now, taskId)
      })()
      json({ ok: true, commentId: id, taskId, agent, type: commentType })
      break
    }

    case 'complete': {
      const taskId = args[1]
      const agent = getArg('--agent')
      const commentText = getArg('--comment')
      const resultSummary = getArg('--result')
      if (!taskId || !agent) die('Usage: task-helper.mjs complete <taskId> --agent <name> [--comment <text>] [--result <summary>]')
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)
      if (!task) die('Task not found')
      db.transaction(() => {
        const resultCol = resultSummary ? ', resultSummary = ?' : ''
        const params = resultSummary
          ? ['done', now, resultSummary, taskId]
          : ['done', now, taskId]
        db.prepare(`UPDATE tasks SET status = ?, updatedAt = ?${resultCol} WHERE id = ?`).run(...params)
        if (commentText) {
          db.prepare('INSERT INTO task_comments (id, taskId, author, type, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
            randomUUID(), taskId, agent, 'result', commentText, now
          )
        }
        // Auto system comment for completion
        db.prepare('INSERT INTO task_comments (id, taskId, author, type, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
          randomUUID(), taskId, 'system', 'system', `Task completed by ${agent}${resultSummary ? `: ${resultSummary}` : ''}`, now
        )
      })()
      json({ ok: true, id: taskId, agent, status: 'done', resultSummary: resultSummary || null })
      break
    }

    case 'events': {
      const taskId = args[1]
      if (!taskId) die('Usage: task-helper.mjs events <taskId>')
      const events = db.prepare('SELECT * FROM task_dispatch_events WHERE taskId = ? ORDER BY createdAt DESC').all(taskId)
      json({ count: events.length, events })
      break
    }

    default:
      usage()
  }
} finally {
  db.close()
}
