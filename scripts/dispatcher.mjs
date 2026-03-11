#!/usr/bin/env node
/**
 * Mission Control Task Dispatcher (standalone)
 *
 * Reads ready tasks from SQLite, dispatches them to assigned agents via
 * `openclaw agent`, and records dispatch events/metadata in the DB.
 *
 * Usage:
 *   node scripts/dispatcher.mjs              # single run
 *   node scripts/dispatcher.mjs --watch      # loop every 60s
 */
import path from 'node:path'
import { execFile } from 'node:child_process'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const DB_PATH = path.join(ROOT, 'data', 'mission-control.db')
const KNOWN_AGENTS = new Set(['main', 'mida'])
const COOLDOWN_MS = 30 * 60 * 1000 // 30 min
const INTERVAL_MS = 60 * 1000 // 1 min
const MAX_DISPATCH_ATTEMPTS = 5

function getDb() {
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

function dispatch(agentId, task) {
  return new Promise((resolve) => {
    const message = `[Mission Control Dispatch] Task: "${task.title}" (id: ${task.id}, priority: ${task.priority})\n\nDescription:\n${task.description}\n\nInstructions: Pick up this task. Change status from ready → doing when you start. Use the task-status script when done.`

    execFile('openclaw', ['agent', '--agent', agentId, '-m', message, '--json'], {
      encoding: 'utf8',
      timeout: 120_000,
    }, (error) => {
      if (error) resolve({ ok: false, error: error.message.slice(0, 200) })
      else resolve({ ok: true })
    })
  })
}

function notifyBlocker(message) {
  execFile('openclaw', ['system', 'event', '--text', message, '--mode', 'now'], {
    encoding: 'utf8',
    timeout: 15_000,
  }, () => {})
}

async function run() {
  const now = Date.now()
  const cutoff = now - COOLDOWN_MS
  const db = getDb()

  const readyTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE status = 'ready' AND assignedAgent IS NOT NULL
  `).all()

  let dispatched = 0

  for (const task of readyTasks) {
    const agent = task.assignedAgent

    if (!KNOWN_AGENTS.has(agent)) {
      const error = `Unknown agent "${agent}" assigned to task "${task.title}"`
      console.log(`[skip] ${error}`)

      db.prepare('UPDATE tasks SET lastDispatchError = ? WHERE id = ?').run(error, task.id)
      db.prepare('INSERT INTO task_dispatch_events (id, taskId, agentId, eventType, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(), task.id, agent, 'unknown_agent', error, now
      )
      notifyBlocker(`⚠️ Mission Control Dispatcher: ${error}`)
      continue
    }

    // Check max attempts — circuit breaker
    if (task.dispatchAttempts >= MAX_DISPATCH_ATTEMPTS) {
      console.log(`[blocked] "${task.title}" → ${agent} (${task.dispatchAttempts} attempts, moving to blocked)`)
      db.prepare(`UPDATE tasks SET status = 'blocked', updatedAt = ?, lastDispatchError = ? WHERE id = ?`)
        .run(now, `Blocked after ${task.dispatchAttempts} failed dispatch attempts`, task.id)
      continue
    }

    // Check cooldown
    if (task.lastDispatchedAt && task.lastDispatchedAt > cutoff) {
      console.log(`[cooldown] "${task.title}" → ${agent} (dispatched ${Math.round((now - task.lastDispatchedAt) / 60000)}m ago)`)
      continue
    }

    console.log(`[dispatch] "${task.title}" → ${agent}`)
    const result = await dispatch(agent, task)

    if (result.ok) {
      db.prepare(`
        UPDATE tasks SET status = 'doing', updatedAt = ?, lastDispatchedAt = ?, dispatchAttempts = dispatchAttempts + 1, lastDispatchError = NULL
        WHERE id = ?
      `).run(now, now, task.id)
      db.prepare('INSERT INTO task_dispatch_events (id, taskId, agentId, eventType, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(), task.id, agent, 'dispatched', null, now
      )
      dispatched++
      console.log(`  ✓ dispatched`)
    } else {
      const error = result.error ?? 'Dispatch failed'
      db.prepare(`
        UPDATE tasks SET dispatchAttempts = dispatchAttempts + 1, lastDispatchError = ?, lastDispatchedAt = ? WHERE id = ?
      `).run(error, now, task.id)
      db.prepare('INSERT INTO task_dispatch_events (id, taskId, agentId, eventType, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(), task.id, agent, 'error', error, now
      )
      console.log(`  ✗ error: ${error}`)
      notifyBlocker(`⚠️ Mission Control Dispatcher: Failed to dispatch "${task.title}" to ${agent}: ${error?.slice(0, 100)}`)
    }
  }

  db.close()
  console.log(`[done] ${readyTasks.length} ready, ${dispatched} dispatched`)
}

// Main
const watch = process.argv.includes('--watch')

if (watch) {
  console.log(`[dispatcher] Watch mode — polling every ${INTERVAL_MS / 1000}s`)
  const tick = async () => {
    try { await run() } catch (err) { console.error('[error]', err.message) }
  }
  await tick()
  setInterval(tick, INTERVAL_MS)
} else {
  await run()
}
