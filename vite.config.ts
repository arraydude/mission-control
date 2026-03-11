import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import * as db from './server/db.js'
import * as dispatcher from './server/dispatcher.js'
import { autoAssignIfMissing } from './server/routing-policy.js'
import * as reviewPolicy from './server/review-policy.js'

type SessionEntry = {
  sessionId?: string
  updatedAt?: number
  sessionFile?: string
  model?: string
  modelProvider?: string
  lastChannel?: string
  channel?: string
  label?: string
  spawnDepth?: number
  deliveryContext?: {
    channel?: string
  }
}

type SessionMap = Record<string, SessionEntry>

type OpenClawAgent = {
  id: string
  workspace?: string
  model?: {
    primary?: string
  }
}

type ChannelConfig = {
  enabled?: boolean
  mode?: string
  dmPolicy?: string
  groupPolicy?: string
}

type OpenClawConfig = {
  agents?: {
    list?: OpenClawAgent[]
  }
  channels?: Record<string, ChannelConfig>
  models?: {
    providers?: Record<string, {
      baseUrl?: string
      models?: Array<{ id: string; name: string; contextWindow?: number }>
    }>
  }
  gateway?: {
    port?: number
    mode?: string
  }
}

type SubagentRun = {
  runId?: string
  childSessionKey?: string
  requesterDisplayKey?: string
  task?: string
  label?: string
  model?: string
  startedAt?: number
  endedAt?: number
  createdAt?: number
  runTimeoutSeconds?: number
  outcome?: { status?: string }
  endedReason?: string
}

type SubagentRuns = {
  runs?: Record<string, SubagentRun>
}

type BlockerSeverity = 'warning' | 'critical' | 'info'

type SessionSnapshot = {
  agentId: string
  sessionKey: string
  sessionId: string
  updatedAt: number
  updatedLabel: string
  channel: string
  model: string
  label: string | null
  sessionFile: string | null
  spawnDepth: number
  isRecent: boolean
}

type AgentSnapshot = {
  id: string
  name: string
  identityEmoji: string | null
  model: string
  workspace: string
  sessionsPath: string
  existsOnDisk: boolean
  hasSessions: boolean
  sessionCount: number
  recentSessionCount: number
  active: boolean
  activeReason: string
  updatedAt: number | null
  updatedLabel: string
  latestSessionId: string | null
  sessions: SessionSnapshot[]
}

// Task types are now imported from server/db.ts
type MissionTask = db.MissionTask
type MissionTaskPatch = db.MissionTaskPatch
type TaskComment = db.TaskComment

const OPENCLAW_HOME = path.join(process.env.HOME ?? '', '.openclaw')
const CLAUDE_HOME = path.join(process.env.HOME ?? '', '.claude')
const API_PATH = '/api/openclaw/state'
const TASKS_API_PATH = '/api/mission-control/tasks'
const ACTIVE_WINDOW_MS = 15 * 60 * 1000
const STALE_WINDOW_MS = 24 * 60 * 60 * 1000
const RECENT_SESSION_LIMIT = 10
const RECENT_BLOCKER_LIMIT = 8
const ACP_RECENT_LIMIT = 15
const ACP_ACTIVE_WINDOW_MS = 5 * 60 * 1000
const DB_PATH = path.join(process.cwd(), 'data', 'mission-control.db')
const AGENT_LOGS_API_PATH = '/api/openclaw/agents'
const AGENT_LOG_LIMIT = 50

const DISPATCHER_API_PATH = '/api/mission-control/dispatcher'
const REVIEWS_API_PATH = '/api/mission-control/reviews'

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')

    try {
      return JSON.parse(raw) as T
    } catch {
      return vm.runInNewContext(`(${raw})`, {}) as T
    }
  } catch {
    return fallback
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function readAgentIdentityEmoji(workspacePath: string): string | null {
  try {
    const identityPath = path.join(workspacePath, 'IDENTITY.md')
    const raw = fs.readFileSync(identityPath, 'utf8')
    const match = raw.match(/^-\s*\*\*Emoji:\*\*\s*(.+?)\s*$/m)
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

function formatRelativeTime(timestamp?: number) {
  if (!timestamp) return 'unknown'

  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (deltaSeconds < 60) return 'just now'

  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ] as const

  for (const [label, size] of units) {
    if (deltaSeconds >= size) {
      const value = Math.floor(deltaSeconds / size)
      return `${value} ${label}${value === 1 ? '' : 's'} ago`
    }
  }

  return `${deltaSeconds} seconds ago`
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function getGatewayStatus() {
  try {
    const output = execFileSync('openclaw', ['gateway', 'status'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })

    const lines = output
      .split('\n')
      .map((line: string) => line.trim())
      .filter(Boolean)

    const extract = (prefix: string) => lines.find((line: string) => line.startsWith(prefix))?.replace(new RegExp(`^${prefix}\\s*`), '') ?? 'unknown'

    return {
      ok: true,
      runtime: extract('Runtime:'),
      service: extract('Service:'),
      listening: extract('Listening:'),
      logs: extract('File logs:'),
      warnings: lines.filter((line: string) => line.startsWith('- ')),
      raw: output,
    }
  } catch (error) {
    return {
      ok: false,
      runtime: 'unavailable',
      service: 'unavailable',
      listening: 'unknown',
      logs: 'unknown',
      warnings: ['Gateway status command failed.'],
      raw: error instanceof Error ? error.message : String(error),
    }
  }
}

function getGatewayLogWarnings(logPathHint?: string) {
  const candidates = uniqueStrings([
    logPathHint ?? '',
    path.join(OPENCLAW_HOME, 'logs', 'gateway.log'),
    '/tmp/openclaw/openclaw-2026-03-09.log',
  ])

  for (const filePath of candidates) {
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const warnings = content
        .split('\n')
        .filter((line: string) => /warning|stale-socket|error|failed|doctor warnings|not loaded|service not installed/i.test(line))
        .slice(-RECENT_BLOCKER_LIMIT)

      return { path: filePath, warnings }
    } catch {
      // continue
    }
  }

  return { path: candidates[0] ?? 'unknown', warnings: [] as string[] }
}

function formatDuration(startMs: number, endMs: number) {
  const seconds = Math.round((endMs - startMs) / 1000)
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}

function truncateTask(task?: string) {
  if (!task) return '(no task description)'
  const firstLine = task.split('\n')[0]
  if (firstLine.length <= 120) return firstLine
  return `${firstLine.slice(0, 117)}...`
}

type AcpRunSnapshot = {
  sessionId: string
  harness: string        // 'claude-code' | 'openclaw-subagent'
  status: 'running' | 'completed' | 'idle'
  task: string
  model: string | null
  workingDirectory: string | null
  project: string | null
  gitBranch: string | null
  version: string | null
  startedAt: number
  startedLabel: string
  lastUpdatedAt: number
  lastUpdatedLabel: string
  elapsed: string
  source: string
}

function getRunningClaudeProcesses(): Map<string, { pid: number; task: string }> {
  const map = new Map<string, { pid: number; task: string }>()
  try {
    const output = execFileSync('ps', ['aux'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 5000 })
    for (const line of output.split('\n')) {
      if (!/\bclaude\b/.test(line) || /grep|chrome-native-host/.test(line)) continue
      const parts = line.trim().split(/\s+/)
      const pid = Number(parts[1])
      if (!pid) continue
      // Extract task from --print argument if present
      const printMatch = line.match(/--print\s+(.+)$/)
      const task = printMatch?.[1]?.split('\n')[0]?.slice(0, 120) ?? ''
      // Try to extract session ID — not always possible from ps, will match via mtime
      map.set(String(pid), { pid, task })
    }
  } catch {
    // ps not available or failed
  }
  return map
}

function detectClaudeCodeSessions(): AcpRunSnapshot[] {
  const projectsDir = path.join(CLAUDE_HOME, 'projects')
  if (!fs.existsSync(projectsDir)) return []

  const runningProcesses = getRunningClaudeProcesses()
  const hasRunningClaude = runningProcesses.size > 0
  const now = Date.now()
  const runs: AcpRunSnapshot[] = []

  let projectDirs: string[]
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }

  for (const projectDir of projectDirs) {
    const projectPath = path.join(projectsDir, projectDir)
    // Project dir name is a path-encoded working directory
    const decodedProject = projectDir.replace(/^-/, '/').replace(/-/g, '/')

    let jsonlFiles: Array<{ name: string; mtime: number; size: number }>
    try {
      jsonlFiles = fs.readdirSync(projectPath)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
          const stat = fs.statSync(path.join(projectPath, f))
          return { name: f, mtime: stat.mtimeMs, size: stat.size }
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, ACP_RECENT_LIMIT)
    } catch {
      continue
    }

    for (const file of jsonlFiles) {
      const sessionId = file.name.replace('.jsonl', '')
      const isRecentlyActive = now - file.mtime < ACP_ACTIVE_WINDOW_MS

      // Only include sessions that are recently active or have a running process
      if (!isRecentlyActive && now - file.mtime > STALE_WINDOW_MS) continue

      // Read first few lines to extract metadata
      let task = '(session)'
      let cwd: string | null = null
      let gitBranch: string | null = null
      let version: string | null = null
      let model: string | null = null
      let startedAt = file.mtime

      try {
        const fd = fs.openSync(path.join(projectPath, file.name), 'r')
        const buf = Buffer.alloc(8192)
        const bytesRead = fs.readSync(fd, buf, 0, 8192, 0)
        fs.closeSync(fd)
        const head = buf.toString('utf8', 0, bytesRead)
        const lines = head.split('\n').filter(Boolean)

        for (const line of lines.slice(0, 10)) {
          try {
            const obj = JSON.parse(line) as Record<string, unknown>

            if (obj.type === 'user' && obj.message) {
              const msg = obj.message as Record<string, unknown>
              const content = typeof msg.content === 'string' ? msg.content : ''
              if (content) task = content.split('\n')[0].slice(0, 120)
              cwd = (obj.cwd as string) ?? null
              gitBranch = (obj.gitBranch as string) ?? null
              version = (obj.version as string) ?? null
              if (obj.timestamp) startedAt = new Date(obj.timestamp as string).getTime() || file.mtime
            }

            if (obj.type === 'queue-operation' && obj.operation === 'enqueue') {
              const content = obj.content as string | undefined
              if (content) task = content.split('\n')[0].slice(0, 120)
              if (obj.timestamp) startedAt = new Date(obj.timestamp as string).getTime() || file.mtime
            }

            if (obj.type === 'assistant' && obj.message) {
              const msg = obj.message as Record<string, unknown>
              if (msg.model && !model) model = msg.model as string
            }
          } catch {
            // skip malformed lines
          }
        }
      } catch {
        // file read failed
      }

      const status: AcpRunSnapshot['status'] = (isRecentlyActive && hasRunningClaude) ? 'running' : isRecentlyActive ? 'idle' : 'completed'

      runs.push({
        sessionId,
        harness: 'claude-code',
        status,
        task: task.length > 120 ? `${task.slice(0, 117)}...` : task,
        model,
        workingDirectory: cwd,
        project: decodedProject,
        gitBranch,
        version,
        startedAt,
        startedLabel: formatRelativeTime(startedAt),
        lastUpdatedAt: file.mtime,
        lastUpdatedLabel: formatRelativeTime(file.mtime),
        elapsed: formatDuration(startedAt, isRecentlyActive ? now : file.mtime),
        source: 'claude-code-sessions',
      })
    }
  }

  return runs.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt).slice(0, ACP_RECENT_LIMIT)
}

function getSubagentRunsSummary(subagentRuns: SubagentRuns) {
  const allRuns = Object.values(subagentRuns.runs ?? {})
  const now = Date.now()

  const active = allRuns
    .filter((run) => !run.endedAt)
    .map((run) => ({
      runId: run.runId ?? 'unknown',
      task: truncateTask(run.task),
      label: run.label ?? null,
      model: run.model ?? 'unknown',
      childSessionKey: run.childSessionKey ?? null,
      requester: run.requesterDisplayKey ?? null,
      startedAt: run.startedAt ?? run.createdAt ?? 0,
      startedLabel: formatRelativeTime(run.startedAt ?? run.createdAt),
      elapsed: run.startedAt ? formatDuration(run.startedAt, now) : 'unknown',
      timeoutSeconds: run.runTimeoutSeconds ?? null,
    }))
    .sort((a, b) => b.startedAt - a.startedAt)

  const recent = allRuns
    .filter((run) => run.endedAt)
    .map((run) => ({
      runId: run.runId ?? 'unknown',
      task: truncateTask(run.task),
      label: run.label ?? null,
      model: run.model ?? 'unknown',
      status: run.outcome?.status ?? 'unknown',
      endedReason: run.endedReason ?? null,
      startedAt: run.startedAt ?? run.createdAt ?? 0,
      endedAt: run.endedAt!,
      endedLabel: formatRelativeTime(run.endedAt),
      duration: run.startedAt && run.endedAt ? formatDuration(run.startedAt, run.endedAt) : 'unknown',
    }))
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, 10)

  return { active, recent }
}

function getModelsConfig(config: OpenClawConfig) {
  const providers = config.models?.providers ?? {}
  return Object.entries(providers).flatMap(([providerName, provider]) =>
    (provider.models ?? []).map((model) => ({
      provider: providerName,
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow ?? null,
    }))
  )
}

function createChannelSnapshots(config: OpenClawConfig) {
  return Object.entries(config.channels ?? {}).map(([id, channel]) => ({
    id,
    enabled: Boolean(channel?.enabled),
    mode: channel?.mode ?? 'default',
    dmPolicy: channel?.dmPolicy ?? 'default',
    groupPolicy: channel?.groupPolicy ?? 'default',
  }))
}


function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large.'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

type AgentLogEntry = {
  timestamp: string
  severity: 'info' | 'warning' | 'error'
  message: string
  source: 'gateway' | 'session'
  sessionId?: string
}

function getAgentLogs(agentId: string): AgentLogEntry[] {
  const entries: AgentLogEntry[] = []

  // 1. Gateway log — filter lines mentioning this agent
  const gatewayLogPath = path.join(OPENCLAW_HOME, 'logs', 'gateway.log')
  try {
    const content = fs.readFileSync(gatewayLogPath, 'utf8')
    const lines = content.split('\n')
    const agentPattern = new RegExp(`\\b${agentId}\\b`, 'i')

    for (const line of lines) {
      if (!agentPattern.test(line)) continue

      const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+[+-]\d{2}:\d{2})\s/)
      if (!tsMatch) continue

      let severity: AgentLogEntry['severity'] = 'info'
      if (/error|failed|crash/i.test(line)) severity = 'error'
      else if (/warn|stale|timeout|unhealthy/i.test(line)) severity = 'warning'

      entries.push({
        timestamp: tsMatch[1],
        severity,
        message: line.slice(tsMatch[0].length).trim(),
        source: 'gateway',
      })
    }
  } catch {
    // gateway log not available
  }

  // 2. Session JSONL files — extract meaningful events
  const sessionsDir = path.join(OPENCLAW_HOME, 'agents', agentId, 'sessions')
  try {
    const files = fs.readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(sessionsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 3) // most recent 3 sessions

    for (const file of files) {
      const sessionId = file.name.replace('.jsonl', '')
      try {
        const content = fs.readFileSync(path.join(sessionsDir, file.name), 'utf8')
        const lines = content.split('\n').filter(Boolean)

        for (const line of lines) {
          try {
            const obj = JSON.parse(line) as Record<string, unknown>
            const type = obj.type as string
            const ts = obj.timestamp as string | undefined

            if (!ts) continue

            if (type === 'session') {
              entries.push({ timestamp: ts, severity: 'info', message: `Session started (cwd: ${obj.cwd ?? 'unknown'})`, source: 'session', sessionId })
            } else if (type === 'model_change') {
              entries.push({ timestamp: ts, severity: 'info', message: `Model → ${obj.provider ?? ''}/${obj.modelId ?? 'unknown'}`, source: 'session', sessionId })
            } else if (type === 'message') {
              const msg = obj.message as Record<string, unknown> | undefined
              if (!msg) continue
              const role = msg.role as string
              if (role === 'user') {
                const content = typeof msg.content === 'string' ? msg.content : ''
                const preview = content.split('\n')[0].slice(0, 120)
                if (preview) entries.push({ timestamp: ts, severity: 'info', message: `User: ${preview}${content.length > 120 ? '…' : ''}`, source: 'session', sessionId })
              } else if (role === 'assistant') {
                const content = typeof msg.content === 'string' ? msg.content : ''
                const stopReason = msg.stopReason as string | undefined
                if (stopReason === 'error') {
                  entries.push({ timestamp: ts, severity: 'error', message: `Assistant error: ${content.split('\n')[0].slice(0, 120)}`, source: 'session', sessionId })
                }
                // Only log assistant stop_reason=end_turn for final messages
                if (stopReason === 'end_turn' && content) {
                  const preview = content.split('\n')[0].slice(0, 120)
                  entries.push({ timestamp: ts, severity: 'info', message: `Response: ${preview}${content.length > 120 ? '…' : ''}`, source: 'session', sessionId })
                }
              }
            } else if (type === 'custom') {
              const customType = obj.customType as string | undefined
              if (customType) {
                entries.push({ timestamp: ts, severity: 'info', message: `[${customType}]`, source: 'session', sessionId })
              }
            }
          } catch {
            // skip malformed lines
          }
        }
      } catch {
        // skip unreadable session files
      }
    }
  } catch {
    // sessions dir not available
  }

  // Sort by timestamp desc, cap
  return entries
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, AGENT_LOG_LIMIT)
}

function createMissionControlState() {
  const configPath = path.join(OPENCLAW_HOME, 'openclaw.json')
  const config = readJsonFile<OpenClawConfig>(configPath, {})
  const subagentRunsPath = path.join(OPENCLAW_HOME, 'subagents', 'runs.json')
  const subagentRuns = readJsonFile<SubagentRuns>(subagentRunsPath, {})
  const gatewayStatus = getGatewayStatus()
  const gatewayLog = getGatewayLogWarnings(gatewayStatus.logs)
  const runs = getSubagentRunsSummary(subagentRuns)
  const models = getModelsConfig(config)
  const agentsRoot = path.join(OPENCLAW_HOME, 'agents')
  const agentDirs = fs.existsSync(agentsRoot)
    ? fs.readdirSync(agentsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : []

  const configuredAgents = config.agents?.list ?? []
  const configuredAgentIds = new Set(configuredAgents.map((agent) => agent.id))

  const agents: AgentSnapshot[] = configuredAgents.map((agent) => {
    const sessionsPath = path.join(agentsRoot, agent.id, 'sessions', 'sessions.json')
    const existsOnDisk = fs.existsSync(path.join(agentsRoot, agent.id))
    const identityEmoji = readAgentIdentityEmoji(agent.workspace ?? '')
    const sessions = readJsonFile<SessionMap>(sessionsPath, {})
    const sessionEntries = Object.entries(sessions) as Array<[string, SessionEntry]>

    const sessionsSnapshot: SessionSnapshot[] = sessionEntries
      .map(([sessionKey, session]) => {
        const updatedAt = session.updatedAt ?? 0
        return {
          agentId: agent.id,
          sessionKey,
          sessionId: session.sessionId ?? 'unknown',
          updatedAt,
          updatedLabel: formatRelativeTime(updatedAt),
          channel: session.lastChannel ?? session.channel ?? session.deliveryContext?.channel ?? 'unknown',
          model: session.model ? `${session.modelProvider ?? 'model'} / ${session.model}` : agent.model?.primary ?? 'unknown',
          label: session.label ?? null,
          sessionFile: session.sessionFile ?? null,
          spawnDepth: session.spawnDepth ?? 0,
          isRecent: updatedAt > 0 && Date.now() - updatedAt < ACTIVE_WINDOW_MS,
        }
      })
      .sort((left, right) => right.updatedAt - left.updatedAt)

    const latestUpdate = sessionsSnapshot[0]?.updatedAt ?? 0
    const activeRun = Object.values(subagentRuns.runs ?? {}).some((run) => run.childSessionKey?.startsWith(`agent:${agent.id}:`) && !run.endedAt)
    const recentSessionCount = sessionsSnapshot.filter((session) => session.isRecent).length
    const active = activeRun || recentSessionCount > 0

    let activeReason = 'no recent activity'
    if (!existsOnDisk) activeReason = 'configured but agent store missing on disk'
    else if (activeRun) activeReason = 'active subagent run'
    else if (recentSessionCount > 0) activeReason = `${recentSessionCount} recently updated session${recentSessionCount === 1 ? '' : 's'}`
    else if (sessionsSnapshot.length > 0 && latestUpdate > 0 && Date.now() - latestUpdate > STALE_WINDOW_MS) activeReason = 'session store exists but is stale'
    else if (sessionsSnapshot.length > 0) activeReason = 'session history present, currently idle'

    return {
      id: agent.id,
      name: agent.id,
      identityEmoji,
      model: agent.model?.primary ?? 'unknown',
      workspace: agent.workspace ?? 'unknown',
      sessionsPath,
      existsOnDisk,
      hasSessions: sessionsSnapshot.length > 0,
      sessionCount: sessionsSnapshot.length,
      recentSessionCount,
      active,
      activeReason,
      updatedAt: latestUpdate || null,
      updatedLabel: formatRelativeTime(latestUpdate || undefined),
      latestSessionId: sessionsSnapshot[0]?.sessionId ?? null,
      sessions: sessionsSnapshot,
    }
  })

  const recentSessions = agents
    .flatMap((agent) => agent.sessions)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, RECENT_SESSION_LIMIT)

  const orphanAgentStores = agentDirs.filter((agentId) => !configuredAgentIds.has(agentId))
  const channels = createChannelSnapshots(config)

  const blockers = [
    ...gatewayStatus.warnings.map((message) => ({
      source: 'gateway status',
      message,
      severity: 'warning' as BlockerSeverity,
    })),
    ...gatewayLog.warnings.map((message) => ({
      source: 'gateway log',
      message,
      severity: /error|failed|not loaded|not installed/i.test(message) ? 'critical' as BlockerSeverity : 'warning' as BlockerSeverity,
    })),
  ]

  if (/not loaded|not installed|unit not found/i.test(gatewayStatus.service) || /not installed|unit not found/i.test(gatewayStatus.raw)) {
    blockers.unshift({
      source: 'gateway service',
      message: `Gateway service is unhealthy: ${gatewayStatus.service}. Mission Control can read state, but the managed service is not properly installed/loaded.`,
      severity: 'critical' as BlockerSeverity,
    })
  }

  for (const agent of agents) {
    if (!agent.existsOnDisk) {
      blockers.push({
        source: `agent:${agent.id}`,
        message: 'Agent is configured but its local store directory does not exist yet.',
        severity: 'warning' as BlockerSeverity,
      })
    } else if (!agent.hasSessions) {
      blockers.push({
        source: `agent:${agent.id}`,
        message: 'Agent exists but has no sessions recorded yet.',
        severity: 'info' as BlockerSeverity,
      })
    } else if (agent.updatedAt && Date.now() - agent.updatedAt > STALE_WINDOW_MS) {
      blockers.push({
        source: `agent:${agent.id}`,
        message: `Latest activity is stale (${agent.updatedLabel}).`,
        severity: 'warning' as BlockerSeverity,
      })
    }
  }

  for (const orphan of orphanAgentStores) {
    blockers.push({
      source: `agent-store:${orphan}`,
      message: 'Agent data exists on disk but the agent is not currently registered in openclaw.json.',
      severity: 'warning' as BlockerSeverity,
    })
  }

  if (agents.every((agent) => !agent.active)) {
    blockers.push({
      source: 'sessions',
      message: 'No agents show recent activity inside the active window.',
      severity: 'warning' as BlockerSeverity,
    })
  }

  // --- ACP Runs ---
  const claudeCodeRuns = detectClaudeCodeSessions()
  const acpActiveRuns = claudeCodeRuns.filter((r) => r.status === 'running')
  const acpRecentRuns = claudeCodeRuns.filter((r) => r.status !== 'running')

  const acpRuns = {
    active: acpActiveRuns,
    recent: acpRecentRuns,
    totalActive: acpActiveRuns.length,
    totalRecent: acpRecentRuns.length,
  }

  const focus = [
    blockers.find((item) => item.severity === 'critical')?.message,
    acpActiveRuns.length > 0 ? `${acpActiveRuns.length} ACP run${acpActiveRuns.length === 1 ? '' : 's'} active right now.` : undefined,
    agents.find((agent) => agent.active)?.name ? `${agents.find((agent) => agent.active)?.name} has live activity right now.` : undefined,
    recentSessions[0] ? `Most recent session: ${recentSessions[0].agentId} / ${recentSessions[0].sessionId} (${recentSessions[0].updatedLabel}).` : undefined,
    orphanAgentStores.length > 0 ? `${orphanAgentStores.length} orphan agent store${orphanAgentStores.length === 1 ? '' : 's'} detected on disk.` : undefined,
  ].filter(Boolean)

  return {
    generatedAt: Date.now(),
    generatedLabel: new Date().toLocaleString(),
    dataSources: {
      config: configPath,
      agentsRoot,
      subagents: subagentRunsPath,
      gatewayLog: gatewayLog.path,
      gatewayStatusCommand: 'openclaw gateway status',
      claudeCodeSessions: path.join(CLAUDE_HOME, 'projects'),
      taskBoard: DB_PATH,
    },
    metrics: {
      activeAgents: agents.filter((agent) => agent.active).length,
      totalAgents: agents.length,
      agentsWithSessions: agents.filter((agent) => agent.hasSessions).length,
      totalSessions: agents.reduce((sum, agent) => sum + agent.sessionCount, 0),
      activeSessions: agents.reduce((sum, agent) => sum + agent.recentSessionCount, 0),
      activeTasks: runs.active.length,
      blockers: blockers.filter((blocker) => blocker.severity !== 'info').length,
      orphanAgentStores: orphanAgentStores.length,
      acpActiveRuns: acpActiveRuns.length,
      acpTotalRuns: claudeCodeRuns.length,
    },
    gateway: {
      ...gatewayStatus,
      port: config.gateway?.port ?? null,
      mode: config.gateway?.mode ?? null,
      recentWarnings: gatewayLog.warnings,
    },
    runs,
    acpRuns,
    models,
    channels,
    focus,
    blockers,
    agents,
    orphanAgentStores,
    recentSessions,
  }
}

function missionControlApiPlugin() {
  const handleState = (_req: IncomingMessage, res: ServerResponse) => {
    sendJson(res, 200, createMissionControlState())
  }

  const handleTasks = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === 'GET') {
        sendJson(res, 200, { tasks: db.listTasks(), path: DB_PATH })
        return
      }

      if (req.method === 'POST') {
        const body = await readBody(req)
        const input = body ? (JSON.parse(body) as Partial<MissionTask>) : {}

        // Auto-route if no explicit assignedAgent
        const routing = autoAssignIfMissing(input.assignedAgent, input.title ?? '', input.description ?? '')
        if (routing) {
          input.assignedAgent = routing.agent
        }

        const task = db.createTask(input, routing ? { autoRouted: true, routingReason: routing.routingReason } : undefined)
        dispatcher.onTaskCreated(task)
        sendJson(res, 201, { task, routing: routing ? { agent: routing.agent, reason: routing.routingReason, auto: true } : null })
        return
      }

      sendJson(res, 405, { error: 'Method not allowed.' })
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : 'Task request failed.' })
    }
  }

  const handleTaskById = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '', 'http://mission-control.local')
      const taskId = decodeURIComponent(url.pathname.slice(`${TASKS_API_PATH}/`.length))

      if (req.method === 'GET') {
        const task = db.getTask(taskId)
        if (!task) { sendJson(res, 404, { error: 'Task not found.' }); return }
        sendJson(res, 200, { task })
        return
      }

      if (req.method !== 'PATCH') {
        sendJson(res, 405, { error: 'Method not allowed.' })
        return
      }

      const previousTask = db.getTask(taskId)
      if (!previousTask) { sendJson(res, 404, { error: 'Task not found.' }); return }

      const body = await readBody(req)
      const patch = body ? (JSON.parse(body) as MissionTaskPatch) : {}

      // Auto-route on patch if assignedAgent is still missing and content changed materially
      let routing: { agent: string; routingReason: string; auto: boolean } | null = null
      const effectiveAgent = patch.assignedAgent !== undefined ? patch.assignedAgent : previousTask.assignedAgent
      const contentChanged = typeof patch.title === 'string' || typeof patch.description === 'string'
      if (!effectiveAgent && contentChanged) {
        const title = typeof patch.title === 'string' ? patch.title : previousTask.title
        const description = typeof patch.description === 'string' ? patch.description : previousTask.description
        const result = autoAssignIfMissing(null, title, description)
        if (result) {
          patch.assignedAgent = result.agent
          routing = { agent: result.agent, routingReason: result.routingReason, auto: true }
        }
      }

      const task = db.patchTask(taskId, patch, routing ? { autoRouted: true, routingReason: routing.routingReason } : undefined)
      dispatcher.onTaskPatched(taskId, patch, previousTask, task)
      sendJson(res, 200, { task, routing })
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : 'Task update failed.' })
    }
  }

  const handleAgentLogs = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '', 'http://mission-control.local')
    const match = url.pathname.match(new RegExp(`^${AGENT_LOGS_API_PATH}/([^/]+)/logs$`))
    if (!match) { sendJson(res, 400, { error: 'Invalid path.' }); return }

    const agentId = decodeURIComponent(match[1])
    const logs = getAgentLogs(agentId)
    sendJson(res, 200, { agentId, logs, source: 'gateway + session JSONL', approximate: true })
  }

  const handleTaskComments = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '', 'http://mission-control.local')
      const match = url.pathname.match(new RegExp(`^${TASKS_API_PATH}/([^/]+)/comments$`))
      if (!match) { sendJson(res, 400, { error: 'Invalid path.' }); return }

      const taskId = decodeURIComponent(match[1])

      if (req.method === 'GET') {
        const comments = db.listComments(taskId)
        sendJson(res, 200, { comments })
        return
      }

      if (req.method === 'POST') {
        const body = await readBody(req)
        const input = body ? (JSON.parse(body) as Partial<TaskComment>) : {}
        const comment = db.addComment(taskId, input)
        sendJson(res, 201, { comment })
        return
      }

      sendJson(res, 405, { error: 'Method not allowed.' })
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : 'Comment request failed.' })
    }
  }

  const handleTaskClaim = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '', 'http://mission-control.local')
      const match = url.pathname.match(new RegExp(`^${TASKS_API_PATH}/([^/]+)/claim$`))
      if (!match) { sendJson(res, 400, { error: 'Invalid path.' }); return }

      const taskId = decodeURIComponent(match[1])

      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed.' })
        return
      }

      const body = await readBody(req)
      const input = body ? (JSON.parse(body) as { agent?: string }) : {}
      if (!input.agent?.trim()) { sendJson(res, 400, { error: 'Agent ID is required to claim a task.' }); return }

      const task = db.claimTask(taskId, input.agent.trim())
      dispatcher.onTaskClaimed(task)
      sendJson(res, 200, { task, claimed: true })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Claim failed.'
      const status = msg.includes('already claimed') || msg.includes('Cannot claim') ? 409 : 400
      sendJson(res, status, { error: msg })
    }
  }

  const handleReviews = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '', 'http://mission-control.local')

      if (req.method === 'GET') {
        // GET /api/mission-control/reviews?taskId=xxx — list reviews
        const taskId = url.searchParams.get('taskId') ?? undefined
        const reviews = db.listReviews(taskId)
        sendJson(res, 200, { reviews })
        return
      }

      if (req.method === 'POST') {
        // POST /api/mission-control/reviews — trigger a review
        const body = await readBody(req)
        const input = body ? (JSON.parse(body) as reviewPolicy.ReviewInput) : null
        if (!input) { sendJson(res, 400, { error: 'Request body is required.' }); return }
        if (!input.author) { sendJson(res, 400, { error: 'author is required.' }); return }
        if (!input.title) { sendJson(res, 400, { error: 'title is required.' }); return }

        // Run the review engine
        const result = reviewPolicy.performReview(input)
        const reviewId = crypto.randomUUID()

        // Persist the review
        const record = db.createReview({
          id: reviewId,
          taskId: input.taskId ?? null,
          author: result.author,
          reviewer: result.reviewer,
          riskLevel: result.risk.level,
          riskScore: result.risk.score,
          riskSignals: result.risk.signals,
          riskReason: result.risk.reason,
          outcome: result.outcome,
          mergeRecommendation: result.mergeRecommendation,
          autoMergeEligible: result.autoMergeEligible,
          checklist: result.checklist,
          summary: result.summary,
          filesChanged: input.filesChanged ?? [],
          title: input.title,
          checksPassed: input.checksPassed ?? false,
          branchClean: input.branchClean ?? false,
        })

        // If linked to a task and outcome is approve with auto-merge, transition task
        if (input.taskId && result.autoMergeEligible) {
          const task = db.getTask(input.taskId)
          if (task && task.status === 'in_review') {
            db.patchTask(input.taskId, { status: 'done', resultSummary: `Auto-merged: ${result.summary}` })
          }
        }

        // If linked to a task and changes_requested, move back to doing
        if (input.taskId && result.outcome === 'changes_requested') {
          const task = db.getTask(input.taskId)
          if (task && task.status === 'in_review') {
            db.patchTask(input.taskId, { status: 'doing' })
          }
        }

        sendJson(res, 201, {
          review: record,
          comment: reviewPolicy.formatReviewComment(result),
        })
        return
      }

      sendJson(res, 405, { error: 'Method not allowed.' })
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : 'Review request failed.' })
    }
  }

  const handleReviewById = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '', 'http://mission-control.local')
    const reviewId = decodeURIComponent(url.pathname.slice(`${REVIEWS_API_PATH}/`.length))

    if (req.method !== 'GET') { sendJson(res, 405, { error: 'Method not allowed.' }); return }

    const review = db.getReview(reviewId)
    if (!review) { sendJson(res, 404, { error: 'Review not found.' }); return }
    sendJson(res, 200, { review })
  }

  const handleDispatcher = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET') {
      const status = dispatcher.getStatus()
      sendJson(res, 200, {
        ...status,
        lastEvalLabel: formatRelativeTime(status.lastEvalAt ?? undefined),
      })
      return
    }

    if (req.method === 'POST') {
      const url = new URL(req.url ?? '', 'http://mission-control.local')
      const action = url.searchParams.get('action')

      if (action === 'enable') {
        dispatcher.enable()
        sendJson(res, 200, { enabled: true })
        return
      }
      if (action === 'disable') {
        dispatcher.disable()
        sendJson(res, 200, { enabled: false })
        return
      }

      // Also support legacy start/stop
      if (action === 'start') {
        dispatcher.enable()
        sendJson(res, 200, { enabled: true })
        return
      }
      if (action === 'stop') {
        dispatcher.disable()
        sendJson(res, 200, { enabled: false })
        return
      }

      // Manual single-cycle trigger
      try {
        const outcomes = await dispatcher.triggerEvaluation()
        sendJson(res, 200, { triggered: true, outcomes })
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Dispatch evaluation failed.' })
      }
      return
    }

    sendJson(res, 405, { error: 'Method not allowed.' })
  }

  const install = (server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      const pathname = new URL(req.url ?? '/', 'http://mission-control.local').pathname

      if (pathname === API_PATH) {
        handleState(req, res)
        return
      }

      if (pathname.match(new RegExp(`^${AGENT_LOGS_API_PATH}/[^/]+/logs$`))) {
        handleAgentLogs(req, res)
        return
      }

      if (pathname === DISPATCHER_API_PATH) {
        void handleDispatcher(req, res)
        return
      }

      if (pathname === REVIEWS_API_PATH) {
        void handleReviews(req, res)
        return
      }

      if (pathname.startsWith(`${REVIEWS_API_PATH}/`)) {
        handleReviewById(req, res)
        return
      }

      if (pathname === TASKS_API_PATH) {
        void handleTasks(req, res)
        return
      }

      if (pathname.match(new RegExp(`^${TASKS_API_PATH}/[^/]+/claim$`))) {
        void handleTaskClaim(req, res)
        return
      }

      if (pathname.match(new RegExp(`^${TASKS_API_PATH}/[^/]+/comments$`))) {
        void handleTaskComments(req, res)
        return
      }

      if (pathname.match(new RegExp(`^${TASKS_API_PATH}/[^/]+/events$`))) {
        const evMatch = pathname.match(new RegExp(`^${TASKS_API_PATH}/([^/]+)/events$`))
        if (evMatch) {
          const taskId = decodeURIComponent(evMatch[1])
          sendJson(res, 200, { events: db.listDispatchEvents(taskId) })
        } else {
          sendJson(res, 400, { error: 'Invalid path.' })
        }
        return
      }

      if (pathname.startsWith(`${TASKS_API_PATH}/`)) {
        void handleTaskById(req, res)
        return
      }

      next()
    })
  }

  return {
    name: 'mission-control-openclaw-api',
    configureServer(server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      install(server)
      // Dispatcher v2 is event-driven (reacts to task mutations), not polling-based.
      // Enable via MC_DISPATCHER=1 env var or POST /api/mission-control/dispatcher?action=enable
      if (process.env.MC_DISPATCHER === '1') {
        dispatcher.enable()
      }
    },
    configurePreviewServer(server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      install(server)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), missionControlApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 4174,
    watch: {
      ignored: ['**/data/**'],
    },
  },
  preview: {
    port: 4174,
  },
})
