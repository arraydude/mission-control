/**
 * Mission Control — Deterministic Task Dispatcher v2
 *
 * Reacts to task mutations (create, status change, assignment change, etc.)
 * and dispatches eligible tasks to agents. Enforces max 1 active task per agent.
 * When an agent becomes free, the next eligible task is dispatched automatically.
 *
 * This module is imported by vite.config.ts and wired into the API layer.
 */
import { execFile } from 'node:child_process'
import * as db from './db.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const KNOWN_AGENTS = new Set(['main', 'mida', 'claude-code'])
const MAX_RETRY_BACKOFF_MS = 5 * 60 * 1000 // 5 min backoff after errors
const LOCK_STALE_MS = 60_000 // 60s stale lock threshold

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DispatchOutcome = {
  taskId: string
  taskTitle: string
  agent: string
  result: 'dispatched' | 'agent_busy' | 'unknown_agent' | 'already_dispatched' | 'lock_failed' | 'error'
  error?: string
  timestamp: number
}

export type DispatcherStatus = {
  enabled: boolean
  lastEvalAt: number | null
  lastOutcomes: DispatchOutcome[]
  knownAgents: string[]
  agentOccupancy: Array<{ agentId: string; busy: boolean; activeTaskId: string | null; activeTaskTitle: string | null }>
  queue: Array<{
    taskId: string; title: string; assignedAgent: string; priority: string;
    waitReason: string; actionableVersion: number; lastDispatchedVersion: number;
    dispatchAttempts: number; lastDispatchError: string | null; readySince: number | null
  }>
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _enabled = false
let _lastEvalAt: number | null = null
let _lastOutcomes: DispatchOutcome[] = []
let _evalPending = false // debounce flag

// ---------------------------------------------------------------------------
// Core dispatch logic
// ---------------------------------------------------------------------------

function dispatchToAgent(agentId: string, task: db.MissionTask): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const message = [
      `[Mission Control Dispatch] Task: "${task.title}" (id: ${task.id}, priority: ${task.priority})`,
      '',
      'Description:',
      task.description,
      '',
      'Instructions: Pick up this task. Change status from ready → doing when you start. Use the task-status script when done.',
    ].join('\n')

    execFile('openclaw', ['agent', '--agent', agentId, '-m', message, '--json'], {
      encoding: 'utf8',
      timeout: 120_000,
    }, (error) => {
      if (error) {
        resolve({ ok: false, error: error.message.slice(0, 200) })
      } else {
        resolve({ ok: true })
      }
    })
  })
}

function notifyBlocker(message: string) {
  execFile('openclaw', ['system', 'event', '--text', message, '--mode', 'now'], {
    encoding: 'utf8',
    timeout: 15_000,
  }, () => { /* fire-and-forget */ })
}

/**
 * Run a full dispatch evaluation cycle.
 * Returns outcomes for all tasks evaluated.
 */
async function evaluateAndDispatch(): Promise<DispatchOutcome[]> {
  const now = Date.now()
  const outcomes: DispatchOutcome[] = []

  // 1. Handle unroutable tasks — surface warnings
  const unroutable = db.getUnroutableTasks(KNOWN_AGENTS)
  for (const task of unroutable) {
    const error = `Unknown agent "${task.assignedAgent}" assigned to task "${task.title}"`
    outcomes.push({ taskId: task.id, taskTitle: task.title, agent: task.assignedAgent!, result: 'unknown_agent', error, timestamp: now })

    // Only notify if this is a new error (not already recorded)
    const prevError = task.dispatch?.lastDispatchError
    if (prevError !== error) {
      db.recordDispatchV2(task.id, task.assignedAgent!, 'unknown_agent', { error })
      notifyBlocker(`Mission Control Dispatcher: ${error}`)
    }
  }

  // 2. Get eligible tasks (ready, version not yet dispatched, no lock, no active run)
  const eligible = db.getDispatchEligibleTasks(KNOWN_AGENTS)

  // 3. Group by agent and pick the highest-priority task per agent
  const bestPerAgent = new Map<string, db.MissionTask>()
  for (const task of eligible) {
    const agent = task.assignedAgent!
    if (!bestPerAgent.has(agent)) {
      bestPerAgent.set(agent, task) // Already sorted by priority/readySince
    }
  }

  // 4. Dispatch one task per available agent
  for (const [agent, task] of bestPerAgent) {
    // Check agent occupancy
    if (db.isAgentOccupied(agent)) {
      outcomes.push({ taskId: task.id, taskTitle: task.title, agent, result: 'agent_busy', timestamp: now })
      continue
    }

    // Check backoff for repeated failures
    if (task.dispatch && task.dispatch.dispatchAttempts > 0 && task.dispatch.lastDispatchedAt) {
      const backoff = Math.min(task.dispatch.dispatchAttempts * 30_000, MAX_RETRY_BACKOFF_MS)
      if (now - task.dispatch.lastDispatchedAt < backoff) {
        continue // Still in backoff window
      }
    }

    // Acquire lock
    if (!db.acquireDispatchLock(task.id)) {
      outcomes.push({ taskId: task.id, taskTitle: task.title, agent, result: 'lock_failed', timestamp: now })
      continue
    }

    // Dispatch
    console.log(`[dispatcher-v2] Dispatching "${task.title}" → ${agent}`)
    const result = await dispatchToAgent(agent, task)

    if (result.ok) {
      db.recordDispatchV2(task.id, agent, 'dispatched')
      outcomes.push({ taskId: task.id, taskTitle: task.title, agent, result: 'dispatched', timestamp: now })
      console.log(`[dispatcher-v2] ✓ Dispatched "${task.title}" → ${agent}`)
    } else {
      const error = result.error ?? 'Dispatch failed'
      db.recordDispatchV2(task.id, agent, 'error', { error })
      outcomes.push({ taskId: task.id, taskTitle: task.title, agent, result: 'error', error, timestamp: now })
      console.log(`[dispatcher-v2] ✗ Failed "${task.title}" → ${agent}: ${error}`)

      // Only notify on persistent failures (3+ attempts)
      const task2 = db.getTask(task.id)
      if (task2?.dispatch && task2.dispatch.dispatchAttempts >= 3) {
        notifyBlocker(`Mission Control: Persistent dispatch failure for "${task.title}" → ${agent} (${task2.dispatch.dispatchAttempts} attempts)`)
      }
    }
  }

  _lastEvalAt = now
  _lastOutcomes = outcomes
  return outcomes
}

// ---------------------------------------------------------------------------
// Public API — called by vite.config.ts API handlers
// ---------------------------------------------------------------------------

/**
 * Called when a task is created. Triggers dispatch evaluation if the task
 * is actionable (status=ready, agent assigned).
 */
export function onTaskCreated(task: db.MissionTask): void {
  if (!_enabled) return
  if (task.status === 'ready' && task.assignedAgent) {
    scheduleEvaluation()
  }
}

/**
 * Called when a task is patched. Determines whether the mutation changes
 * actionability and triggers dispatch evaluation if so.
 */
export function onTaskPatched(
  taskId: string,
  patch: db.MissionTaskPatch,
  previousTask: db.MissionTask,
  updatedTask: db.MissionTask
): void {
  if (!_enabled) return

  const statusChanged = patch.status !== undefined && patch.status !== previousTask.status
  const agentChanged = patch.assignedAgent !== undefined && updatedTask.assignedAgent !== previousTask.assignedAgent
  const priorityChanged = patch.priority !== undefined && patch.priority !== previousTask.priority
  const descriptionChanged = patch.description !== undefined && patch.description.trim() !== previousTask.description.trim()

  // Case 1: Task becomes ready (actionable)
  if (updatedTask.status === 'ready' && (statusChanged || agentChanged)) {
    scheduleEvaluation()
    return
  }

  // Case 2: Task leaves 'doing' → agent freed → evaluate next task
  if (statusChanged && previousTask.status === 'doing') {
    scheduleEvaluation()
    return
  }

  // Case 3: Priority or description changed while task is ready
  if (updatedTask.status === 'ready' && (priorityChanged || descriptionChanged)) {
    scheduleEvaluation()
    return
  }

  // Case 4: Agent changed while task is ready
  if (updatedTask.status === 'ready' && agentChanged) {
    scheduleEvaluation()
    return
  }
}

/**
 * Called when a task is claimed by an agent (status goes to 'doing').
 * No dispatch needed, but we note the agent is now busy.
 */
export function onTaskClaimed(_task: db.MissionTask): void {
  // Agent is now busy — no action needed since we check occupancy at dispatch time
}

/**
 * Schedule a dispatch evaluation. Debounced to avoid multiple evaluations
 * from rapid successive mutations.
 */
function scheduleEvaluation(): void {
  if (_evalPending) return
  _evalPending = true

  // Use setImmediate-like delay to batch rapid mutations
  setTimeout(() => {
    _evalPending = false
    void evaluateAndDispatch().catch((err) => {
      console.error('[dispatcher-v2] Evaluation error:', err)
    })
  }, 100)
}

/**
 * Manually trigger a dispatch evaluation (e.g., from API).
 */
export async function triggerEvaluation(): Promise<DispatchOutcome[]> {
  return evaluateAndDispatch()
}

/**
 * Enable the dispatcher. Called on server start if configured.
 */
export function enable(): void {
  _enabled = true
  console.log('[dispatcher-v2] Enabled — will react to task mutations')
  // Run initial evaluation after a short delay
  setTimeout(() => {
    void evaluateAndDispatch().catch((err) => {
      console.error('[dispatcher-v2] Initial evaluation error:', err)
    })
  }, 2_000)
}

/**
 * Disable the dispatcher.
 */
export function disable(): void {
  _enabled = false
  _evalPending = false
  console.log('[dispatcher-v2] Disabled')
}

/**
 * Check if the dispatcher is enabled.
 */
export function isEnabled(): boolean {
  return _enabled
}

/**
 * Get the current dispatcher status for the API.
 */
export function getStatus(): DispatcherStatus {
  return {
    enabled: _enabled,
    lastEvalAt: _lastEvalAt,
    lastOutcomes: _lastOutcomes,
    knownAgents: [...KNOWN_AGENTS],
    agentOccupancy: db.getAgentOccupancy(KNOWN_AGENTS),
    queue: db.getDispatchQueueStatus(KNOWN_AGENTS),
  }
}
