import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileText,
  FolderGit2,
  KanbanSquare,
  LayoutDashboard,
  Lock,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Terminal,
  TriangleAlert,
  Route,
  UserRound,
  Wrench,
  Zap,
  Power,
  Clock,
  Radio,
  Pause,
  Play,
} from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, CardAction } from '@/components/ui/card'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogBody, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type AgentSession = {
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

type AgentCard = {
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
  sessions: AgentSession[]
}

type Blocker = {
  source: string
  message: string
  severity: 'warning' | 'critical' | 'info' | string
}

type ChannelSnapshot = {
  id: string
  enabled: boolean
  mode: string
  dmPolicy: string
  groupPolicy: string
}

type MissionTaskStatus = 'inbox' | 'ready' | 'doing' | 'blocked' | 'done'
type MissionTaskPriority = 'low' | 'medium' | 'high'
type TaskCommentType = 'progress' | 'blocker' | 'decision' | 'result' | 'system'

type TaskComment = {
  id: string
  author: string
  type: TaskCommentType
  createdAt: number
  text: string
}

type MissionTask = {
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
  claim: {
    claimedBy: string | null
    claimedAt: number | null
  }
  routing?: {
    autoRouted: boolean
    routingReason: string | null
  }
}

type AcpRun = {
  sessionId: string
  harness: string
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

type AcpRunsSummary = {
  active: AcpRun[]
  recent: AcpRun[]
  totalActive: number
  totalRecent: number
}

type MissionControlState = {
  generatedAt: number
  generatedLabel: string
  dataSources: Record<string, string>
  metrics: {
    activeAgents: number
    totalAgents: number
    agentsWithSessions: number
    totalSessions: number
    activeSessions: number
    activeTasks: number
    blockers: number
    orphanAgentStores: number
    acpActiveRuns: number
    acpTotalRuns: number
  }
  gateway: {
    ok: boolean
    runtime: string
    service: string
    listening: string
    logs: string
    warnings: string[]
    recentWarnings: string[]
  }
  acpRuns: AcpRunsSummary
  channels: ChannelSnapshot[]
  focus: string[]
  blockers: Blocker[]
  agents: AgentCard[]
  orphanAgentStores: string[]
  recentSessions: AgentSession[]
}

type AgentLogEntry = {
  timestamp: string
  severity: 'info' | 'warning' | 'error'
  message: string
  source: 'gateway' | 'session'
  sessionId?: string
}

type TaskFormState = {
  title: string
  description: string
  priority: MissionTaskPriority
  status: MissionTaskStatus
  assignedAgent: string
}

type TaskEditFormState = {
  title: string
  description: string
  priority: MissionTaskPriority
  status: MissionTaskStatus
  assignedAgent: string
}

type DispatchOutcome = {
  taskId: string
  taskTitle: string
  agentId: string
  outcome: 'dispatched' | 'error' | 'blocked' | 'busy' | 'skipped'
  message?: string
  at: number
}

type DispatcherAgentOccupancy = {
  agentId: string
  busy: boolean
  activeTaskId: string | null
  activeTaskTitle: string | null
}

type DispatcherQueueItem = {
  taskId: string
  title: string
  assignedAgent: string
  priority: string
  waitReason: string
  dispatchAttempts: number
  lastDispatchError: string | null
  readySince: number | null
}

type DispatcherStatus = {
  enabled: boolean
  lastEvalAt: number | null
  lastOutcomes: DispatchOutcome[]
  knownAgents: string[]
  agentOccupancy: DispatcherAgentOccupancy[]
  queue: DispatcherQueueItem[]
}

type ViewId = 'dashboard' | 'tasks' | 'agents' | 'sessions' | 'system'

const TASK_STATUSES: Array<{ id: MissionTaskStatus; label: string }> = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'ready', label: 'Ready' },
  { id: 'doing', label: 'Doing' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'done', label: 'Done' },
]

const PRIORITY_TONES: Record<MissionTaskPriority, string> = {
  low: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/20',
  medium: 'text-cyan-200 bg-cyan-500/10 border-cyan-500/20',
  high: 'text-orange-200 bg-orange-500/10 border-orange-500/20',
}

const STATUS_ACCENTS: Record<MissionTaskStatus, string> = {
  inbox: 'border-zinc-500/20',
  ready: 'border-cyan-500/20',
  doing: 'border-orange-500/20',
  blocked: 'border-red-500/20',
  done: 'border-emerald-500/20',
}

const STATUS_DOTS: Record<MissionTaskStatus, string> = {
  inbox: 'text-zinc-400',
  ready: 'text-cyan-400',
  doing: 'text-orange-400',
  blocked: 'text-red-400',
  done: 'text-emerald-400',
}

const COMMENT_TYPE_TONES: Record<TaskCommentType, string> = {
  progress: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20',
  blocker: 'text-red-300 bg-red-500/10 border-red-500/20',
  decision: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  result: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  system: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
}

const COMMENT_TYPES: Array<{ id: TaskCommentType; label: string }> = [
  { id: 'progress', label: 'Progress' },
  { id: 'blocker', label: 'Blocker' },
  { id: 'decision', label: 'Decision' },
  { id: 'result', label: 'Result' },
]

/* User-selectable types (system is auto-generated only) */

const NAV_ITEMS: Array<{ id: ViewId; label: string; icon: typeof Bot }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'tasks', label: 'Tasks', icon: KanbanSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'sessions', label: 'Sessions', icon: Activity },
  { id: 'system', label: 'System', icon: Terminal },
]

type ToneKey = 'active' | 'inactive' | 'warning' | 'critical' | 'info'

const toneBadge: Record<ToneKey, string> = {
  active: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  inactive: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
  warning: 'text-orange-200 bg-orange-500/10 border-orange-500/20',
  critical: 'text-red-200 bg-red-500/10 border-red-500/20',
  info: 'text-cyan-200 bg-cyan-500/10 border-cyan-500/20',
}

const emptyTaskForm: TaskFormState = {
  title: '',
  description: '',
  priority: 'medium',
  status: 'inbox',
  assignedAgent: '',
}

function createTaskEditForm(task: MissionTask): TaskEditFormState {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    assignedAgent: task.assignedAgent ?? '',
  }
}

const cardClass = 'bg-linear-to-b from-white/[0.03] to-white/[0.01] border-white/8 backdrop-blur-sm rounded-2xl'

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'long' })

function formatRelativeTime(timestamp?: number) {
  if (!timestamp) return 'unknown'
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (deltaSeconds < 60) return 'just now'
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unit, size] of units) {
    if (deltaSeconds >= size) {
      return rtf.format(-Math.floor(deltaSeconds / size), unit)
    }
  }
  return rtf.format(-deltaSeconds, 'second')
}

/* ── Shared sub-components ── */

function StatCard({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: typeof Bot }) {
  return (
    <Card className={`${cardClass} transition-colors hover:border-white/12`}>
      <CardHeader>
        <CardTitle className="text-sm font-normal text-zinc-400" style={{ textWrap: 'balance' }}>{label}</CardTitle>
        <CardAction>
          <Icon className="h-4 w-4 text-orange-300" aria-hidden="true" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="font-display text-3xl font-semibold tracking-tight text-zinc-50" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <CardDescription className="mt-2 text-zinc-500">{hint}</CardDescription>
      </CardContent>
    </Card>
  )
}

function LoadingSkeleton() {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className={cardClass}>
          <CardHeader><Skeleton className="h-4 w-24 bg-white/5" /></CardHeader>
          <CardContent>
            <Skeleton className="h-9 w-16 bg-white/5" />
            <Skeleton className="mt-2 h-4 w-40 bg-white/5" />
          </CardContent>
        </Card>
      ))}
    </section>
  )
}

function Pill({ children, toneKey, className = '' }: { children: ReactNode; toneKey: ToneKey; className?: string }) {
  return <Badge variant="outline" className={`rounded-full ${toneBadge[toneKey]} ${className}`.trim()}>{children}</Badge>
}

function TaskPill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <Badge variant="outline" className={`rounded-full ${className}`.trim()}>{children}</Badge>
}

function AgentIdentityLabel({ agent, className = '' }: { agent: Pick<AgentCard, 'name' | 'identityEmoji'>; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`.trim()}>
      {agent.identityEmoji ? <span aria-hidden="true">{agent.identityEmoji}</span> : null}
      <span>{agent.name}</span>
    </span>
  )
}

const COLUMN_EMPTY_LABELS: Record<MissionTaskStatus, string> = {
  inbox: 'No new tasks',
  ready: 'Nothing queued',
  doing: 'No work in progress',
  blocked: 'Nothing blocked',
  done: 'No completed tasks',
}

/* ── Task card with Dialog ── */

function TaskCardItem({
  task,
  savingTaskId,
  state,
  agentsById,
  patchTask,
  addComment,
}: {
  task: MissionTask
  savingTaskId: string | null
  state: MissionControlState | null
  agentsById: Map<string, AgentCard>
  patchTask: (taskId: string, patch: Partial<Pick<MissionTask, 'status' | 'priority' | 'assignedAgent' | 'title' | 'description'>>) => Promise<void>
  addComment: (taskId: string, comment: { author: string; type: TaskCommentType; text: string }) => Promise<void>
}) {
  const [showCommentForm, setShowCommentForm] = useState(false)
  const [commentAuthor, setCommentAuthor] = useState('')
  const [commentType, setCommentType] = useState<TaskCommentType>('progress')
  const [commentText, setCommentText] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState<TaskEditFormState>(() => createTaskEditForm(task))
  const assignedAgent = task.assignedAgent ? agentsById.get(task.assignedAgent) : null
  const commentCount = task.comments?.length ?? 0
  const isSavingTask = savingTaskId === task.id

  useEffect(() => {
    setEditForm(createTaskEditForm(task))
  }, [task])

  async function handleAddComment(e: FormEvent) {
    e.preventDefault()
    if (!commentAuthor.trim() || !commentText.trim()) return
    setSubmittingComment(true)
    try {
      await addComment(task.id, { author: commentAuthor.trim(), type: commentType, text: commentText.trim() })
      setCommentText('')
      setShowCommentForm(false)
    } finally {
      setSubmittingComment(false)
    }
  }

  async function handleSaveEdits(e: FormEvent) {
    e.preventDefault()
    if (!editForm.title.trim()) return

    await patchTask(task.id, {
      title: editForm.title.trim(),
      description: editForm.description.trim(),
      priority: editForm.priority,
      status: editForm.status,
      assignedAgent: editForm.assignedAgent || null,
    })

    setEditMode(false)
  }

  function handleCancelEdits() {
    setEditForm(createTaskEditForm(task))
    setEditMode(false)
  }

  return (
    <Dialog>
      <DialogTrigger
        className="w-full text-left rounded-2xl border border-white/7 bg-[#111214] p-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.18)] transition-colors hover:border-white/12 cursor-pointer"
        aria-label={`Open details for ${task.title}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-5 text-zinc-50 truncate">{task.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <TaskPill className={PRIORITY_TONES[task.priority]}>{task.priority}</TaskPill>
              <TaskPill className={assignedAgent?.active ? toneBadge.active : toneBadge.inactive}>
                <span className="inline-flex items-center gap-1">
                  {task.routing?.autoRouted ? (
                    <Route className="h-2.5 w-2.5" aria-hidden="true" />
                  ) : (
                    <UserRound className="h-2.5 w-2.5" aria-hidden="true" />
                  )}
                  {task.assignedAgent ?? 'Unassigned'}
                </span>
              </TaskPill>
              {task.claim?.claimedBy && (
                <TaskPill className="text-orange-300 bg-orange-500/10 border-orange-500/20">
                  <span className="inline-flex items-center gap-1">
                    <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                    {task.claim.claimedBy}
                  </span>
                </TaskPill>
              )}
              {commentCount > 0 && (
                <TaskPill className="text-zinc-400 bg-white/[0.03] border-white/10">
                  <span className="inline-flex items-center gap-1">
                    <MessageSquareText className="h-2.5 w-2.5" aria-hidden="true" />
                    {commentCount}
                  </span>
                </TaskPill>
              )}
            </div>
          </div>
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
        </div>
      </DialogTrigger>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="flex items-center gap-2">
              <TaskPill className={PRIORITY_TONES[task.priority]}>{task.priority}</TaskPill>
              <Badge variant="outline" className={`rounded-full text-[10px] ${STATUS_ACCENTS[task.status]} text-zinc-300`}>{task.status}</Badge>
            </div>
            {!editMode ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditMode(true)}
                className="rounded-full border-cyan-400/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 hover:text-cyan-100"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" /> Edit
              </Button>
            ) : null}
          </div>
          <DialogTitle className="text-lg">{task.title}</DialogTitle>
          {task.description && <DialogDescription>{task.description}</DialogDescription>}
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            <span>Updated {formatRelativeTime(task.updatedAt)}</span>
            {task.routing?.autoRouted && task.assignedAgent && (
              <span className="inline-flex items-center gap-1 text-violet-300">
                <Route className="h-3 w-3" aria-hidden="true" />
                Auto-routed to <span className="font-medium">{task.assignedAgent}</span>
              </span>
            )}
            {task.assignedAgent && !task.routing?.autoRouted && (
              <span className="inline-flex items-center gap-1 text-zinc-400">
                <UserRound className="h-3 w-3" aria-hidden="true" />
                Manually assigned
              </span>
            )}
            {task.claim?.claimedBy && (
              <span className="inline-flex items-center gap-1 text-orange-300">
                <Lock className="h-3 w-3" aria-hidden="true" />
                Claimed by <span className="font-medium">{task.claim.claimedBy}</span>
                {task.claim.claimedAt && <span className="text-zinc-600">{formatRelativeTime(task.claim.claimedAt)}</span>}
              </span>
            )}
          </div>

          {/* ── Routing reason (compact, only when auto-routed) ── */}
          {task.routing?.autoRouted && task.routing.routingReason && (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-violet-400 mb-0.5">
                <Route className="h-3 w-3" aria-hidden="true" />
                Routing Decision
              </div>
              <p className="text-xs text-violet-200/80 leading-4">{task.routing.routingReason}</p>
            </div>
          )}

          {/* ── Result summary (prominent for done tasks) ── */}
          {task.resultSummary && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-400 mb-1">Result</div>
              <p className="text-sm text-emerald-200 leading-5">{task.resultSummary}</p>
            </div>
          )}

          {/* ── Editable fields ── */}
          {editMode ? (
            <form onSubmit={handleSaveEdits} className="space-y-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-3.5">
              <div className="grid gap-1.5">
                <Label className="text-xs text-zinc-300">Title</Label>
                <Input
                  value={editForm.title}
                  onChange={(e) => setEditForm((current) => ({ ...current, title: e.target.value }))}
                  disabled={isSavingTask}
                  autoComplete="off"
                  className="rounded-xl border-white/10 bg-white/[0.03] text-zinc-100 focus:border-cyan-400/50"
                  placeholder="Task title"
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs text-zinc-300">Notes</Label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((current) => ({ ...current, description: e.target.value }))}
                  disabled={isSavingTask}
                  className="min-h-24 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-cyan-400/50"
                  placeholder="Context, constraints, notes..."
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1">
                  <Label className="text-xs text-zinc-500">Owner</Label>
                  <NativeSelect disabled={isSavingTask} value={editForm.assignedAgent} onChange={(e) => setEditForm((current) => ({ ...current, assignedAgent: e.target.value }))} className="w-full">
                    <NativeSelectOption value="">Unassigned</NativeSelectOption>
                    {(state?.agents ?? []).map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs text-zinc-500">Status</Label>
                  <NativeSelect disabled={isSavingTask} value={editForm.status} onChange={(e) => setEditForm((current) => ({ ...current, status: e.target.value as MissionTaskStatus }))} className="w-full">
                    {TASK_STATUSES.map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.label}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs text-zinc-500">Priority</Label>
                  <NativeSelect disabled={isSavingTask} value={editForm.priority} onChange={(e) => setEditForm((current) => ({ ...current, priority: e.target.value as MissionTaskPriority }))} className="w-full">
                    <NativeSelectOption value="low">Low</NativeSelectOption>
                    <NativeSelectOption value="medium">Medium</NativeSelectOption>
                    <NativeSelectOption value="high">High</NativeSelectOption>
                  </NativeSelect>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleCancelEdits} disabled={isSavingTask} className="rounded-full border-white/10 bg-white/[0.03] text-zinc-300 hover:text-zinc-100">
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isSavingTask || !editForm.title.trim()} className="rounded-full border-cyan-400/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 hover:text-cyan-100">
                  {isSavingTask ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1">
                <Label className="text-xs text-zinc-500">Owner</Label>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-zinc-200">
                  <span className="inline-flex items-center gap-1.5">
                    {assignedAgent ? <AgentIdentityLabel agent={assignedAgent} /> : 'Unassigned'}
                    {task.routing?.autoRouted && (
                      <Badge variant="outline" className="rounded-full text-[9px] px-1.5 py-0 leading-3 text-violet-300 bg-violet-500/10 border-violet-500/20">auto</Badge>
                    )}
                  </span>
                </div>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-zinc-500">Status</Label>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-zinc-200">
                  {TASK_STATUSES.find((statusOption) => statusOption.id === task.status)?.label ?? task.status}
                </div>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-zinc-500">Priority</Label>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-zinc-200">
                  {task.priority}
                </div>
              </div>
            </div>
          )}

          {/* ── Comments section ── */}
          <Separator className="bg-white/5" />
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
              <MessageSquareText className="h-3 w-3" aria-hidden="true" />
              Comments {commentCount > 0 && <span className="text-zinc-500">({commentCount})</span>}
            </div>
            <button
              type="button"
              onClick={() => setShowCommentForm(!showCommentForm)}
              className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              {showCommentForm ? 'Cancel' : '+ Add'}
            </button>
          </div>

          {showCommentForm && (
            <form onSubmit={handleAddComment} className="rounded-xl border border-white/8 bg-white/[0.02] p-2.5 space-y-2">
              <div className="flex gap-2">
                <Input
                  value={commentAuthor}
                  onChange={(e) => setCommentAuthor(e.target.value)}
                  placeholder="Author"
                  className="flex-1 h-7 text-xs rounded-lg border-white/10 bg-white/[0.03] text-zinc-100 focus:border-cyan-400/50"
                  autoComplete="off"
                />
                <NativeSelect value={commentType} onChange={(e) => setCommentType(e.target.value as TaskCommentType)} className="h-7 text-xs">
                  {COMMENT_TYPES.map((ct) => <NativeSelectOption key={ct.id} value={ct.id}>{ct.label}</NativeSelectOption>)}
                </NativeSelect>
              </div>
              <div className="flex gap-2">
                <Input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="What happened..."
                  className="flex-1 h-7 text-xs rounded-lg border-white/10 bg-white/[0.03] text-zinc-100 focus:border-cyan-400/50"
                  autoComplete="off"
                />
                <Button
                  type="submit"
                  disabled={submittingComment || !commentAuthor.trim() || !commentText.trim()}
                  className="h-7 px-2.5 text-xs border-cyan-400/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
                >
                  <Send className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            </form>
          )}

          {commentCount > 0 ? (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {task.comments.map((comment) => (
                comment.type === 'system' ? (
                  <div key={comment.id} className="flex items-center gap-2 px-2 py-1 text-[11px] text-zinc-500 italic">
                    <ArrowRight className="h-2.5 w-2.5 shrink-0 text-zinc-600" aria-hidden="true" />
                    <span className="flex-1">{comment.text}</span>
                    <span className="text-[10px] text-zinc-600 shrink-0">{formatRelativeTime(comment.createdAt)}</span>
                  </div>
                ) : (
                  <div key={comment.id} className="rounded-lg border border-white/5 bg-white/[0.015] px-2.5 py-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Badge variant="outline" className={`rounded-full text-[10px] px-1.5 py-0 leading-4 ${COMMENT_TYPE_TONES[comment.type]}`}>
                        {comment.type}
                      </Badge>
                      <span className="text-[11px] font-medium text-zinc-300">{comment.author}</span>
                      <span className="text-[10px] text-zinc-600 ml-auto">{formatRelativeTime(comment.createdAt)}</span>
                    </div>
                    <p className="text-xs leading-4 text-zinc-400">{comment.text}</p>
                  </div>
                )
              ))}
            </div>
          ) : !showCommentForm ? (
            <div className="text-[11px] text-zinc-600 text-center py-2">No comments yet</div>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

/* ── Agent Detail Dialog ── */

const LOG_SEVERITY_TONES: Record<AgentLogEntry['severity'], string> = {
  info: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20',
  warning: 'text-orange-300 bg-orange-500/10 border-orange-500/20',
  error: 'text-red-300 bg-red-500/10 border-red-500/20',
}

function AgentDetailDialog({ agent }: { agent: AgentCard }) {
  const [logs, setLogs] = useState<AgentLogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLogsLoading(true)
    setLogsError(null)

    fetch(`/api/openclaw/agents/${encodeURIComponent(agent.id)}/logs`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load logs (${res.status})`)
        const payload = (await res.json()) as { logs: AgentLogEntry[] }
        if (!cancelled) setLogs(payload.logs)
      })
      .catch((err) => {
        if (!cancelled) setLogsError(err instanceof Error ? err.message : 'Failed to load logs.')
      })
      .finally(() => {
        if (!cancelled) setLogsLoading(false)
      })

    return () => { cancelled = true }
  }, [open, agent.id])

  function formatLogTime(ts: string) {
    try {
      const d = new Date(ts)
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return ts
    }
  }

  function formatLogDate(ts: string) {
    try {
      return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    } catch {
      return ''
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="w-full text-left cursor-pointer"
        aria-label={`Open details for agent ${agent.name}`}
      >
        <Item variant="outline" className="border-white/7 bg-white/[0.02] hover:border-white/12 flex-col items-stretch">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg font-semibold text-zinc-50"><AgentIdentityLabel agent={agent} /></h3>
                <Pill toneKey={agent.active ? 'active' : 'inactive'}>{agent.active ? 'Active' : 'Idle'}</Pill>
                <Pill toneKey={agent.existsOnDisk ? 'info' : 'warning'}>{agent.existsOnDisk ? 'On disk' : 'Missing'}</Pill>
                <Pill toneKey={agent.hasSessions ? 'info' : 'inactive'}>
                  {agent.hasSessions ? `${agent.sessionCount} sessions (${agent.recentSessionCount} recent)` : 'No sessions'}
                </Pill>
              </div>
              <p className="text-sm text-zinc-300">{agent.activeReason}</p>
              <p className="text-sm text-zinc-400">Last update: <span className="text-zinc-200">{agent.updatedLabel}</span></p>
            </div>
            <div className="flex items-center gap-3">
              <div className="grid gap-1.5 text-sm text-zinc-400 md:min-w-72">
                <div><span className="text-zinc-500">Model:</span> <span className="font-display text-xs">{agent.model}</span></div>
                <div className="min-w-0"><span className="text-zinc-500">Workspace:</span> <span className="font-display truncate text-xs">{agent.workspace}</span></div>
              </div>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
            </div>
          </div>
        </Item>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Bot className="h-4 w-4 text-orange-300" aria-hidden="true" />
            <Pill toneKey={agent.active ? 'active' : 'inactive'}>{agent.active ? 'Active' : 'Idle'}</Pill>
            <Pill toneKey={agent.existsOnDisk ? 'info' : 'warning'}>{agent.existsOnDisk ? 'On disk' : 'Missing'}</Pill>
          </div>
          <DialogTitle className="text-lg"><AgentIdentityLabel agent={agent} /></DialogTitle>
          <DialogDescription>{agent.activeReason}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* ── Agent metadata ── */}
          <div className="grid gap-2 text-sm text-zinc-400 sm:grid-cols-2">
            <div><span className="text-zinc-500">Model:</span> <span className="font-display text-xs text-zinc-200">{agent.model}</span></div>
            <div className="min-w-0"><span className="text-zinc-500">Workspace:</span> <span className="font-display truncate text-xs text-zinc-200">{agent.workspace}</span></div>
            <div className="min-w-0"><span className="text-zinc-500">Sessions path:</span> <span className="font-display truncate text-xs text-zinc-200">{agent.sessionsPath}</span></div>
            <div><span className="text-zinc-500">Latest session:</span> <span className="font-display text-xs text-zinc-200">{agent.latestSessionId ?? '\u2014'}</span></div>
            <div><span className="text-zinc-500">Sessions:</span> <span className="text-zinc-200">{agent.sessionCount} total, {agent.recentSessionCount} recent</span></div>
            <div><span className="text-zinc-500">Last update:</span> <span className="text-zinc-200">{agent.updatedLabel}</span></div>
          </div>

          <Separator className="bg-white/5" />

          {/* ── Recent Logs ── */}
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
              <FileText className="h-3 w-3" aria-hidden="true" />
              Recent Logs
              {logs.length > 0 && <span className="text-zinc-500">({logs.length})</span>}
            </div>
            <span className="text-[10px] text-zinc-600">gateway + session JSONL &middot; approximate</span>
          </div>

          {logsLoading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400 py-4" role="status" aria-live="polite">
              <Spinner className="text-orange-300" /> Loading logs&hellip;
            </div>
          ) : logsError ? (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-xs text-red-300">{logsError}</div>
          ) : logs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/8 px-3 py-6 text-center text-xs text-zinc-500">
              No recent logs found for this agent.
            </div>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {logs.map((entry, i) => (
                <div key={`${entry.timestamp}-${i}`} className="rounded-lg border border-white/5 bg-white/[0.015] px-2.5 py-1.5 group">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={`rounded-full text-[10px] px-1.5 py-0 leading-4 ${LOG_SEVERITY_TONES[entry.severity]}`}>
                      {entry.severity}
                    </Badge>
                    <span className="text-[10px] text-zinc-500 tabular-nums">{formatLogDate(entry.timestamp)} {formatLogTime(entry.timestamp)}</span>
                    <Badge variant="outline" className="ml-auto rounded-full text-[9px] px-1 py-0 leading-3 text-zinc-600 bg-white/[0.02] border-white/8">
                      {entry.source}{entry.sessionId ? ` · ${entry.sessionId.slice(0, 8)}` : ''}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs leading-4 text-zinc-300 font-mono break-all">{entry.message}</p>
                </div>
              ))}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

/* ── Task Board ── */

function TaskBoard({
  tasks, tasksLoading, taskError, savingTaskId, state, agentsById, taskCounts, patchTask, addComment,
}: {
  tasks: MissionTask[]; tasksLoading: boolean; taskError: string | null; savingTaskId: string | null
  state: MissionControlState | null; agentsById: Map<string, AgentCard>
  taskCounts: Array<{ id: MissionTaskStatus; label: string; count: number }>
  patchTask: (taskId: string, patch: Partial<Pick<MissionTask, 'status' | 'priority' | 'assignedAgent' | 'title' | 'description'>>) => Promise<void>
  addComment: (taskId: string, comment: { author: string; type: TaskCommentType; text: string }) => Promise<void>
}) {
  return (
    <Card className={cardClass}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KanbanSquare className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          <CardTitle style={{ textWrap: 'balance' }}>Task Board</CardTitle>
        </div>
        <CardAction>
          <div className="flex flex-wrap gap-1.5">
            {taskCounts.map((s) => (
              <TaskPill key={s.id} className={`border ${STATUS_ACCENTS[s.id]} bg-white/[0.03] text-zinc-300`}>
                {s.label} <span style={{ fontVariantNumeric: 'tabular-nums' }}>{s.count}</span>
              </TaskPill>
            ))}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {taskError ? (
          <Alert variant="destructive" className="mb-3 border-red-500/20 bg-red-500/10">
            <AlertDescription className="text-red-200">{taskError}</AlertDescription>
          </Alert>
        ) : null}

        {tasksLoading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-300" role="status" aria-live="polite">
            <Spinner className="text-orange-300" /> Loading&hellip;
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-5">
            {TASK_STATUSES.map((column) => {
              const columnTasks = tasks.filter((t) => t.status === column.id)
              return (
                <div key={column.id} className={`rounded-2xl border bg-white/[0.02] p-3 ${STATUS_ACCENTS[column.id]}`}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Circle className={`h-2 w-2 fill-current ${STATUS_DOTS[column.id]}`} aria-hidden="true" />
                      <div className="text-sm font-medium text-zinc-100">{column.label}</div>
                    </div>
                    <div className="text-xs text-zinc-500" style={{ fontVariantNumeric: 'tabular-nums' }}>{columnTasks.length}</div>
                  </div>
                  <div className="space-y-2">
                    {columnTasks.length === 0 ? (
                      <Empty className="border border-dashed border-white/8 py-4">
                        <EmptyHeader><EmptyTitle className="text-zinc-500">{COLUMN_EMPTY_LABELS[column.id]}</EmptyTitle></EmptyHeader>
                      </Empty>
                    ) : (
                      columnTasks.map((t) => (
                        <TaskCardItem key={t.id} task={t} savingTaskId={savingTaskId} state={state} agentsById={agentsById} patchTask={patchTask} addComment={addComment} />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Main App ── */

const VALID_VIEWS = new Set<ViewId>(['dashboard', 'tasks', 'agents', 'sessions', 'system'])

function readViewFromURL(): ViewId {
  const param = new URLSearchParams(window.location.search).get('view')
  return param && VALID_VIEWS.has(param as ViewId) ? (param as ViewId) : 'dashboard'
}

export default function App() {
  const [state, setState] = useState<MissionControlState | null>(null)
  const [tasks, setTasks] = useState<MissionTask[]>([])
  const [loading, setLoading] = useState(true)
  const [tasksLoading, setTasksLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [submittingTask, setSubmittingTask] = useState(false)
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null)
  const [form, setForm] = useState<TaskFormState>(emptyTaskForm)
  const [dispatcherStatus, setDispatcherStatus] = useState<DispatcherStatus | null>(null)
  const [togglingDispatcher, setTogglingDispatcher] = useState(false)
  const [activeView, setActiveViewState] = useState<ViewId>(readViewFromURL)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const setActiveView = useCallback((view: ViewId) => {
    setActiveViewState(view)
    const url = new URL(window.location.href)
    if (view === 'dashboard') url.searchParams.delete('view')
    else url.searchParams.set('view', view)
    window.history.pushState({}, '', url)
  }, [])

  useEffect(() => {
    const onPopState = () => setActiveViewState(readViewFromURL())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    let cancelled = false

    let lastStateJson = ''
    let lastTasksJson = ''

    async function loadState() {
      try {
        const response = await fetch('/api/openclaw/state', { cache: 'no-store' })
        if (!response.ok) throw new Error(`Request failed with ${response.status}`)
        const text = await response.text()
        if (!cancelled) {
          if (text !== lastStateJson) {
            lastStateJson = text
            setState(JSON.parse(text) as MissionControlState)
          }
          setError(null)
        }
      } catch (fetchError) {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : 'Failed to load Mission Control state.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    async function loadTasks() {
      try {
        const response = await fetch('/api/mission-control/tasks', { cache: 'no-store' })
        if (!response.ok) throw new Error(`Request failed with ${response.status}`)
        const text = await response.text()
        if (!cancelled) {
          if (text !== lastTasksJson) {
            lastTasksJson = text
            setTasks((JSON.parse(text) as { tasks: MissionTask[] }).tasks)
          }
          setTaskError(null)
        }
      } catch (fetchError) {
        if (!cancelled) setTaskError(fetchError instanceof Error ? fetchError.message : 'Failed to load tasks.')
      } finally {
        if (!cancelled) setTasksLoading(false)
      }
    }

    async function loadDispatcher() {
      try {
        const response = await fetch('/api/mission-control/dispatcher', { cache: 'no-store' })
        if (response.ok) {
          const data = (await response.json()) as DispatcherStatus
          if (!cancelled) setDispatcherStatus(data)
        }
      } catch { /* non-critical */ }
    }

    loadState()
    loadTasks()
    loadDispatcher()
    const interval = window.setInterval(() => { loadState(); loadTasks(); loadDispatcher() }, 15000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [])

  const metrics = useMemo(() => {
    if (!state) return []
    return [
      { label: 'Active Agents', value: String(state.metrics.activeAgents), hint: `${state.metrics.totalAgents} configured agents in OpenClaw`, icon: Bot },
      { label: 'Active Sessions', value: String(state.metrics.activeSessions), hint: `${state.metrics.totalSessions} known sessions on disk`, icon: Activity },
      { label: 'Warnings / Blockers', value: String(state.metrics.blockers), hint: 'Derived from gateway, agent stores, and session freshness', icon: state.metrics.blockers > 0 ? AlertCircle : CheckCircle2 },
      { label: 'ACP Runs', value: String(state.metrics.acpActiveRuns), hint: `${state.metrics.acpTotalRuns} recent Claude Code session${state.metrics.acpTotalRuns === 1 ? '' : 's'} detected`, icon: state.metrics.acpActiveRuns > 0 ? Zap : Terminal },
    ]
  }, [state])

  const agentsById = useMemo(() => new Map((state?.agents ?? []).map((a) => [a.id, a])), [state])
  const taskCounts = useMemo(() => TASK_STATUSES.map((s) => ({ ...s, count: tasks.filter((t) => t.status === s.id).length })), [tasks])

  const taskMetrics = useMemo(() => {
    const blocked = tasks.filter((t) => t.status === 'blocked').length
    const inFlight = tasks.filter((t) => t.status === 'doing' || t.status === 'ready').length
    const done = tasks.filter((t) => t.status === 'done').length
    const unassigned = tasks.filter((t) => !t.assignedAgent && t.status !== 'done').length
    return { blocked, inFlight, done, unassigned }
  }, [tasks])

  const tasksNeedingAttention = useMemo(() => {
    return tasks
      .filter((t) => t.status === 'blocked' || (t.status !== 'done' && !t.assignedAgent) || t.priority === 'high')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5)
  }, [tasks])

  const dashboardWarnings = useMemo(() => {
    if (!state) return []
    const items: Array<{ title: string; body: string; toneKey: ToneKey }> = []
    if (!state.gateway.ok) items.push({ title: 'Gateway needs attention', body: `${state.gateway.service} \u00b7 ${state.gateway.listening}`, toneKey: 'critical' })
    if (state.metrics.blockers > 0) items.push({ title: `${state.metrics.blockers} blocker${state.metrics.blockers === 1 ? '' : 's'} surfaced`, body: 'Derived from gateway warnings, agent stores, and stale session activity.', toneKey: state.metrics.blockers > 2 ? 'critical' : 'warning' })
    if (taskMetrics.blocked > 0) items.push({ title: `${taskMetrics.blocked} blocked task${taskMetrics.blocked === 1 ? '' : 's'}`, body: 'Execution is waiting on decisions, fixes, or owner action.', toneKey: 'warning' })
    if (taskMetrics.unassigned > 0) items.push({ title: `${taskMetrics.unassigned} unassigned active task${taskMetrics.unassigned === 1 ? '' : 's'}`, body: 'Work exists but does not yet have a clear owner.', toneKey: 'info' })
    return items.slice(0, 4)
  }, [state, taskMetrics])

  const topAgents = useMemo(() => [...(state?.agents ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || b.recentSessionCount - a.recentSessionCount).slice(0, 4), [state])
  const recentActivity = useMemo(() => (state?.recentSessions ?? []).slice(0, 5), [state])

  async function refreshTasks() {
    const response = await fetch('/api/mission-control/tasks', { cache: 'no-store' })
    if (!response.ok) throw new Error(`Request failed with ${response.status}`)
    const payload = (await response.json()) as { tasks: MissionTask[] }
    setTasks(payload.tasks)
    setTaskError(null)
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.title.trim()) { setTaskError('Task title is required.'); titleInputRef.current?.focus(); return }
    setSubmittingTask(true)
    try {
      const response = await fetch('/api/mission-control/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: form.title.trim(), description: form.description.trim(), priority: form.priority, status: form.status, assignedAgent: form.assignedAgent || null }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? `Task creation failed with ${response.status}`)
      }
      await refreshTasks()
      setForm(emptyTaskForm)
      setActiveView('tasks')
      toast.success('Task created')
    } catch (creationError) {
      const msg = creationError instanceof Error ? creationError.message : 'Failed to create task.'
      setTaskError(msg)
      toast.error(msg)
    } finally {
      setSubmittingTask(false)
    }
  }

  async function patchTask(taskId: string, patch: Partial<Pick<MissionTask, 'status' | 'priority' | 'assignedAgent' | 'title' | 'description'>>) {
    setSavingTaskId(taskId)
    try {
      const response = await fetch(`/api/mission-control/tasks/${taskId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? `Task update failed with ${response.status}`)
      }
      await refreshTasks()
      toast.success('Task updated')
    } catch (patchError) {
      const msg = patchError instanceof Error ? patchError.message : 'Failed to update task.'
      setTaskError(msg)
      toast.error(msg)
    } finally {
      setSavingTaskId(null)
    }
  }

  async function addComment(taskId: string, comment: { author: string; type: TaskCommentType; text: string }) {
    try {
      const response = await fetch(`/api/mission-control/tasks/${taskId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(comment),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? `Comment creation failed with ${response.status}`)
      }
      await refreshTasks()
      toast.success('Comment added')
    } catch (commentError) {
      const msg = commentError instanceof Error ? commentError.message : 'Failed to add comment.'
      toast.error(msg)
    }
  }

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [sessionsLimit, setSessionsLimit] = useState(20)

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [stateRes, tasksRes, dispRes] = await Promise.all([
        fetch('/api/openclaw/state', { cache: 'no-store' }),
        fetch('/api/mission-control/tasks', { cache: 'no-store' }),
        fetch('/api/mission-control/dispatcher', { cache: 'no-store' }),
      ])
      if (stateRes.ok) { const p = (await stateRes.json()) as MissionControlState; setState(p); setError(null) }
      if (tasksRes.ok) { const p = (await tasksRes.json()) as { tasks: MissionTask[] }; setTasks(p.tasks); setTaskError(null) }
      if (dispRes.ok) { setDispatcherStatus((await dispRes.json()) as DispatcherStatus) }
      toast.success('Data refreshed')
    } catch {
      toast.error('Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }, [])

  const refreshDispatcher = useCallback(async () => {
    try {
      const res = await fetch('/api/mission-control/dispatcher', { cache: 'no-store' })
      if (res.ok) setDispatcherStatus((await res.json()) as DispatcherStatus)
    } catch { /* ignore */ }
  }, [])

  const toggleDispatcher = useCallback(async () => {
    if (!dispatcherStatus) return
    setTogglingDispatcher(true)
    try {
      const action = dispatcherStatus.enabled ? 'disable' : 'enable'
      const res = await fetch(`/api/mission-control/dispatcher?action=${action}`, { method: 'POST' })
      if (res.ok) {
        await refreshDispatcher()
        toast.success(`Dispatcher ${action}d`)
      } else {
        toast.error(`Failed to ${action} dispatcher`)
      }
    } catch {
      toast.error('Failed to toggle dispatcher')
    } finally {
      setTogglingDispatcher(false)
    }
  }, [dispatcherStatus, refreshDispatcher])

  return (
    <SidebarProvider>
      {/* ── Sidebar ── */}
      <Sidebar variant="inset" className="border-white/8 bg-[#0a0a0c]">
        <SidebarHeader className="p-4">
          <div className="flex items-center gap-2.5">
            <Badge variant="outline" className="rounded-full border-orange-500/20 bg-orange-500/10 uppercase tracking-[0.2em] text-orange-300">
              <Wrench className="h-3 w-3" aria-hidden="true" /> MC
            </Badge>
            <span className="font-display text-sm font-semibold tracking-tight text-zinc-50">Mission Control</span>
          </div>
          {state && (
            <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
              <span className={`h-1.5 w-1.5 rounded-full ${state.gateway.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
              Updated {state.generatedLabel}
            </div>
          )}
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="text-zinc-500">Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={activeView === item.id}
                      onClick={() => setActiveView(item.id)}
                      tooltip={item.label}
                      className={activeView === item.id ? 'bg-cyan-500/15 text-cyan-200' : 'text-zinc-400'}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {item.id === 'tasks' && taskMetrics.inFlight > 0 && (
                      <SidebarMenuBadge className="bg-orange-500/10 text-orange-300">{taskMetrics.inFlight}</SidebarMenuBadge>
                    )}
                    {item.id === 'sessions' && state && state.metrics.acpActiveRuns > 0 && (
                      <SidebarMenuBadge className="bg-emerald-500/10 text-emerald-300">{state.metrics.acpActiveRuns} ACP</SidebarMenuBadge>
                    )}
                    {item.id === 'agents' && state && (
                      <SidebarMenuBadge className="text-zinc-500">{state.metrics.activeAgents}/{state.metrics.totalAgents}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {state && state.metrics.blockers > 0 && (
            <SidebarGroup>
              <SidebarGroupLabel className="text-zinc-500">Alerts</SidebarGroupLabel>
              <SidebarGroupContent>
                <div className="px-2">
                  <Alert className="border-orange-500/20 bg-orange-500/5">
                    <TriangleAlert className="h-3.5 w-3.5 text-orange-300" />
                    <AlertTitle className="text-orange-200 text-xs">{state.metrics.blockers} blocker{state.metrics.blockers === 1 ? '' : 's'}</AlertTitle>
                  </Alert>
                </div>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>

        <SidebarFooter className="p-3">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="outline" size="sm" onClick={handleManualRefresh} disabled={refreshing} className="w-full border-white/8 bg-white/[0.03] text-zinc-400 hover:text-zinc-200" />
              }
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Refresh</span>
            </TooltipTrigger>
            <TooltipContent side="right">Refresh all data</TooltipContent>
          </Tooltip>
        </SidebarFooter>
      </Sidebar>

      {/* ── Main content ── */}
      <SidebarInset className="bg-transparent">
        <header className="flex h-10 items-center gap-2 px-4 pt-2">
          <SidebarTrigger className="text-zinc-400" />
          {loading && !state && <Spinner className="text-orange-300" />}
        </header>

        <div className="flex-1 px-5 py-4 md:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-5">
            {error && !state ? (
              <Alert variant="destructive" className={cardClass}>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Could not load OpenClaw state</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Tabs value={activeView} onValueChange={(v) => setActiveView(v as ViewId)}>
              {/* Hidden TabsList for accessibility — actual nav is in sidebar */}
              <TabsList className="sr-only">
                {NAV_ITEMS.map((item) => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}
              </TabsList>

              {/* ══════════════════ DASHBOARD ══════════════════ */}
              <TabsContent value="dashboard">
                <div className="flex flex-col gap-5">
                  {loading && !state ? <LoadingSkeleton /> : state ? (
                    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      {metrics.map((m) => <StatCard key={m.label} {...m} />)}
                    </section>
                  ) : null}

                  <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                    <Card className={cardClass}>
                      <CardHeader>
                        <CardTitle className="text-base font-semibold" style={{ textWrap: 'balance' }}>At a Glance</CardTitle>
                        <CardAction>
                          <Button variant="outline" size="sm" onClick={() => setActiveView('tasks')} className="rounded-full border-orange-400/30 bg-orange-500/10 text-xs text-orange-200 hover:bg-orange-500/20 hover:text-orange-200">
                            Open Tasks <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </Button>
                        </CardAction>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-100">
                              <TriangleAlert className="h-3.5 w-3.5 text-orange-300" aria-hidden="true" /> Attention
                            </div>
                            <div className="space-y-2">
                              {dashboardWarnings.length === 0 ? (
                                <Alert className="border-emerald-500/20 bg-emerald-500/5">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" />
                                  <AlertDescription className="text-emerald-200">All clear &mdash; no issues detected.</AlertDescription>
                                </Alert>
                              ) : (
                                dashboardWarnings.map((w, i) => (
                                  <div key={`${w.title}-${i}`} className="rounded-xl border border-white/8 bg-[#111214] p-3">
                                    <Pill toneKey={w.toneKey}>{w.title}</Pill>
                                    <p className="mt-1.5 text-xs leading-5 text-zinc-400">{w.body}</p>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-100">
                              <KanbanSquare className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" /> Tasks
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { label: 'In Flight', value: taskMetrics.inFlight },
                                { label: 'Blocked', value: taskMetrics.blocked },
                                { label: 'Unassigned', value: taskMetrics.unassigned },
                                { label: 'Done', value: taskMetrics.done },
                              ].map((item) => (
                                <div key={item.label} className="rounded-xl border border-white/8 bg-[#111214] p-3">
                                  <div className="text-xs uppercase tracking-[0.15em] text-zinc-500">{item.label}</div>
                                  <div className="font-display mt-1 text-xl font-semibold text-zinc-50" style={{ fontVariantNumeric: 'tabular-nums' }}>{item.value}</div>
                                </div>
                              ))}
                            </div>
                            <Button variant="link" size="sm" onClick={() => setActiveView('tasks')} className="mt-3 h-auto p-0 text-xs text-cyan-300 hover:text-cyan-200">
                              Full board <ChevronRight className="h-3 w-3" aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className={cardClass}>
                      <CardHeader><CardTitle className="text-base font-semibold" style={{ textWrap: 'balance' }}>Focus</CardTitle></CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                            <div className="mb-2 text-sm font-medium text-zinc-100">Where attention should go</div>
                            <ItemGroup>
                              {(state?.focus ?? []).length === 0 ? (
                                <Empty className="border border-dashed border-white/8 py-4"><EmptyHeader><EmptyTitle className="text-zinc-500">No focus items right now.</EmptyTitle></EmptyHeader></Empty>
                              ) : (
                                (state?.focus ?? []).slice(0, 4).map((item, i) => (
                                  <Item key={`${item}-${i}`} variant="outline" size="sm" className="border-white/8 bg-[#111214]">
                                    <ItemContent><ItemDescription className="text-zinc-400">{item}</ItemDescription></ItemContent>
                                  </Item>
                                ))
                              )}
                            </ItemGroup>
                          </div>

                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                            <div className="mb-2 text-sm font-medium text-zinc-100">Gateway</div>
                            <div className="space-y-2 text-sm text-zinc-400">
                              <div className="flex items-center justify-between"><span>Service</span><span className="font-display text-xs text-zinc-200">{state?.gateway.service}</span></div>
                              <div className="flex items-center justify-between"><span>Listening</span><span className="font-display text-xs text-zinc-200">{state?.gateway.listening}</span></div>
                              <div className="flex items-center justify-between"><span>Channels</span><span className="text-zinc-200" style={{ fontVariantNumeric: 'tabular-nums' }}>{state?.channels.filter((c) => c.enabled).length ?? 0} enabled</span></div>
                            </div>
                            <Button variant="link" size="sm" onClick={() => setActiveView('system')} className="mt-3 h-auto p-0 text-xs text-cyan-300 hover:text-cyan-200">
                              System details <ChevronRight className="h-3 w-3" aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </section>

                  {/* ── ACP Activity ── */}
                  {state && (state.acpRuns.totalActive > 0 || state.acpRuns.recent.length > 0) && (
                    <Card className={cardClass}>
                      <CardHeader>
                        <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ textWrap: 'balance' }}>
                          <Zap className="h-4 w-4 text-cyan-300" aria-hidden="true" /> ACP Activity
                          {state.acpRuns.totalActive > 0 && (
                            <Badge variant="outline" className="ml-1 rounded-full border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-[10px] font-medium px-2">
                              {state.acpRuns.totalActive} running
                            </Badge>
                          )}
                        </CardTitle>
                        <CardAction>
                          <Button variant="link" size="sm" onClick={() => setActiveView('sessions')} className="h-auto p-0 text-xs text-cyan-300 hover:text-cyan-200">
                            All runs <ChevronRight className="h-3 w-3" aria-hidden="true" />
                          </Button>
                        </CardAction>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {state.acpRuns.active.map((run) => (
                            <div key={run.sessionId} className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.03] p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="relative flex h-2 w-2">
                                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                                    </span>
                                    <span className="text-xs font-medium text-emerald-300 uppercase tracking-wider">Running</span>
                                    <span className="text-[10px] text-zinc-500 font-display">{run.harness}</span>
                                  </div>
                                  <p className="text-sm text-zinc-200 truncate">{run.task}</p>
                                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                                    {run.project && <span className="flex items-center gap-1"><FolderGit2 className="h-3 w-3" />{run.project.split('/').slice(-2).join('/')}</span>}
                                    {run.model && <span className="font-display">{run.model}</span>}
                                  </div>
                                </div>
                                <div className="shrink-0 text-right">
                                  <div className="text-xs text-zinc-400 font-display tabular-nums">{run.elapsed}</div>
                                  <div className="text-[10px] text-zinc-500">{run.startedLabel}</div>
                                </div>
                              </div>
                            </div>
                          ))}
                          {state.acpRuns.recent.slice(0, 3).map((run) => (
                            <div key={run.sessionId} className="rounded-xl border border-white/7 bg-white/[0.02] p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <Pill toneKey={run.status === 'idle' ? 'info' : 'inactive'}>{run.status === 'idle' ? 'Idle' : 'Completed'}</Pill>
                                    <span className="text-[10px] text-zinc-500 font-display">{run.harness}</span>
                                  </div>
                                  <p className="text-sm text-zinc-300 truncate">{run.task}</p>
                                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                                    {run.project && <span className="flex items-center gap-1"><FolderGit2 className="h-3 w-3" />{run.project.split('/').slice(-2).join('/')}</span>}
                                    {run.model && <span className="font-display">{run.model}</span>}
                                  </div>
                                </div>
                                <span className="shrink-0 text-xs text-zinc-500">{run.lastUpdatedLabel}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* ── Dispatcher Status ── */}
                  {dispatcherStatus && (
                    <Card className={cardClass}>
                      <CardHeader>
                        <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ textWrap: 'balance' }}>
                          <Radio className="h-4 w-4 text-violet-300" aria-hidden="true" /> Dispatcher
                          <Pill toneKey={dispatcherStatus.enabled ? 'active' : 'inactive'}>
                            {dispatcherStatus.enabled ? 'Enabled' : 'Disabled'}
                          </Pill>
                        </CardTitle>
                        <CardAction>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={toggleDispatcher}
                            disabled={togglingDispatcher}
                            className={`rounded-full text-xs ${dispatcherStatus.enabled ? 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20 hover:text-zinc-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200'}`}
                          >
                            {dispatcherStatus.enabled ? <><Pause className="h-3 w-3" /> Disable</> : <><Play className="h-3 w-3" /> Enable</>}
                          </Button>
                        </CardAction>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-4 md:grid-cols-3">
                          {/* Agent Occupancy */}
                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-100">
                              <Bot className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" /> Agent Occupancy
                            </div>
                            <div className="space-y-2">
                              {dispatcherStatus.agentOccupancy.length === 0 ? (
                                <p className="text-xs text-zinc-500">No known agents</p>
                              ) : (
                                dispatcherStatus.agentOccupancy.map((a) => (
                                  <div key={a.agentId} className="flex items-center justify-between rounded-xl border border-white/8 bg-[#111214] p-2.5">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className={`h-1.5 w-1.5 rounded-full ${a.busy ? 'bg-orange-400' : 'bg-emerald-400'}`} />
                                        <span className="text-xs font-medium text-zinc-200">{a.agentId}</span>
                                      </div>
                                      {a.busy && a.activeTaskTitle && (
                                        <p className="mt-1 ml-3.5 text-[11px] text-zinc-500 truncate">{a.activeTaskTitle}</p>
                                      )}
                                    </div>
                                    <Pill toneKey={a.busy ? 'warning' : 'active'}>{a.busy ? 'Busy' : 'Free'}</Pill>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          {/* Queue */}
                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-100">
                              <Clock className="h-3.5 w-3.5 text-orange-300" aria-hidden="true" /> Queue
                              {dispatcherStatus.queue.length > 0 && (
                                <Badge variant="outline" className="ml-1 rounded-full border-orange-500/20 bg-orange-500/10 text-orange-300 text-[10px] font-medium px-2">
                                  {dispatcherStatus.queue.length}
                                </Badge>
                              )}
                            </div>
                            <div className="space-y-2">
                              {dispatcherStatus.queue.length === 0 ? (
                                <p className="text-xs text-zinc-500">Queue is empty</p>
                              ) : (
                                dispatcherStatus.queue.slice(0, 4).map((q) => (
                                  <div key={q.taskId} className="rounded-xl border border-white/8 bg-[#111214] p-2.5">
                                    <div className="text-xs font-medium text-zinc-200 truncate">{q.title}</div>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                                      <span className="text-zinc-500">{q.assignedAgent}</span>
                                      <span className="text-zinc-600">&middot;</span>
                                      <span className="text-zinc-400">{q.waitReason}</span>
                                    </div>
                                    {q.lastDispatchError && (
                                      <p className="mt-1 text-[10px] text-red-400 truncate">{q.lastDispatchError}</p>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          {/* Recent Outcomes */}
                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-100">
                              <Zap className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> Recent Outcomes
                            </div>
                            <div className="space-y-2">
                              {dispatcherStatus.lastOutcomes.length === 0 ? (
                                <p className="text-xs text-zinc-500">No recent dispatch outcomes</p>
                              ) : (
                                dispatcherStatus.lastOutcomes.slice(0, 5).map((o, i) => {
                                  const outcomeTone: ToneKey = o.outcome === 'dispatched' ? 'active' : o.outcome === 'error' ? 'critical' : o.outcome === 'blocked' ? 'warning' : 'inactive'
                                  return (
                                    <div key={`${o.taskId}-${i}`} className="rounded-xl border border-white/8 bg-[#111214] p-2.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-medium text-zinc-200 truncate flex-1">{o.taskTitle || o.taskId}</span>
                                        <Pill toneKey={outcomeTone}>{o.outcome}</Pill>
                                      </div>
                                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
                                        <span>{o.agentId}</span>
                                        {o.at && <><span>&middot;</span><span>{formatRelativeTime(o.at)}</span></>}
                                      </div>
                                      {o.message && o.outcome !== 'dispatched' && (
                                        <p className="mt-1 text-[10px] text-zinc-400 truncate">{o.message}</p>
                                      )}
                                    </div>
                                  )
                                })
                              )}
                            </div>
                          </div>
                        </div>
                        {dispatcherStatus.lastEvalAt && (
                          <p className="mt-3 text-[11px] text-zinc-600">Last eval: {formatRelativeTime(dispatcherStatus.lastEvalAt)}</p>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  <section className="grid gap-5 xl:grid-cols-2">
                    {/* Recent Activity */}
                    <Card className={cardClass}>
                      <CardHeader>
                        <CardTitle className="text-base font-semibold" style={{ textWrap: 'balance' }}>Recent Activity</CardTitle>
                        <CardAction><Button variant="link" size="sm" onClick={() => setActiveView('sessions')} className="h-auto p-0 text-xs text-cyan-300 hover:text-cyan-200">All sessions</Button></CardAction>
                      </CardHeader>
                      <CardContent>
                        {recentActivity.length === 0 ? (
                          <Empty className="border border-dashed border-white/8">
                            <EmptyHeader>
                              <EmptyMedia variant="icon"><Activity className="text-zinc-500" /></EmptyMedia>
                              <EmptyTitle className="text-zinc-500">No recent sessions</EmptyTitle>
                              <EmptyDescription>Activity will appear here as agents run.</EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        ) : (
                          <ItemGroup>
                            {recentActivity.map((s) => (
                              <Item key={s.sessionKey} variant="outline" size="sm" className="border-white/7 bg-white/[0.02] hover:border-white/12">
                                <ItemContent>
                                  <ItemTitle className="text-zinc-100">
                                    {s.agentId}
                                    <Pill toneKey={s.isRecent ? 'active' : 'inactive'}>{s.isRecent ? 'Recent' : 'Older'}</Pill>
                                  </ItemTitle>
                                  <ItemDescription className="text-zinc-400">{s.label ?? s.sessionKey}</ItemDescription>
                                </ItemContent>
                                <ItemActions><span className="text-xs text-zinc-500">{s.updatedLabel}</span></ItemActions>
                              </Item>
                            ))}
                          </ItemGroup>
                        )}
                      </CardContent>
                    </Card>

                    {/* Agent Roster */}
                    <Card className={cardClass}>
                      <CardHeader>
                        <CardTitle className="text-base font-semibold" style={{ textWrap: 'balance' }}>Agent Roster</CardTitle>
                        <CardAction><Button variant="link" size="sm" onClick={() => setActiveView('agents')} className="h-auto p-0 text-xs text-cyan-300 hover:text-cyan-200">All agents</Button></CardAction>
                      </CardHeader>
                      <CardContent>
                        {topAgents.length === 0 ? (
                          <Empty className="border border-dashed border-white/8">
                            <EmptyHeader>
                              <EmptyMedia variant="icon"><Bot className="text-zinc-500" /></EmptyMedia>
                              <EmptyTitle className="text-zinc-500">No agents configured</EmptyTitle>
                              <EmptyDescription>Register agents in OpenClaw to see them here.</EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        ) : (
                          <ItemGroup>
                            {topAgents.map((a) => (
                              <Item key={a.id} variant="outline" size="sm" className="border-white/7 bg-white/[0.02] hover:border-white/12">
                                <ItemContent>
                                  <ItemTitle className="text-zinc-100">
                                    <AgentIdentityLabel agent={a} className="mr-2" />
                                    <Pill toneKey={a.active ? 'active' : 'inactive'}>{a.active ? 'Active' : 'Idle'}</Pill>
                                  </ItemTitle>
                                  <ItemDescription className="text-zinc-400">{a.activeReason}</ItemDescription>
                                </ItemContent>
                                <ItemActions><span className="text-xs text-zinc-500" style={{ fontVariantNumeric: 'tabular-nums' }}>{a.recentSessionCount} recent</span></ItemActions>
                              </Item>
                            ))}
                          </ItemGroup>
                        )}
                      </CardContent>
                    </Card>
                  </section>

                  {tasksNeedingAttention.length > 0 && (
                    <Card className={cardClass}>
                      <CardHeader>
                        <CardTitle className="text-base font-semibold" style={{ textWrap: 'balance' }}>Tasks Needing Attention</CardTitle>
                        <CardAction><Button variant="link" size="sm" onClick={() => setActiveView('tasks')} className="h-auto p-0 text-xs text-cyan-300 hover:text-cyan-200">Full board</Button></CardAction>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-2 lg:grid-cols-2">
                          {tasksNeedingAttention.map((t) => (
                            <button key={t.id} type="button" onClick={() => setActiveView('tasks')} className="rounded-xl border border-white/7 bg-white/[0.02] p-3 text-left transition-colors hover:border-white/12 hover:bg-white/[0.04]">
                              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                                <TaskPill className={`border ${STATUS_ACCENTS[t.status]} bg-white/[0.03] text-zinc-300`}>{TASK_STATUSES.find((s) => s.id === t.status)?.label}</TaskPill>
                                <TaskPill className={PRIORITY_TONES[t.priority]}>{t.priority}</TaskPill>
                              </div>
                              <div className="text-sm font-medium text-zinc-100">{t.title}</div>
                              <div className="mt-1 text-xs text-zinc-400">{t.assignedAgent ? `Owner: ${t.assignedAgent}` : 'Unassigned'}</div>
                            </button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              {/* ══════════════════ TASKS ══════════════════ */}
              <TabsContent value="tasks">
                <section className="flex flex-col gap-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-zinc-50" style={{ textWrap: 'balance' }}>Task Management</h2>
                    <Button variant="outline" size="sm" onClick={() => setShowCreateForm(!showCreateForm)} className="rounded-full border-orange-400/30 bg-orange-500/10 text-xs text-orange-200 hover:bg-orange-500/20 hover:text-orange-200">
                      {showCreateForm ? 'Hide form' : (<><Plus className="h-3 w-3" aria-hidden="true" /> New Task</>)}
                    </Button>
                  </div>

                  {showCreateForm && (
                    <Card className={cardClass}>
                      <CardContent>
                        <form className="grid gap-3" onSubmit={createTask}>
                          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                            <div className="grid gap-1.5">
                              <Label className="text-xs text-zinc-300">Title</Label>
                              <Input ref={titleInputRef} name="title" autoComplete="off" className="rounded-xl border-white/10 bg-white/[0.03] text-zinc-100 focus:border-cyan-400/50" value={form.title} onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))} placeholder="What needs doing&hellip;" />
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="text-xs text-zinc-300">Notes</Label>
                              <Input name="description" autoComplete="off" className="rounded-xl border-white/10 bg-white/[0.03] text-zinc-100 focus:border-cyan-400/50" value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} placeholder="Context, constraints&hellip;" />
                            </div>
                          </div>
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="grid gap-1.5">
                              <Label className="text-xs text-zinc-400">Status</Label>
                              <NativeSelect value={form.status} onChange={(e) => setForm((c) => ({ ...c, status: e.target.value as MissionTaskStatus }))}>
                                {TASK_STATUSES.map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.label}</NativeSelectOption>)}
                              </NativeSelect>
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="text-xs text-zinc-400">Priority</Label>
                              <NativeSelect value={form.priority} onChange={(e) => setForm((c) => ({ ...c, priority: e.target.value as MissionTaskPriority }))}>
                                <NativeSelectOption value="low">Low</NativeSelectOption>
                                <NativeSelectOption value="medium">Medium</NativeSelectOption>
                                <NativeSelectOption value="high">High</NativeSelectOption>
                              </NativeSelect>
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="text-xs text-zinc-400">Agent</Label>
                              <NativeSelect value={form.assignedAgent} onChange={(e) => setForm((c) => ({ ...c, assignedAgent: e.target.value }))}>
                                <NativeSelectOption value="">Unassigned</NativeSelectOption>
                                {(state?.agents ?? []).map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}
                              </NativeSelect>
                            </div>
                            <Button type="submit" disabled={submittingTask} className="border-orange-400/40 bg-orange-500/10 text-orange-200 hover:bg-orange-500/20">
                              {submittingTask ? (<><Spinner className="text-orange-200" /> Creating&hellip;</>) : 'Create'}
                            </Button>
                          </div>
                        </form>
                        {taskError ? (
                          <Alert variant="destructive" className="mt-3 border-red-500/20 bg-red-500/10">
                            <AlertDescription className="text-red-200">{taskError}</AlertDescription>
                          </Alert>
                        ) : null}
                      </CardContent>
                    </Card>
                  )}

                  <TaskBoard tasks={tasks} tasksLoading={tasksLoading} taskError={taskError} savingTaskId={savingTaskId} state={state} agentsById={agentsById} taskCounts={taskCounts} patchTask={patchTask} addComment={addComment} />
                </section>
              </TabsContent>

              {/* ══════════════════ AGENTS ══════════════════ */}
              <TabsContent value="agents">
                {state && (
                  <Card className={cardClass}>
                    <CardHeader><CardTitle className="text-base font-semibold" style={{ textWrap: 'balance' }}>Agent Roster</CardTitle></CardHeader>
                    <CardContent>
                      {state.agents.length === 0 ? (
                        <Empty className="border border-dashed border-white/8">
                          <EmptyHeader>
                            <EmptyMedia variant="icon"><Bot className="text-zinc-500" /></EmptyMedia>
                            <EmptyTitle className="text-zinc-400">No agents registered</EmptyTitle>
                            <EmptyDescription>Add agents to your OpenClaw configuration to see them here.</EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      ) : (
                        <ItemGroup>
                          {state.agents.map((agent) => (
                            <AgentDetailDialog key={agent.id} agent={agent} />
                          ))}
                        </ItemGroup>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ══════════════════ SESSIONS ══════════════════ */}
              <TabsContent value="sessions">
                {state && (
                  <div className="flex flex-col gap-5">
                    {/* ── ACP Runs ── */}
                    <Card className={cardClass}>
                      <CardHeader>
                        <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ textWrap: 'balance' }}>
                          <Zap className="h-4 w-4 text-cyan-300" aria-hidden="true" /> ACP Runs
                          {state.acpRuns.totalActive > 0 && (
                            <Badge variant="outline" className="ml-1 rounded-full border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-[10px] font-medium px-2">
                              {state.acpRuns.totalActive} active
                            </Badge>
                          )}
                        </CardTitle>
                        <CardAction>
                          <span className="text-xs text-zinc-500">{state.metrics.acpTotalRuns} session{state.metrics.acpTotalRuns === 1 ? '' : 's'} detected</span>
                        </CardAction>
                      </CardHeader>
                      <CardContent>
                        {state.acpRuns.active.length === 0 && state.acpRuns.recent.length === 0 ? (
                          <Empty className="border border-dashed border-white/8">
                            <EmptyHeader>
                              <EmptyMedia variant="icon"><Zap className="text-zinc-500" /></EmptyMedia>
                              <EmptyTitle className="text-zinc-400">No ACP runs detected</EmptyTitle>
                              <EmptyDescription>Claude Code and other ACP sessions will appear here when active.</EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        ) : (
                          <ItemGroup>
                            {[...state.acpRuns.active, ...state.acpRuns.recent].map((run) => (
                              <Item key={run.sessionId} variant="outline" className="border-white/7 bg-white/[0.02] hover:border-white/12 flex-col items-stretch">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <ItemTitle className="text-zinc-100 flex-wrap gap-2">
                                      {run.status === 'running' ? (
                                        <span className="inline-flex items-center gap-1.5">
                                          <span className="relative flex h-2 w-2">
                                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                                          </span>
                                          <span className="text-emerald-300 text-xs font-medium">Running</span>
                                        </span>
                                      ) : (
                                        <Pill toneKey={run.status === 'idle' ? 'info' : 'inactive'}>{run.status === 'idle' ? 'Idle' : 'Completed'}</Pill>
                                      )}
                                      <span className="text-[10px] text-zinc-500 font-display uppercase tracking-wider">{run.harness}</span>
                                    </ItemTitle>
                                    <ItemDescription className="text-zinc-300 mt-1">{run.task}</ItemDescription>
                                  </div>
                                  <div className="shrink-0 text-right">
                                    {run.status === 'running' && <div className="text-xs font-display text-cyan-300 tabular-nums">{run.elapsed}</div>}
                                    <span className="text-xs text-zinc-500">{run.lastUpdatedLabel}</span>
                                  </div>
                                </div>
                                <Separator className="my-1.5 bg-white/5" />
                                <div className="grid gap-1.5 text-xs text-zinc-400 md:grid-cols-2">
                                  <div><span className="text-zinc-500">Session:</span> <span className="font-display">{run.sessionId.slice(0, 8)}</span></div>
                                  <div><span className="text-zinc-500">Model:</span> <span className="font-display">{run.model ?? '\u2014'}</span></div>
                                  {run.project && <div className="flex items-center gap-1"><span className="text-zinc-500">Project:</span> <span className="font-display truncate">{run.project}</span></div>}
                                  {run.gitBranch && <div><span className="text-zinc-500">Branch:</span> <span className="font-display">{run.gitBranch}</span></div>}
                                  {run.workingDirectory && <div className="md:col-span-2"><span className="text-zinc-500">CWD:</span> <span className="font-display truncate">{run.workingDirectory}</span></div>}
                                  {run.version && <div><span className="text-zinc-500">Version:</span> <span className="font-display">{run.version}</span></div>}
                                  {run.status !== 'running' && <div><span className="text-zinc-500">Duration:</span> <span className="font-display tabular-nums">{run.elapsed}</span></div>}
                                </div>
                              </Item>
                            ))}
                          </ItemGroup>
                        )}
                      </CardContent>
                    </Card>

                    {/* ── OpenClaw Sessions ── */}
                    <Card className={cardClass}>
                      <CardHeader><CardTitle className="text-base font-semibold" style={{ textWrap: 'balance' }}>Recent Sessions</CardTitle></CardHeader>
                    <CardContent>
                      {state.recentSessions.length === 0 ? (
                        <Empty className="border border-dashed border-white/8">
                          <EmptyHeader>
                            <EmptyMedia variant="icon"><Activity className="text-zinc-500" /></EmptyMedia>
                            <EmptyTitle className="text-zinc-400">No sessions recorded yet</EmptyTitle>
                            <EmptyDescription>Sessions will appear here as agents run.</EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      ) : (
                        <ItemGroup>
                          {state.recentSessions.slice(0, sessionsLimit).map((s) => (
                            <Item key={s.sessionKey} variant="outline" className="border-white/7 bg-white/[0.02] hover:border-white/12 flex-col items-stretch">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <ItemTitle className="text-zinc-100 flex-wrap">
                                    {s.agentId} <span className="text-zinc-500">/</span> <span className="font-display text-xs">{s.sessionId}</span>
                                    <Pill toneKey={s.isRecent ? 'active' : 'inactive'}>{s.isRecent ? 'Recent' : 'Older'}</Pill>
                                  </ItemTitle>
                                  <ItemDescription className="text-zinc-400">{s.label ?? s.sessionKey}</ItemDescription>
                                </div>
                                <span className="shrink-0 text-xs text-zinc-400">{s.updatedLabel}</span>
                              </div>
                              <Separator className="my-1 bg-white/5" />
                              <div className="grid gap-1.5 text-xs text-zinc-400 md:grid-cols-2">
                                <div><span className="text-zinc-500">Channel:</span> {s.channel}</div>
                                <div><span className="text-zinc-500">Model:</span> <span className="font-display">{s.model}</span></div>
                                <div><span className="text-zinc-500">Depth:</span> <span style={{ fontVariantNumeric: 'tabular-nums' }}>{s.spawnDepth}</span></div>
                                <div className="min-w-0"><span className="text-zinc-500">File:</span> <span className="font-display truncate">{s.sessionFile ?? '\u2014'}</span></div>
                              </div>
                            </Item>
                          ))}
                          {state.recentSessions.length > sessionsLimit && (
                            <Button variant="outline" onClick={() => setSessionsLimit((n) => n + 20)} className="w-full border-dashed border-white/8 text-zinc-400 hover:border-white/15 hover:text-zinc-200">
                              Show more ({state.recentSessions.length - sessionsLimit} remaining)
                            </Button>
                          )}
                        </ItemGroup>
                      )}
                    </CardContent>
                  </Card>
                  </div>
                )}
              </TabsContent>

              {/* ══════════════════ SYSTEM ══════════════════ */}
              <TabsContent value="system">
                {state && (
                  <section className="grid gap-5 xl:grid-cols-2">
                    <div className="flex flex-col gap-5">
                      {/* ── Dispatcher Detail ── */}
                      <Card className={cardClass}>
                        <CardHeader>
                          <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ textWrap: 'balance' }}>
                            <Radio className="h-4 w-4 text-violet-300" aria-hidden="true" /> Dispatcher
                          </CardTitle>
                          <CardAction>
                            {dispatcherStatus && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={toggleDispatcher}
                                disabled={togglingDispatcher}
                                className={`rounded-full text-xs ${dispatcherStatus.enabled ? 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-red-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200'}`}
                              >
                                <Power className="h-3 w-3" />
                                {dispatcherStatus.enabled ? 'Disable' : 'Enable'}
                              </Button>
                            )}
                          </CardAction>
                        </CardHeader>
                        <CardContent>
                          {dispatcherStatus ? (
                            <div className="space-y-4">
                              <div className="grid gap-2 text-sm text-zinc-300">
                                <div className="flex items-center justify-between">
                                  <span className="text-zinc-500">Status</span>
                                  <Pill toneKey={dispatcherStatus.enabled ? 'active' : 'inactive'}>{dispatcherStatus.enabled ? 'Enabled' : 'Disabled'}</Pill>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-zinc-500">Known Agents</span>
                                  <span className="font-display text-xs text-zinc-200">{dispatcherStatus.knownAgents.join(', ')}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-zinc-500">Last Eval</span>
                                  <span className="font-display text-xs text-zinc-200">{dispatcherStatus.lastEvalAt ? formatRelativeTime(dispatcherStatus.lastEvalAt) : 'never'}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-zinc-500">Queue Size</span>
                                  <span className="font-display text-xs text-zinc-200" style={{ fontVariantNumeric: 'tabular-nums' }}>{dispatcherStatus.queue.length}</span>
                                </div>
                              </div>
                              <Separator className="bg-white/8" />
                              <div>
                                <div className="mb-2 text-sm font-medium text-zinc-100">Agent Occupancy</div>
                                <ItemGroup>
                                  {dispatcherStatus.agentOccupancy.map((a) => (
                                    <Item key={a.agentId} variant="outline" size="sm" className="border-white/7 bg-white/[0.02]">
                                      <ItemContent>
                                        <ItemTitle className="text-zinc-100 flex items-center gap-2">
                                          <span className={`h-1.5 w-1.5 rounded-full ${a.busy ? 'bg-orange-400' : 'bg-emerald-400'}`} />
                                          {a.agentId}
                                        </ItemTitle>
                                        <ItemDescription className="text-zinc-400">
                                          {a.busy ? (a.activeTaskTitle ?? 'Working on a task') : 'Available for dispatch'}
                                        </ItemDescription>
                                      </ItemContent>
                                      <ItemActions>
                                        <Pill toneKey={a.busy ? 'warning' : 'active'}>{a.busy ? 'Busy' : 'Free'}</Pill>
                                      </ItemActions>
                                    </Item>
                                  ))}
                                </ItemGroup>
                              </div>
                              {dispatcherStatus.queue.length > 0 && (
                                <>
                                  <Separator className="bg-white/8" />
                                  <div>
                                    <div className="mb-2 text-sm font-medium text-zinc-100">Queued Tasks</div>
                                    <ItemGroup>
                                      {dispatcherStatus.queue.map((q) => (
                                        <Item key={q.taskId} variant="outline" size="sm" className="border-white/7 bg-white/[0.02] flex-col items-stretch">
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm text-zinc-100 truncate">{q.title}</span>
                                            <TaskPill className={PRIORITY_TONES[q.priority as MissionTaskPriority] ?? PRIORITY_TONES.medium}>{q.priority}</TaskPill>
                                          </div>
                                          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mt-1">
                                            <span>{q.assignedAgent}</span>
                                            <span className="text-zinc-600">&middot;</span>
                                            <span>{q.waitReason}</span>
                                            {q.dispatchAttempts > 0 && (
                                              <><span className="text-zinc-600">&middot;</span><span>{q.dispatchAttempts} attempt{q.dispatchAttempts !== 1 ? 's' : ''}</span></>
                                            )}
                                          </div>
                                          {q.lastDispatchError && (
                                            <p className="mt-1 text-[11px] text-red-400">{q.lastDispatchError}</p>
                                          )}
                                        </Item>
                                      ))}
                                    </ItemGroup>
                                  </div>
                                </>
                              )}
                              {dispatcherStatus.lastOutcomes.length > 0 && (
                                <>
                                  <Separator className="bg-white/8" />
                                  <div>
                                    <div className="mb-2 text-sm font-medium text-zinc-100">Last Dispatch Cycle</div>
                                    <ItemGroup>
                                      {dispatcherStatus.lastOutcomes.map((o, i) => {
                                        const outcomeTone: ToneKey = o.outcome === 'dispatched' ? 'active' : o.outcome === 'error' ? 'critical' : o.outcome === 'blocked' ? 'warning' : 'inactive'
                                        return (
                                          <Item key={`${o.taskId}-${i}`} variant="outline" size="sm" className="border-white/7 bg-white/[0.02]">
                                            <ItemContent>
                                              <ItemTitle className="text-zinc-100">{o.taskTitle || o.taskId}</ItemTitle>
                                              <ItemDescription className="text-zinc-400">
                                                {o.agentId}{o.message ? ` \u2014 ${o.message}` : ''}
                                              </ItemDescription>
                                            </ItemContent>
                                            <ItemActions>
                                              <Pill toneKey={outcomeTone}>{o.outcome}</Pill>
                                            </ItemActions>
                                          </Item>
                                        )
                                      })}
                                    </ItemGroup>
                                  </div>
                                </>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-zinc-500">Dispatcher data unavailable.</p>
                          )}
                        </CardContent>
                      </Card>

                      <Card className={cardClass}>
                        <CardHeader><CardTitle className="text-base font-semibold" style={{ textWrap: 'balance' }}>Gateway &amp; Channels</CardTitle></CardHeader>
                        <CardContent>
                          <div className="grid gap-2 text-sm text-zinc-300">
                            <div><span className="text-zinc-500">Service:</span> <span className="font-display text-xs">{state.gateway.service}</span></div>
                            <div><span className="text-zinc-500">Runtime:</span> <span className="font-display text-xs">{state.gateway.runtime}</span></div>
                            <div><span className="text-zinc-500">Listening:</span> <span className="font-display text-xs">{state.gateway.listening}</span></div>
                            <div><span className="text-zinc-500">Logs:</span> <span className="font-display text-xs">{state.gateway.logs}</span></div>
                          </div>
                          <Separator className="my-4 bg-white/8" />
                          <ItemGroup>
                            {state.channels.map((ch) => (
                              <Item key={ch.id} variant="outline" size="sm" className="border-white/7 bg-white/[0.02] hover:border-white/12">
                                <ItemContent>
                                  <ItemTitle className="font-display text-xs text-zinc-100">{ch.id}</ItemTitle>
                                  <ItemDescription className="text-zinc-400">
                                    Mode: {ch.mode} &middot; DM: {ch.dmPolicy} &middot; Group: {ch.groupPolicy}
                                  </ItemDescription>
                                </ItemContent>
                                <ItemActions>
                                  <Pill toneKey={ch.enabled ? 'active' : 'inactive'}>{ch.enabled ? 'On' : 'Off'}</Pill>
                                </ItemActions>
                              </Item>
                            ))}
                          </ItemGroup>
                        </CardContent>
                      </Card>

                      <Card className={cardClass}>
                        <CardHeader><CardTitle className="text-base font-semibold" style={{ textWrap: 'balance' }}>Blockers &amp; Warnings</CardTitle></CardHeader>
                        <CardContent>
                          {state.blockers.length === 0 ? (
                            <Empty className="border border-dashed border-white/8">
                              <EmptyHeader>
                                <EmptyMedia variant="icon"><CheckCircle2 className="text-emerald-400" /></EmptyMedia>
                                <EmptyTitle className="text-zinc-400">No blockers detected</EmptyTitle>
                              </EmptyHeader>
                            </Empty>
                          ) : (
                            <ItemGroup>
                              {state.blockers.slice(0, 8).map((b, i) => {
                                const toneKey: ToneKey = b.severity === 'critical' ? 'critical' : b.severity === 'info' ? 'info' : 'warning'
                                const isLong = b.message.length > 200
                                return (
                                  <Item key={`${b.source}-${i}`} variant="outline" className="border-white/7 bg-white/[0.02] flex-col items-stretch">
                                    <div className="flex items-center gap-2 text-sm">
                                      <Pill toneKey={toneKey}>{b.severity}</Pill>
                                      <span className="text-xs text-zinc-400">{b.source}</span>
                                    </div>
                                    {isLong ? (
                                      <Collapsible>
                                        <CollapsibleTrigger className="cursor-pointer text-sm leading-5 text-zinc-300">{b.message.slice(0, 120)}&hellip;</CollapsibleTrigger>
                                        <CollapsibleContent>
                                          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-black/30 p-3 text-xs leading-5 text-zinc-400 whitespace-pre-wrap break-all">{b.message}</pre>
                                        </CollapsibleContent>
                                      </Collapsible>
                                    ) : (
                                      <p className="text-sm leading-5 text-zinc-300">{b.message}</p>
                                    )}
                                  </Item>
                                )
                              })}
                            </ItemGroup>
                          )}
                        </CardContent>
                      </Card>
                    </div>

                    <Card className={cardClass}>
                      <CardHeader><CardTitle className="text-base font-semibold" style={{ textWrap: 'balance' }}>Data Sources &amp; Status</CardTitle></CardHeader>
                      <CardContent>
                        <div className="space-y-4 text-sm leading-5 text-zinc-300">
                          <div>
                            <div className="mb-1.5 font-medium text-zinc-100">Live Data</div>
                            <ul className="space-y-1 text-xs text-zinc-400">
                              <li>Agent registry from <code className="font-display text-zinc-300">~/.openclaw/openclaw.json</code></li>
                              <li>Sessions from <code className="font-display text-zinc-300">~/.openclaw/agents/*</code></li>
                              <li>Gateway from <code className="font-display text-zinc-300">openclaw gateway status</code> + logs</li>
                              <li>ACP runs from <code className="font-display text-zinc-300">~/.claude/projects/*</code></li>
                              <li>Tasks from local SQLite store</li>
                            </ul>
                          </div>
                          <Separator className="bg-white/8" />
                          <div>
                            <div className="mb-1.5 font-medium text-zinc-100">Limitations</div>
                            <ul className="space-y-1 text-xs text-zinc-400">
                              <li>Polling-based (15s), not push/live</li>
                              <li>No drag-and-drop on task board yet</li>
                              <li>No direct restart/log actions from UI</li>
                            </ul>
                          </div>
                          <Separator className="bg-white/8" />
                          <div>
                            <div className="mb-1.5 flex items-center gap-1.5 font-medium text-zinc-100">
                              <RefreshCw className="h-3.5 w-3.5 text-orange-300" aria-hidden="true" /> Source Paths
                            </div>
                            <div className="space-y-1 break-all text-xs text-zinc-400">
                              {Object.entries(state.dataSources).map(([key, value]) => (
                                <div key={key}><span className="text-zinc-500">{key}:</span> <span className="font-display">{value}</span></div>
                              ))}
                            </div>
                          </div>
                          {state.orphanAgentStores.length > 0 && (
                            <>
                              <Separator className="bg-white/8" />
                              <div>
                                <div className="mb-1.5 font-medium text-zinc-100">Orphan Stores</div>
                                <div className="space-y-1 text-xs text-zinc-400">
                                  {state.orphanAgentStores.map((id) => <div key={id} className="font-display">{id}</div>)}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </CardContent>
                      <CardFooter className="border-white/5 bg-white/[0.01] text-xs text-zinc-500">
                        Snapshot generated {state.generatedLabel}
                      </CardFooter>
                    </Card>
                  </section>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
