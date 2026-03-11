#!/usr/bin/env node
/**
 * Mission Control Task Dispatcher v2 (standalone)
 *
 * Deterministic dispatcher: evaluates dispatch eligibility using actionable
 * versioning, enforces max 1 active task per agent, and advances the queue
 * when agents become free.
 *
 * Usage:
 *   node scripts/dispatcher.mjs              # single evaluation
 *   node scripts/dispatcher.mjs --watch      # poll every 60s
 */
import path from 'node:path'
import { execFile } from 'node:child_process'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const DB_PATH = path.join(ROOT, 'data', 'mission-control.db')
const KNOWN_AGENTS = new Set(['main', 'mida'])
const INTERVAL_MS = 60 * 1000 // 1 min
const MAX_DISPATCH_ATTEMPTS = 5
const MAX_RETRY_BACKOFF_MS = 5 * 60 * 1000
const STALE_LOCK_MS = 60_000

function getDb() {
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Ensure v2 columns exist
  for (const col of [
    'ALTER TABLE tasks ADD COLUMN actionableVersion INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN lastDispatchedVersion INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN dispatchLock INTEGER',
    'ALTER TABLE tasks ADD COLUMN activeRunId TEXT',
    'ALTER TABLE tasks ADD COLUMN readySince INTEGER',
  ]) {
    try { db.exec(col) } catch { /* column already exists */ }
  }

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

const IN_FLIGHT_STALE_MS = 5 * 60 * 1000

function isAgentOccupied(db, agentId) {
  const now = Date.now()
  const row = db.prepare(`
    SELECT COUNT(*) as c FROM tasks
    WHERE assignedAgent = ? AND (
      status = 'doing'
      OR (status = 'ready' AND lastDispatchedVersion >= actionableVersion AND lastDispatchedAt > ?)
    )
  `).get(agentId, now - IN_FLIGHT_STALE_MS)
  return row.c > 0
}

async function run() {
  const now = Date.now()
  const db = getDb()
  let dispatched = 0

  // 1. Handle unroutable tasks
  const unroutableTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE status = 'ready' AND assignedAgent IS NOT NULL
      AND actionableVersion > lastDispatchedVersion
  `).all().filter((t) => !KNOWN_AGENTS.has(t.assignedAgent))

  for (const task of unroutableTasks) {
    const error = `Unknown agent "${task.assignedAgent}" assigned to task "${task.title}"`
    console.log(`[unroutable] ${error}`)

    if (task.lastDispatchError !== error) {
      db.prepare('UPDATE tasks SET lastDispatchError = ?, dispatchAttempts = dispatchAttempts + 1, lastDispatchedAt = ? WHERE id = ?')
        .run(error, now, task.id)
      db.prepare('INSERT INTO task_dispatch_events (id, taskId, agentId, eventType, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), task.id, task.assignedAgent, 'unknown_agent', error, now)
      notifyBlocker(`Mission Control Dispatcher: ${error}`)
    }
  }

  // 2. Get eligible tasks
  const eligibleTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE status = 'ready'
      AND assignedAgent IS NOT NULL
      AND actionableVersion > lastDispatchedVersion
      AND (dispatchLock IS NULL OR dispatchLock < ?)
      AND activeRunId IS NULL
    ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END ASC,
      COALESCE(readySince, createdAt) ASC,
      id ASC
  `).all(now - STALE_LOCK_MS).filter((t) => KNOWN_AGENTS.has(t.assignedAgent))

  // 3. Pick best task per agent
  const bestPerAgent = new Map()
  for (const task of eligibleTasks) {
    if (!bestPerAgent.has(task.assignedAgent)) {
      bestPerAgent.set(task.assignedAgent, task)
    }
  }

  // 4. Dispatch
  for (const [agent, task] of bestPerAgent) {
    if (isAgentOccupied(db, agent)) {
      console.log(`[busy] ${agent} is occupied — skipping "${task.title}"`)
      continue
    }

    // Circuit breaker
    if (task.dispatchAttempts >= MAX_DISPATCH_ATTEMPTS) {
      console.log(`[blocked] "${task.title}" → ${agent} (${task.dispatchAttempts} attempts)`)
      db.prepare(`UPDATE tasks SET status = 'blocked', updatedAt = ?, lastDispatchError = ? WHERE id = ?`)
        .run(now, `Blocked after ${task.dispatchAttempts} failed dispatch attempts`, task.id)
      continue
    }

    // Backoff
    if (task.dispatchAttempts > 0 && task.lastDispatchedAt) {
      const backoff = Math.min(task.dispatchAttempts * 30_000, MAX_RETRY_BACKOFF_MS)
      if (now - task.lastDispatchedAt < backoff) {
        console.log(`[backoff] "${task.title}" → ${agent} (attempt ${task.dispatchAttempts}, waiting)`)
        continue
      }
    }

    // Acquire lock
    const lockResult = db.prepare(`
      UPDATE tasks SET dispatchLock = ? WHERE id = ? AND (dispatchLock IS NULL OR dispatchLock < ?)
    `).run(now, task.id, now - STALE_LOCK_MS)

    if (lockResult.changes === 0) {
      console.log(`[locked] "${task.title}" — dispatch lock held`)
      continue
    }

    console.log(`[dispatch] "${task.title}" → ${agent}`)
    const result = await dispatch(agent, task)

    if (result.ok) {
      db.prepare(`
        UPDATE tasks SET updatedAt = ?,
          lastDispatchedAt = ?, dispatchAttempts = dispatchAttempts + 1, lastDispatchError = NULL,
          dispatchLock = NULL, lastDispatchedVersion = actionableVersion, activeRunId = NULL
        WHERE id = ?
      `).run(now, now, task.id)
      db.prepare('INSERT INTO task_comments (id, taskId, author, type, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), task.id, 'system', 'system', `Task dispatched to ${agent} (v${task.actionableVersion})`, now)
      db.prepare('INSERT INTO task_dispatch_events (id, taskId, agentId, eventType, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), task.id, agent, 'dispatched', null, now)
      dispatched++
      console.log(`  ✓ dispatched`)
    } else {
      const error = result.error ?? 'Dispatch failed'
      const newAttempts = (task.dispatchAttempts ?? 0) + 1

      if (newAttempts >= MAX_DISPATCH_ATTEMPTS) {
        db.prepare(`UPDATE tasks SET status = 'blocked', updatedAt = ?, dispatchAttempts = ?, lastDispatchError = ?, lastDispatchedAt = ?, dispatchLock = NULL WHERE id = ?`)
          .run(now, newAttempts, `Blocked after ${newAttempts} failed attempts: ${error}`, now, task.id)
      } else {
        db.prepare(`UPDATE tasks SET dispatchAttempts = ?, lastDispatchError = ?, lastDispatchedAt = ?, dispatchLock = NULL WHERE id = ?`)
          .run(newAttempts, error, now, task.id)
      }
      db.prepare('INSERT INTO task_dispatch_events (id, taskId, agentId, eventType, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), task.id, agent, 'error', error, now)
      console.log(`  ✗ error: ${error}`)

      if (newAttempts >= 3) {
        notifyBlocker(`Mission Control: Persistent dispatch failure for "${task.title}" → ${agent} (${newAttempts} attempts)`)
      }
    }
  }

  db.close()

  // Summary
  const totalReady = eligibleTasks.length + unroutableTasks.length
  console.log(`[done] ${totalReady} ready, ${dispatched} dispatched`)
}

// Main
const watch = process.argv.includes('--watch')

if (watch) {
  console.log(`[dispatcher-v2] Watch mode — polling every ${INTERVAL_MS / 1000}s`)
  const tick = async () => {
    try { await run() } catch (err) { console.error('[error]', err.message) }
  }
  await tick()
  setInterval(tick, INTERVAL_MS)
} else {
  await run()
}
