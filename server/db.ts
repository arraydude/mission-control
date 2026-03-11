/**
 * Mission Control — SQLite database layer
 *
 * Source of truth for tasks, comments, and dispatch events.
 * Replaces the previous JSON-file-based state management.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Types (shared with vite.config.ts)
// ---------------------------------------------------------------------------

export type MissionTaskStatus = 'inbox' | 'ready' | 'doing' | 'blocked' | 'done'
export type MissionTaskPriority = 'low' | 'medium' | 'high'
export type TaskCommentType = 'progress' | 'blocker' | 'decision' | 'result' | 'system'

export type ClaimMeta = {
  claimedBy: string | null
  claimedAt: number | null
}

export type MissionTask = {
  id: string
  title: string
  description: string
  priority: MissionTaskPriority
  status: MissionTaskStatus
  assignedAgent: string | null
  resultSummary: string | null
  createdAt: number
  updatedAt: number
  comments: TaskComment[]
  claim: ClaimMeta
  dispatch?: DispatchMeta
}

export type TaskComment = {
  id: string
  author: string
  type: TaskCommentType
  createdAt: number
  text: string
}

export type DispatchMeta = {
  lastDispatchedAt: number | null
  dispatchAttempts: number
  lastDispatchError: string | null
  actionableVersion: number
  lastDispatchedVersion: number
  dispatchLock: number | null
  activeRunId: string | null
  readySince: number | null
}

export type DispatchEvent = {
  id: string
  taskId: string
  agentId: string
  eventType: string
  message: string | null
  createdAt: number
}

export type MissionTaskPatch = Partial<Pick<MissionTask, 'title' | 'description' | 'priority' | 'status' | 'assignedAgent' | 'resultSummary'>>

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TASK_STATUSES = new Set<MissionTaskStatus>(['inbox', 'ready', 'doing', 'blocked', 'done'])
const TASK_PRIORITIES = new Set<MissionTaskPriority>(['low', 'medium', 'high'])
const COMMENT_TYPES = new Set<TaskCommentType>(['progress', 'blocker', 'decision', 'result', 'system'])
const MAX_DISPATCH_ATTEMPTS = 5
const IN_FLIGHT_STALE_MS = 5 * 60 * 1000 // 5 min — in-flight dispatches older than this are considered stale

const DB_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DB_DIR, 'mission-control.db')
const JSON_PATH = path.join(DB_DIR, 'mission-control-tasks.json')

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  priority        TEXT NOT NULL DEFAULT 'medium'  CHECK(priority IN ('low','medium','high')),
  status          TEXT NOT NULL DEFAULT 'inbox'   CHECK(status IN ('inbox','ready','doing','blocked','done')),
  assignedAgent   TEXT,
  claimedBy       TEXT,
  claimedAt       INTEGER,
  resultSummary   TEXT,
  createdAt       INTEGER NOT NULL,
  updatedAt       INTEGER NOT NULL,
  lastDispatchedAt  INTEGER,
  dispatchAttempts  INTEGER NOT NULL DEFAULT 0,
  lastDispatchError TEXT
);

CREATE TABLE IF NOT EXISTS task_comments (
  id        TEXT PRIMARY KEY,
  taskId    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author    TEXT NOT NULL,
  type      TEXT NOT NULL CHECK(type IN ('progress','blocker','decision','result','system')),
  text      TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_taskId ON task_comments(taskId);

CREATE TABLE IF NOT EXISTS task_dispatch_events (
  id        TEXT PRIMARY KEY,
  taskId    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agentId   TEXT NOT NULL,
  eventType TEXT NOT NULL,
  message   TEXT,
  createdAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dispatch_events_taskId ON task_dispatch_events(taskId);
`

// ---------------------------------------------------------------------------
// Database singleton
// ---------------------------------------------------------------------------

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  fs.mkdirSync(DB_DIR, { recursive: true })
  _db = new Database(DB_PATH)

  // Enable WAL mode for better concurrent read/write
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')

  // Create tables
  _db.exec(SCHEMA_SQL)

  // Add columns introduced by state-hardening (safe to re-run — IF NOT EXISTS semantics via try/catch)
  for (const col of [
    'ALTER TABLE tasks ADD COLUMN claimedBy TEXT',
    'ALTER TABLE tasks ADD COLUMN claimedAt INTEGER',
    'ALTER TABLE tasks ADD COLUMN resultSummary TEXT',
    // Dispatcher v2 columns
    'ALTER TABLE tasks ADD COLUMN actionableVersion INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN lastDispatchedVersion INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN dispatchLock INTEGER',
    'ALTER TABLE tasks ADD COLUMN activeRunId TEXT',
    'ALTER TABLE tasks ADD COLUMN readySince INTEGER',
  ]) {
    try { _db.exec(col) } catch { /* column already exists */ }
  }

  // Widen comment type CHECK constraint for existing DBs (SQLite doesn't support ALTER CHECK,
  // but the new schema handles it for fresh DBs; existing rows with old types remain valid)

  // Migrate from JSON if DB is empty and JSON exists
  const count = _db.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number }
  if (count.c === 0 && fs.existsSync(JSON_PATH)) {
    migrateFromJson(_db)
  }

  return _db
}

export function closeDb() {
  if (_db) {
    _db.close()
    _db = null
  }
}

// ---------------------------------------------------------------------------
// JSON migration
// ---------------------------------------------------------------------------

type JsonTask = {
  id: string
  title: string
  description?: string
  priority?: string
  status?: string
  assignedAgent?: string | null
  createdAt?: number
  updatedAt?: number
  comments?: Array<{
    id: string
    author: string
    type: string
    text: string
    createdAt: number
  }>
  dispatch?: {
    lastDispatchedAt?: number | null
    dispatchAttempts?: number
    lastDispatchError?: string | null
  }
}

function migrateFromJson(db: Database.Database) {
  try {
    const raw = fs.readFileSync(JSON_PATH, 'utf8')
    const parsed = JSON.parse(raw) as { tasks?: JsonTask[] }
    const tasks = parsed.tasks ?? []

    if (tasks.length === 0) return

    console.log(`[db] Migrating ${tasks.length} tasks from JSON to SQLite...`)

    const insertTask = db.prepare(`
      INSERT OR IGNORE INTO tasks (id, title, description, priority, status, assignedAgent, createdAt, updatedAt, lastDispatchedAt, dispatchAttempts, lastDispatchError)
      VALUES (@id, @title, @description, @priority, @status, @assignedAgent, @createdAt, @updatedAt, @lastDispatchedAt, @dispatchAttempts, @lastDispatchError)
    `)

    const insertComment = db.prepare(`
      INSERT OR IGNORE INTO task_comments (id, taskId, author, type, text, createdAt)
      VALUES (@id, @taskId, @author, @type, @text, @createdAt)
    `)

    const migrate = db.transaction(() => {
      for (const task of tasks) {
        if (!task.id || !task.title) continue

        const now = Date.now()
        insertTask.run({
          id: task.id,
          title: task.title.trim(),
          description: (task.description ?? '').trim(),
          priority: TASK_PRIORITIES.has(task.priority as MissionTaskPriority) ? task.priority : 'medium',
          status: TASK_STATUSES.has(task.status as MissionTaskStatus) ? task.status : 'inbox',
          assignedAgent: task.assignedAgent?.trim() || null,
          createdAt: task.createdAt ?? now,
          updatedAt: task.updatedAt ?? now,
          lastDispatchedAt: task.dispatch?.lastDispatchedAt ?? null,
          dispatchAttempts: task.dispatch?.dispatchAttempts ?? 0,
          lastDispatchError: task.dispatch?.lastDispatchError ?? null,
        })

        if (Array.isArray(task.comments)) {
          for (const comment of task.comments) {
            if (!comment.id || !comment.author || !comment.text) continue
            insertComment.run({
              id: comment.id,
              taskId: task.id,
              author: comment.author.trim(),
              type: COMMENT_TYPES.has(comment.type as TaskCommentType) ? comment.type : 'progress',
              text: comment.text.trim(),
              createdAt: comment.createdAt ?? now,
            })
          }
        }
      }
    })

    migrate()
    console.log(`[db] Migration complete — ${tasks.length} tasks imported.`)

    // Rename old JSON file as backup
    const backupPath = JSON_PATH.replace('.json', '.json.bak')
    fs.renameSync(JSON_PATH, backupPath)
    console.log(`[db] JSON file backed up to ${backupPath}`)
  } catch (err) {
    console.error('[db] JSON migration failed:', err instanceof Error ? err.message : err)
  }
}

// ---------------------------------------------------------------------------
// DAO — Tasks
// ---------------------------------------------------------------------------

type TaskRow = {
  id: string
  title: string
  description: string
  priority: string
  status: string
  assignedAgent: string | null
  claimedBy: string | null
  claimedAt: number | null
  resultSummary: string | null
  createdAt: number
  updatedAt: number
  lastDispatchedAt: number | null
  dispatchAttempts: number
  lastDispatchError: string | null
  actionableVersion: number
  lastDispatchedVersion: number
  dispatchLock: number | null
  activeRunId: string | null
  readySince: number | null
}

function rowToTask(row: TaskRow, comments: TaskComment[]): MissionTask {
  const task: MissionTask = {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority as MissionTaskPriority,
    status: row.status as MissionTaskStatus,
    assignedAgent: row.assignedAgent,
    resultSummary: row.resultSummary ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    comments,
    claim: {
      claimedBy: row.claimedBy ?? null,
      claimedAt: row.claimedAt ?? null,
    },
  }

  task.dispatch = {
    lastDispatchedAt: row.lastDispatchedAt,
    dispatchAttempts: row.dispatchAttempts,
    lastDispatchError: row.lastDispatchError,
    actionableVersion: row.actionableVersion ?? 0,
    lastDispatchedVersion: row.lastDispatchedVersion ?? 0,
    dispatchLock: row.dispatchLock ?? null,
    activeRunId: row.activeRunId ?? null,
    readySince: row.readySince ?? null,
  }

  return task
}

export function listTasks(): MissionTask[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM tasks ORDER BY updatedAt DESC').all() as TaskRow[]
  const commentStmt = db.prepare('SELECT * FROM task_comments WHERE taskId = ? ORDER BY createdAt ASC')

  return rows.map((row) => {
    const comments = commentStmt.all(row.id) as Array<{
      id: string; taskId: string; author: string; type: string; text: string; createdAt: number
    }>
    return rowToTask(row, comments.map((c) => ({
      id: c.id,
      author: c.author,
      type: c.type as TaskCommentType,
      text: c.text,
      createdAt: c.createdAt,
    })))
  })
}

export function getTask(taskId: string): MissionTask | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined
  if (!row) return null

  const comments = db.prepare('SELECT * FROM task_comments WHERE taskId = ? ORDER BY createdAt ASC').all(taskId) as Array<{
    id: string; taskId: string; author: string; type: string; text: string; createdAt: number
  }>

  return rowToTask(row, comments.map((c) => ({
    id: c.id,
    author: c.author,
    type: c.type as TaskCommentType,
    text: c.text,
    createdAt: c.createdAt,
  })))
}

export function createTask(input: Partial<MissionTask>): MissionTask {
  const db = getDb()
  const now = Date.now()
  const title = input.title?.trim()

  if (!title) throw new Error('Task title is required.')

  const id = randomUUID()
  const priority = TASK_PRIORITIES.has(input.priority as MissionTaskPriority) ? input.priority! : 'medium'
  const status = TASK_STATUSES.has(input.status as MissionTaskStatus) ? input.status! : 'inbox'
  const assignedAgent = input.assignedAgent?.trim() || null
  const description = input.description?.trim() ?? ''

  const isActionable = status === 'ready' && assignedAgent !== null
  const actionableVersion = isActionable ? 1 : 0
  const readySince = status === 'ready' ? now : null

  db.prepare(`
    INSERT INTO tasks (id, title, description, priority, status, assignedAgent, createdAt, updatedAt, actionableVersion, readySince)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, description, priority, status, assignedAgent, now, now, actionableVersion, readySince)

  return {
    id,
    title,
    description,
    priority: priority as MissionTaskPriority,
    status: status as MissionTaskStatus,
    assignedAgent,
    resultSummary: null,
    createdAt: now,
    updatedAt: now,
    comments: [],
    claim: {
      claimedBy: null,
      claimedAt: null,
    },
    dispatch: {
      lastDispatchedAt: null,
      dispatchAttempts: 0,
      lastDispatchError: null,
      actionableVersion,
      lastDispatchedVersion: 0,
      dispatchLock: null,
      activeRunId: null,
      readySince,
    },
  }
}

export function patchTask(taskId: string, patch: MissionTaskPatch): MissionTask {
  const db = getDb()
  const existing = getTask(taskId)
  if (!existing) throw new Error('Task not found.')

  const updates: string[] = []
  const params: Record<string, unknown> = { id: taskId }

  if (typeof patch.title === 'string') {
    const value = patch.title.trim()
    if (!value) throw new Error('Task title cannot be empty.')
    updates.push('title = @title')
    params.title = value
  }

  if (typeof patch.description === 'string') {
    updates.push('description = @description')
    params.description = patch.description.trim()
  }

  if (typeof patch.priority === 'string') {
    if (!TASK_PRIORITIES.has(patch.priority as MissionTaskPriority)) throw new Error('Invalid task priority.')
    updates.push('priority = @priority')
    params.priority = patch.priority
  }

  if (typeof patch.status === 'string') {
    if (!TASK_STATUSES.has(patch.status as MissionTaskStatus)) throw new Error('Invalid task status.')
    updates.push('status = @status')
    params.status = patch.status
  }

  if (patch.assignedAgent !== undefined) {
    updates.push('assignedAgent = @assignedAgent')
    params.assignedAgent = typeof patch.assignedAgent === 'string' && patch.assignedAgent.trim() ? patch.assignedAgent.trim() : null
  }

  if (typeof patch.resultSummary === 'string') {
    updates.push('resultSummary = @resultSummary')
    params.resultSummary = patch.resultSummary.trim() || null
  }

  if (updates.length > 0) {
    const now = Date.now()
    updates.push('updatedAt = @updatedAt')
    params.updatedAt = now

    // Determine the effective status/agent after patch
    const newStatus = (patch.status as string) ?? existing.status
    const newAgent = patch.assignedAgent !== undefined
      ? (typeof patch.assignedAgent === 'string' && patch.assignedAgent.trim() ? patch.assignedAgent.trim() : null)
      : existing.assignedAgent

    // Bump actionableVersion when actionability-changing fields mutate while task is/becomes ready
    const statusChanged = typeof patch.status === 'string' && patch.status !== existing.status
    const agentChanged = patch.assignedAgent !== undefined && newAgent !== existing.assignedAgent
    const priorityChanged = typeof patch.priority === 'string' && patch.priority !== existing.priority
    const descriptionChanged = typeof patch.description === 'string' && patch.description.trim() !== existing.description.trim()

    const becomesReady = newStatus === 'ready'
    const wasReady = existing.status === 'ready'

    const shouldBumpVersion =
      (statusChanged && becomesReady) ||                    // enters ready
      (becomesReady && agentChanged) ||                     // agent changed while ready
      (wasReady && becomesReady && priorityChanged) ||      // priority changed while ready
      (wasReady && becomesReady && descriptionChanged)      // description changed while ready

    if (shouldBumpVersion) {
      updates.push('actionableVersion = actionableVersion + 1')
    }

    // Set readySince when task enters ready, clear when it leaves
    if (statusChanged && becomesReady) {
      updates.push('readySince = @readySince')
      params.readySince = now
    } else if (statusChanged && !becomesReady) {
      updates.push('readySince = NULL')
    }

    // Clear dispatch lock and activeRunId when task leaves doing
    if (statusChanged && existing.status === 'doing') {
      updates.push('dispatchLock = NULL')
      updates.push('activeRunId = NULL')
    }

    // Reset dispatch metadata when task re-enters ready (fresh dispatch cycle)
    if (statusChanged && becomesReady && !wasReady) {
      updates.push('dispatchAttempts = 0')
      updates.push('lastDispatchError = NULL')
    }

    const doUpdate = db.transaction(() => {
      db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = @id`).run(params)

      // Auto-record status transitions as system comments
      if (typeof patch.status === 'string' && patch.status !== existing.status) {
        const actor = patch.assignedAgent ?? existing.assignedAgent ?? 'operator'
        db.prepare('INSERT INTO task_comments (id, taskId, author, type, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
          randomUUID(), taskId, 'system', 'system', `Status changed: ${existing.status} → ${patch.status} (by ${actor})`, now
        )
      }

      // Clear claim when moving back to inbox/ready (task is being un-claimed)
      if (typeof patch.status === 'string' && (patch.status === 'inbox' || patch.status === 'ready')) {
        db.prepare('UPDATE tasks SET claimedBy = NULL, claimedAt = NULL WHERE id = ?').run(taskId)
      }
    })

    doUpdate()
  }

  return getTask(taskId)!
}

// ---------------------------------------------------------------------------
// DAO — Claim
// ---------------------------------------------------------------------------

/**
 * Atomically claim a task. Sets claimedBy/claimedAt and transitions status to 'doing'.
 * Fails if the task is already claimed or not in a claimable state (ready).
 */
export function claimTask(taskId: string, agentId: string): MissionTask {
  const db = getDb()
  const now = Date.now()

  const run = db.transaction(() => {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined
    if (!row) throw new Error('Task not found.')
    if (row.status !== 'ready') throw new Error(`Cannot claim task in "${row.status}" status — must be "ready".`)
    if (row.claimedBy) throw new Error(`Task already claimed by "${row.claimedBy}".`)

    db.prepare(`
      UPDATE tasks SET status = 'doing', claimedBy = ?, claimedAt = ?, assignedAgent = ?, updatedAt = ?
      WHERE id = ?
    `).run(agentId, now, agentId, now, taskId)

    db.prepare('INSERT INTO task_comments (id, taskId, author, type, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
      randomUUID(), taskId, 'system', 'system', `Task claimed by ${agentId}`, now
    )
  })

  run()
  return getTask(taskId)!
}

/**
 * Release a claim without changing status back (e.g. for manual unclaim).
 */
export function releaseTaskClaim(taskId: string): void {
  const db = getDb()
  const now = Date.now()
  db.prepare('UPDATE tasks SET claimedBy = NULL, claimedAt = NULL, updatedAt = ? WHERE id = ?').run(now, taskId)
}

// ---------------------------------------------------------------------------
// DAO — Comments
// ---------------------------------------------------------------------------

export function listComments(taskId: string): TaskComment[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM task_comments WHERE taskId = ? ORDER BY createdAt ASC').all(taskId) as Array<{
    id: string; taskId: string; author: string; type: string; text: string; createdAt: number
  }>
  return rows.map((c) => ({
    id: c.id,
    author: c.author,
    type: c.type as TaskCommentType,
    text: c.text,
    createdAt: c.createdAt,
  }))
}

export function addComment(taskId: string, input: { author?: string; type?: string; text?: string }): TaskComment {
  const db = getDb()

  // Verify task exists
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId) as { id: string } | undefined
  if (!task) throw new Error('Task not found.')

  const author = input.author?.trim()
  const type = input.type as TaskCommentType | undefined
  const text = input.text?.trim()

  if (!author) throw new Error('Comment author is required.')
  if (!type || !COMMENT_TYPES.has(type)) throw new Error(`Comment type must be one of: ${[...COMMENT_TYPES].join(', ')}`)
  if (!text) throw new Error('Comment text is required.')

  const id = randomUUID()
  const now = Date.now()

  const insert = db.transaction(() => {
    db.prepare('INSERT INTO task_comments (id, taskId, author, type, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(id, taskId, author, type, text, now)
    db.prepare('UPDATE tasks SET updatedAt = ? WHERE id = ?').run(now, taskId)
  })

  insert()

  return { id, author, type, text, createdAt: now }
}

// ---------------------------------------------------------------------------
// DAO — Dispatch
// ---------------------------------------------------------------------------

export function recordDispatchEvent(taskId: string, agentId: string, eventType: string, message?: string): DispatchEvent {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()

  db.prepare('INSERT INTO task_dispatch_events (id, taskId, agentId, eventType, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, taskId, agentId, eventType, message ?? null, now
  )

  return { id, taskId, agentId, eventType, message: message ?? null, createdAt: now }
}

export function listDispatchEvents(taskId: string): DispatchEvent[] {
  const db = getDb()
  return db.prepare('SELECT * FROM task_dispatch_events WHERE taskId = ? ORDER BY createdAt DESC').all(taskId) as DispatchEvent[]
}

export function updateDispatchMeta(taskId: string, meta: Partial<DispatchMeta>) {
  const db = getDb()
  const updates: string[] = []
  const params: Record<string, unknown> = { id: taskId }

  if (meta.lastDispatchedAt !== undefined) {
    updates.push('lastDispatchedAt = @lastDispatchedAt')
    params.lastDispatchedAt = meta.lastDispatchedAt
  }
  if (meta.dispatchAttempts !== undefined) {
    updates.push('dispatchAttempts = @dispatchAttempts')
    params.dispatchAttempts = meta.dispatchAttempts
  }
  if (meta.lastDispatchError !== undefined) {
    updates.push('lastDispatchError = @lastDispatchError')
    params.lastDispatchError = meta.lastDispatchError
  }

  if (updates.length > 0) {
    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = @id`).run(params)
  }
}

/**
 * Combined dispatch update: update task status + dispatch metadata + record event, all in one transaction.
 */
export function recordDispatch(
  taskId: string,
  agentId: string,
  outcome: 'dispatched' | 'error' | 'unknown_agent',
  error?: string
) {
  const db = getDb()
  const now = Date.now()

  const run = db.transaction(() => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined
    if (!task) return

    if (outcome === 'dispatched') {
      // Transition ready → doing, update dispatch meta + set claim
      db.prepare(`
        UPDATE tasks SET status = 'doing', claimedBy = ?, claimedAt = ?, updatedAt = ?, lastDispatchedAt = ?, dispatchAttempts = dispatchAttempts + 1, lastDispatchError = NULL
        WHERE id = ?
      `).run(agentId, now, now, now, taskId)

      // Record claim as system comment
      db.prepare('INSERT INTO task_comments (id, taskId, author, type, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(), taskId, 'system', 'system', `Task dispatched and claimed by ${agentId}`, now
      )
    } else {
      const newAttempts = (task.dispatchAttempts ?? 0) + 1
      // Update dispatch meta with error — MUST set lastDispatchedAt so cooldown applies
      if (newAttempts >= MAX_DISPATCH_ATTEMPTS) {
        // Circuit breaker: move to blocked after too many failures
        db.prepare(`
          UPDATE tasks SET status = 'blocked', updatedAt = ?, dispatchAttempts = ?, lastDispatchError = ?, lastDispatchedAt = ?
          WHERE id = ?
        `).run(now, newAttempts, `Blocked after ${newAttempts} failed dispatch attempts: ${error ?? outcome}`, now, taskId)
      } else {
        db.prepare(`
          UPDATE tasks SET dispatchAttempts = ?, lastDispatchError = ?, lastDispatchedAt = ?
          WHERE id = ?
        `).run(newAttempts, error ?? `Dispatch ${outcome}`, now, taskId)
      }
    }

    // Record event
    db.prepare('INSERT INTO task_dispatch_events (id, taskId, agentId, eventType, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
      randomUUID(), taskId, agentId, outcome, error ?? null, now
    )
  })

  run()
}

// ---------------------------------------------------------------------------
// Helper: get ready tasks for dispatch
// ---------------------------------------------------------------------------

export function getReadyTasksForDispatch(cooldownMs: number): MissionTask[] {
  const db = getDb()
  const now = Date.now()
  const cutoff = now - cooldownMs

  const rows = db.prepare(`
    SELECT * FROM tasks
    WHERE status = 'ready' AND assignedAgent IS NOT NULL
      AND (lastDispatchedAt IS NULL OR lastDispatchedAt < ?)
  `).all(cutoff) as TaskRow[]

  return rows.map((row) => {
    const comments = db.prepare('SELECT * FROM task_comments WHERE taskId = ? ORDER BY createdAt ASC').all(row.id) as Array<{
      id: string; taskId: string; author: string; type: string; text: string; createdAt: number
    }>
    return rowToTask(row, comments.map((c) => ({
      id: c.id,
      author: c.author,
      type: c.type as TaskCommentType,
      text: c.text,
      createdAt: c.createdAt,
    })))
  })
}

// ---------------------------------------------------------------------------
// Dispatcher v2 — Eligibility, occupancy, locking
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

/**
 * Check if an agent is currently occupied.
 * An agent is occupied if it has a task in 'doing' status OR has an in-flight
 * dispatch (task dispatched but not yet claimed by the agent).
 */
export function isAgentOccupied(agentId: string): boolean {
  const db = getDb()
  const now = Date.now()
  const row = db.prepare(`
    SELECT COUNT(*) as c FROM tasks
    WHERE assignedAgent = ? AND (
      status = 'doing'
      OR (status = 'ready' AND lastDispatchedVersion >= actionableVersion AND lastDispatchedAt > ?)
    )
  `).get(agentId, now - IN_FLIGHT_STALE_MS) as { c: number }
  return row.c > 0
}

/**
 * Get all tasks actively being worked by an agent (status = 'doing').
 */
export function getActiveTasksForAgent(agentId: string): MissionTask[] {
  const db = getDb()
  const rows = db.prepare(`SELECT * FROM tasks WHERE assignedAgent = ? AND status = 'doing'`).all(agentId) as TaskRow[]
  return rows.map((row) => rowToTask(row, []))
}

/**
 * Get dispatch-eligible tasks: ready, assigned, agent is known,
 * actionableVersion > lastDispatchedVersion, no active dispatch lock, no active run.
 * Ordered by priority (high first), then readySince (oldest first), then id.
 */
export function getDispatchEligibleTasks(knownAgents: Set<string>): MissionTask[] {
  const db = getDb()
  const rows = db.prepare(`
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
  `).all(Date.now() - 60000) as TaskRow[] // Stale lock threshold: 60s

  return rows
    .filter((row) => knownAgents.has(row.assignedAgent!))
    .map((row) => rowToTask(row, []))
}

/**
 * Get tasks assigned to unknown/unroutable agents.
 */
export function getUnroutableTasks(knownAgents: Set<string>): MissionTask[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT * FROM tasks
    WHERE status = 'ready'
      AND assignedAgent IS NOT NULL
      AND actionableVersion > lastDispatchedVersion
  `).all() as TaskRow[]

  return rows
    .filter((row) => !knownAgents.has(row.assignedAgent!))
    .map((row) => rowToTask(row, []))
}

/**
 * Acquire a dispatch lock for a task. Returns true if lock acquired.
 */
export function acquireDispatchLock(taskId: string): boolean {
  const db = getDb()
  const now = Date.now()
  const result = db.prepare(`
    UPDATE tasks SET dispatchLock = ?
    WHERE id = ? AND (dispatchLock IS NULL OR dispatchLock < ?)
  `).run(now, taskId, now - 60000) // 60s stale lock threshold
  return result.changes > 0
}

/**
 * Release dispatch lock for a task.
 */
export function releaseDispatchLock(taskId: string): void {
  const db = getDb()
  db.prepare('UPDATE tasks SET dispatchLock = NULL WHERE id = ?').run(taskId)
}

/**
 * Record a dispatch outcome (v2): persist dispatch metadata without changing task status.
 */
export function recordDispatchV2(
  taskId: string,
  agentId: string,
  outcome: 'dispatched' | 'error' | 'unknown_agent',
  opts?: { error?: string; runId?: string }
) {
  const db = getDb()
  const now = Date.now()

  const run = db.transaction(() => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined
    if (!task) return

    if (outcome === 'dispatched') {
      // Record dispatch metadata only — the agent is responsible for
      // transitioning ready → doing when it actually claims the task.
      db.prepare(`
        UPDATE tasks
        SET updatedAt = ?,
            lastDispatchedAt = ?, dispatchAttempts = dispatchAttempts + 1,
            lastDispatchError = NULL, dispatchLock = NULL,
            lastDispatchedVersion = actionableVersion,
            activeRunId = ?
        WHERE id = ?
      `).run(now, now, opts?.runId ?? null, taskId)

      db.prepare('INSERT INTO task_comments (id, taskId, author, type, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(), taskId, 'system', 'system', `Task dispatched to ${agentId} (v${task.actionableVersion})`, now
      )
    } else {
      const newAttempts = (task.dispatchAttempts ?? 0) + 1
      const errorMsg = opts?.error ?? `Dispatch ${outcome}`

      if (newAttempts >= MAX_DISPATCH_ATTEMPTS) {
        db.prepare(`
          UPDATE tasks SET status = 'blocked', updatedAt = ?, dispatchAttempts = ?,
            lastDispatchError = ?, lastDispatchedAt = ?, dispatchLock = NULL
          WHERE id = ?
        `).run(now, newAttempts, `Blocked after ${newAttempts} failed attempts: ${errorMsg}`, now, taskId)
      } else {
        db.prepare(`
          UPDATE tasks SET dispatchAttempts = ?, lastDispatchError = ?,
            lastDispatchedAt = ?, dispatchLock = NULL
          WHERE id = ?
        `).run(newAttempts, errorMsg, now, taskId)
      }
    }

    db.prepare('INSERT INTO task_dispatch_events (id, taskId, agentId, eventType, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
      randomUUID(), taskId, agentId, outcome, opts?.error ?? null, now
    )
  })

  run()
}

/**
 * Get agent availability summary for all known agents.
 */
export function getAgentOccupancy(knownAgents: Set<string>): Array<{ agentId: string; busy: boolean; activeTaskId: string | null; activeTaskTitle: string | null }> {
  const db = getDb()
  const now = Date.now()
  return [...knownAgents].map((agentId) => {
    // Check for tasks actively being worked
    const active = db.prepare(`
      SELECT id, title FROM tasks WHERE assignedAgent = ? AND status = 'doing' LIMIT 1
    `).get(agentId) as { id: string; title: string } | undefined

    if (active) {
      return { agentId, busy: true, activeTaskId: active.id, activeTaskTitle: active.title }
    }

    // Check for in-flight dispatches (dispatched but not yet claimed)
    const inFlight = db.prepare(`
      SELECT id, title FROM tasks
      WHERE assignedAgent = ? AND status = 'ready'
        AND lastDispatchedVersion >= actionableVersion AND lastDispatchedAt > ?
      LIMIT 1
    `).get(agentId, now - IN_FLIGHT_STALE_MS) as { id: string; title: string } | undefined

    return {
      agentId,
      busy: !!inFlight,
      activeTaskId: inFlight?.id ?? null,
      activeTaskTitle: inFlight?.title ?? null,
    }
  })
}

/**
 * Get dispatch queue status: tasks waiting to be dispatched and why they're waiting.
 */
export function getDispatchQueueStatus(knownAgents: Set<string>): Array<{
  taskId: string; title: string; assignedAgent: string; priority: string;
  waitReason: string; actionableVersion: number; lastDispatchedVersion: number;
  dispatchAttempts: number; lastDispatchError: string | null; readySince: number | null
}> {
  const db = getDb()
  const rows = db.prepare(`
    SELECT * FROM tasks WHERE status = 'ready' AND assignedAgent IS NOT NULL
    ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END ASC,
      COALESCE(readySince, createdAt) ASC
  `).all() as TaskRow[]

  return rows.map((row) => {
    let waitReason = 'eligible'
    if (!knownAgents.has(row.assignedAgent!)) {
      waitReason = `unknown agent: ${row.assignedAgent}`
    } else if (row.actionableVersion <= row.lastDispatchedVersion) {
      waitReason = 'dispatched — awaiting agent claim'
    } else if (row.dispatchLock && row.dispatchLock > Date.now() - 60000) {
      waitReason = 'dispatch in progress (locked)'
    } else if (row.activeRunId) {
      waitReason = `active run: ${row.activeRunId}`
    } else if (isAgentOccupied(row.assignedAgent!)) {
      waitReason = `agent ${row.assignedAgent} is busy`
    }

    return {
      taskId: row.id,
      title: row.title,
      assignedAgent: row.assignedAgent!,
      priority: row.priority,
      waitReason,
      actionableVersion: row.actionableVersion,
      lastDispatchedVersion: row.lastDispatchedVersion,
      dispatchAttempts: row.dispatchAttempts,
      lastDispatchError: row.lastDispatchError,
      readySince: row.readySince,
    }
  })
}
