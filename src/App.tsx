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

type MissionTaskStatus = 'inbox' | 'ready' | 'doing' | 'blocked' | 'in_review' | 'done'
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

type ViewId = 'dashboard' | 'tasks' | 'agents' | 'sessions' | 'system'

const TASK_STATUSES: Array<{ id: MissionTaskStatus; label: string }> = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'ready', label: 'Ready' },
  { id: 'doing', label: 'Doing' },
  { id: 'in_review', label: 'In Review' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'done', label: 'Done' },
]

const PRIORITY_TONES: Record<MissionTaskPriority, string> = {
  low: 'text-muted-foreground bg-zinc-500/10 border-zinc-500/20',
  medium: 'text-cyan-200 bg-cyan-500/10 border-cyan-500/20',
  high: 'text-primary bg-orange-500/10 border-orange-500/20',
}

const STATUS_ACCENTS: Record<MissionTaskStatus, string> = {
  inbox: 'border-zinc-500/20',
  ready: 'border-cyan-500/20',
  doing: 'border-orange-500/20',
  in_review: 'border-violet-500/20',
  blocked: 'border-red-500/20',
  done: 'border-emerald-500/20',
}

const STATUS_DOTS: Record<MissionTaskStatus, string> = {
  inbox: 'text-muted-foreground',
  ready: 'text-cyan-400',
  doing: 'text-orange-400',
  in_review: 'text-violet-400',
  blocked: 'text-red-400',
  done: 'text-emerald-400',
}

const COMMENT_TYPE_TONES: Record<TaskCommentType, string> = {
  progress: 'text-primary bg-cyan-500/10 border-cyan-500/20',
  blocker: 'text-red-300 bg-red-500/10 border-red-500/20',
  decision: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  result: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  system: 'text-muted-foreground bg-zinc-500/10 border-zinc-500/20',
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
  inactive: 'text-muted-foreground bg-zinc-500/10 border-zinc-500/20',
  warning: 'text-primary bg-orange-500/10 border-orange-500/20',
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

const cardClass = ''

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
    <Card className="transition-colors hover:ring-foreground/20">
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground" style={{ textWrap: 'balance' }}>{label}</CardTitle>
        <CardAction>
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="font-display text-3xl font-semibold tracking-tight text-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <CardDescription className="mt-2">{hint}</CardDescription>
      </CardContent>
    </Card>
  )
}

function LoadingSkeleton() {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader><Skeleton className="h-4 w-24" /></CardHeader>
          <CardContent>
            <Skeleton className="h-9 w-16" />
            <Skeleton className="mt-2 h-4 w-40" />
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

function AgentIdentityText({ agentId, agent, className = '' }: { agentId: string; agent?: Pick<AgentCard, 'name' | 'identityEmoji'> | null; className?: string }) {
  if (!agent) return <span className={className}>{agentId}</span>
  return <AgentIdentityLabel agent={agent} className={className} />
}

function formatAgentOptionLabel(agent: Pick<AgentCard, 'name' | 'identityEmoji'>) {
  return agent.identityEmoji ? `${agent.identityEmoji} ${agent.name}` : agent.name
}

const COLUMN_EMPTY_LABELS: Record<MissionTaskStatus, string> = {
  inbox: 'No new tasks',
  ready: 'Nothing queued',
  doing: 'No work in progress',
  in_review: 'Nothing in review',
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
        className="w-full text-left rounded-xl border border-border bg-card p-3.5 shadow-sm transition-colors hover:ring-1 hover:ring-foreground/15 cursor-pointer"
        aria-label={`Open details for ${task.title}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-5 text-foreground truncate">{task.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <TaskPill className={PRIORITY_TONES[task.priority]}>{task.priority}</TaskPill>
              <TaskPill className={assignedAgent?.active ? toneBadge.active : toneBadge.inactive}>
                <span className="inline-flex items-center gap-1">
                  {task.routing?.autoRouted ? (
                    <Route className="h-2.5 w-2.5" aria-hidden="true" />
                  ) : (
                    <UserRound className="h-2.5 w-2.5" aria-hidden="true" />
                  )}
                  {task.assignedAgent ? <AgentIdentityText agentId={task.assignedAgent} agent={assignedAgent} /> : 'Unassigned'}
                </span>
              </TaskPill>
              {task.claim?.claimedBy && (
                <TaskPill className="text-primary bg-orange-500/10 border-orange-500/20">
                  <span className="inline-flex items-center gap-1">
                    <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                    {task.claim.claimedBy}
                  </span>
                </TaskPill>
              )}
              {commentCount > 0 && (
                <TaskPill className="text-muted-foreground bg-muted/50 border-border">
                  <span className="inline-flex items-center gap-1">
                    <MessageSquareText className="h-2.5 w-2.5" aria-hidden="true" />
                    {commentCount}
                  </span>
                </TaskPill>
              )}
            </div>
          </div>
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>
      </DialogTrigger>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="flex items-center gap-2">
              <TaskPill className={PRIORITY_TONES[task.priority]}>{task.priority}</TaskPill>
              <Badge variant="outline" className={`rounded-full text-[10px] ${STATUS_ACCENTS[task.status]} text-muted-foreground`}>{task.status}</Badge>
            </div>
            {!editMode ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditMode(true)}
                className="rounded-full border-accent/30 bg-accent/10 text-accent-foreground hover:bg-accent/20"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" /> Edit
              </Button>
            ) : null}
          </div>
          <DialogTitle className="text-lg">{task.title}</DialogTitle>
          {task.description && <DialogDescription>{task.description}</DialogDescription>}
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>Updated {formatRelativeTime(task.updatedAt)}</span>
            {task.routing?.autoRouted && task.assignedAgent && (
              <span className="inline-flex items-center gap-1 text-violet-300">
                <Route className="h-3 w-3" aria-hidden="true" />
                Auto-routed to <span className="font-medium">{task.assignedAgent ? <AgentIdentityText agentId={task.assignedAgent} agent={assignedAgent} /> : null}</span>
              </span>
            )}
            {task.assignedAgent && !task.routing?.autoRouted && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <UserRound className="h-3 w-3" aria-hidden="true" />
                Manually assigned
              </span>
            )}
            {task.claim?.claimedBy && (
              <span className="inline-flex items-center gap-1 text-primary">
                <Lock className="h-3 w-3" aria-hidden="true" />
                Claimed by <span className="font-medium">{task.claim.claimedBy}</span>
                {task.claim.claimedAt && <span className="text-muted-foreground/60">{formatRelativeTime(task.claim.claimedAt)}</span>}
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
            <form onSubmit={handleSaveEdits} className="space-y-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3.5">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Title</Label>
                <Input
                  value={editForm.title}
                  onChange={(e) => setEditForm((current) => ({ ...current, title: e.target.value }))}
                  disabled={isSavingTask}
                  autoComplete="off"
                  className="rounded-xl border-border bg-muted/50 text-foreground focus:border-ring"
                  placeholder="Task title"
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Notes</Label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((current) => ({ ...current, description: e.target.value }))}
                  disabled={isSavingTask}
                  className="min-h-24 w-full rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
                  placeholder="Context, constraints, notes..."
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Owner</Label>
                  <NativeSelect disabled={isSavingTask} value={editForm.assignedAgent} onChange={(e) => setEditForm((current) => ({ ...current, assignedAgent: e.target.value }))} className="w-full">
                    <NativeSelectOption value="">Unassigned</NativeSelectOption>
                    {(state?.agents ?? []).map((a) => <NativeSelectOption key={a.id} value={a.id}>{formatAgentOptionLabel(a)}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <NativeSelect disabled={isSavingTask} value={editForm.status} onChange={(e) => setEditForm((current) => ({ ...current, status: e.target.value as MissionTaskStatus }))} className="w-full">
                    {TASK_STATUSES.map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.label}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Priority</Label>
                  <NativeSelect disabled={isSavingTask} value={editForm.priority} onChange={(e) => setEditForm((current) => ({ ...current, priority: e.target.value as MissionTaskPriority }))} className="w-full">
                    <NativeSelectOption value="low">Low</NativeSelectOption>
                    <NativeSelectOption value="medium">Medium</NativeSelectOption>
                    <NativeSelectOption value="high">High</NativeSelectOption>
                  </NativeSelect>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleCancelEdits} disabled={isSavingTask} className="rounded-full">
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isSavingTask || !editForm.title.trim()} className="rounded-full border-accent/30 bg-accent/10 text-accent-foreground hover:bg-accent/20">
                  {isSavingTask ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Owner</Label>
                <div className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    {assignedAgent ? <AgentIdentityLabel agent={assignedAgent} /> : 'Unassigned'}
                    {task.routing?.autoRouted && (
                      <Badge variant="outline" className="rounded-full text-[9px] px-1.5 py-0 leading-3 text-violet-300 bg-violet-500/10 border-violet-500/20">auto</Badge>
                    )}
                  </span>
                </div>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <div className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
                  {TASK_STATUSES.find((statusOption) => statusOption.id === task.status)?.label ?? task.status}
                </div>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Priority</Label>
                <div className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
                  {task.priority}
                </div>
              </div>
            </div>
          )}

          {/* ── Comments section ── */}
          <Separator className="bg-muted/50" />
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <MessageSquareText className="h-3 w-3" aria-hidden="true" />
              Comments {commentCount > 0 && <span className="text-muted-foreground">({commentCount})</span>}
            </div>
            <button
              type="button"
              onClick={() => setShowCommentForm(!showCommentForm)}
              className="text-xs text-primary hover:text-primary/80 transition-colors"
            >
              {showCommentForm ? 'Cancel' : '+ Add'}
            </button>
          </div>

          {showCommentForm && (
            <form onSubmit={handleAddComment} className="rounded-xl border border-border bg-muted/30 p-2.5 space-y-2">
              <div className="flex gap-2">
                <Input
                  value={commentAuthor}
                  onChange={(e) => setCommentAuthor(e.target.value)}
                  placeholder="Author"
                  className="flex-1 h-7 text-xs rounded-lg border-border bg-muted/50 text-foreground focus:border-ring"
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
                  className="flex-1 h-7 text-xs rounded-lg border-border bg-muted/50 text-foreground focus:border-ring"
                  autoComplete="off"
                />
                <Button
                  type="submit"
                  disabled={submittingComment || !commentAuthor.trim() || !commentText.trim()}
                  className="h-7 px-2.5 text-xs border-accent/30 bg-accent/10 text-accent-foreground hover:bg-accent/20"
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
                  <div key={comment.id} className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground italic">
                    <ArrowRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                    <span className="flex-1">{comment.text}</span>
                    <span className="text-[10px] text-muted-foreground/60 shrink-0">{formatRelativeTime(comment.createdAt)}</span>
                  </div>
                ) : (
                  <div key={comment.id} className="rounded-lg border border-border bg-muted/20 px-2.5 py-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Badge variant="outline" className={`rounded-full text-[10px] px-1.5 py-0 leading-4 ${COMMENT_TYPE_TONES[comment.type]}`}>
                        {comment.type}
                      </Badge>
                      <span className="text-[11px] font-medium text-muted-foreground">{comment.author}</span>
                      <span className="text-[10px] text-muted-foreground/60 ml-auto">{formatRelativeTime(comment.createdAt)}</span>
                    </div>
                    <p className="text-xs leading-4 text-muted-foreground">{comment.text}</p>
                  </div>
                )
              ))}
            </div>
          ) : !showCommentForm ? (
            <div className="text-[11px] text-muted-foreground/60 text-center py-2">No comments yet</div>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

/* ── Agent Detail Dialog ── */

const LOG_SEVERITY_TONES: Record<AgentLogEntry['severity'], string> = {
  info: 'text-primary bg-cyan-500/10 border-cyan-500/20',
  warning: 'text-primary bg-orange-500/10 border-orange-500/20',
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
        <Item variant="outline" className="border-border bg-muted/30 hover:border-border flex-col items-stretch">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg font-semibold text-foreground"><AgentIdentityLabel agent={agent} /></h3>
                <Pill toneKey={agent.active ? 'active' : 'inactive'}>{agent.active ? 'Active' : 'Idle'}</Pill>
                <Pill toneKey={agent.existsOnDisk ? 'info' : 'warning'}>{agent.existsOnDisk ? 'On disk' : 'Missing'}</Pill>
                <Pill toneKey={agent.hasSessions ? 'info' : 'inactive'}>
                  {agent.hasSessions ? `${agent.sessionCount} sessions (${agent.recentSessionCount} recent)` : 'No sessions'}
                </Pill>
              </div>
              <p className="text-sm text-muted-foreground">{agent.activeReason}</p>
              <p className="text-sm text-muted-foreground">Last update: <span className="text-foreground">{agent.updatedLabel}</span></p>
            </div>
            <div className="flex items-center gap-3">
              <div className="grid gap-1.5 text-sm text-muted-foreground md:min-w-72">
                <div><span className="text-muted-foreground">Model:</span> <span className="font-display text-xs">{agent.model}</span></div>
                <div className="min-w-0"><span className="text-muted-foreground">Workspace:</span> <span className="font-display truncate text-xs">{agent.workspace}</span></div>
              </div>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </div>
          </div>
        </Item>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
            <Pill toneKey={agent.active ? 'active' : 'inactive'}>{agent.active ? 'Active' : 'Idle'}</Pill>
            <Pill toneKey={agent.existsOnDisk ? 'info' : 'warning'}>{agent.existsOnDisk ? 'On disk' : 'Missing'}</Pill>
          </div>
          <DialogTitle className="text-lg"><AgentIdentityLabel agent={agent} /></DialogTitle>
          <DialogDescription>{agent.activeReason}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* ── Agent metadata ── */}
          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <div><span className="text-muted-foreground">Model:</span> <span className="font-display text-xs text-foreground">{agent.model}</span></div>
            <div className="min-w-0"><span className="text-muted-foreground">Workspace:</span> <span className="font-display truncate text-xs text-foreground">{agent.workspace}</span></div>
            <div className="min-w-0"><span className="text-muted-foreground">Sessions path:</span> <span className="font-display truncate text-xs text-foreground">{agent.sessionsPath}</span></div>
            <div><span className="text-muted-foreground">Latest session:</span> <span className="font-display text-xs text-foreground">{agent.latestSessionId ?? '\u2014'}</span></div>
            <div><span className="text-muted-foreground">Sessions:</span> <span className="text-foreground">{agent.sessionCount} total, {agent.recentSessionCount} recent</span></div>
            <div><span className="text-muted-foreground">Last update:</span> <span className="text-foreground">{agent.updatedLabel}</span></div>
          </div>

          <Separator className="bg-muted/50" />

          {/* ── Recent Logs ── */}
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <FileText className="h-3 w-3" aria-hidden="true" />
              Recent Logs
              {logs.length > 0 && <span className="text-muted-foreground">({logs.length})</span>}
            </div>
            <span className="text-[10px] text-muted-foreground/60">gateway + session JSONL &middot; approximate</span>
          </div>

          {logsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4" role="status" aria-live="polite">
              <Spinner className="text-primary" /> Loading logs&hellip;
            </div>
          ) : logsError ? (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-xs text-red-300">{logsError}</div>
          ) : logs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              No recent logs found for this agent.
            </div>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {logs.map((entry, i) => (
                <div key={`${entry.timestamp}-${i}`} className="rounded-lg border border-border bg-muted/20 px-2.5 py-1.5 group">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={`rounded-full text-[10px] px-1.5 py-0 leading-4 ${LOG_SEVERITY_TONES[entry.severity]}`}>
                      {entry.severity}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{formatLogDate(entry.timestamp)} {formatLogTime(entry.timestamp)}</span>
                    <Badge variant="outline" className="ml-auto rounded-full text-[9px] px-1 py-0 leading-3 text-muted-foreground/60 bg-muted/30 border-border">
                      {entry.source}{entry.sessionId ? ` · ${entry.sessionId.slice(0, 8)}` : ''}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs leading-4 text-muted-foreground font-mono break-all">{entry.message}</p>
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
          <KanbanSquare className="h-4 w-4 text-primary" aria-hidden="true" />
          <CardTitle style={{ textWrap: 'balance' }}>Task Board</CardTitle>
        </div>
        <CardAction>
          <div className="flex flex-wrap gap-1.5">
            {taskCounts.map((s) => (
              <TaskPill key={s.id} className={`border ${STATUS_ACCENTS[s.id]} bg-muted/50 text-muted-foreground`}>
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
            <Spinner className="text-primary" /> Loading&hellip;
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-5">
            {TASK_STATUSES.map((column) => {
              const columnTasks = tasks.filter((t) => t.status === column.id)
              return (
                <div key={column.id} className={`rounded-xl border bg-muted/30 p-3 ${STATUS_ACCENTS[column.id]}`}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Circle className={`h-2 w-2 fill-current ${STATUS_DOTS[column.id]}`} aria-hidden="true" />
                      <div className="text-sm font-medium text-foreground">{column.label}</div>
                    </div>
                    <div className="text-xs text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>{columnTasks.length}</div>
                  </div>
                  <div className="space-y-2">
                    {columnTasks.length === 0 ? (
                      <Empty className="border border-dashed border-border py-4">
                        <EmptyHeader><EmptyTitle className="text-muted-foreground">{COLUMN_EMPTY_LABELS[column.id]}</EmptyTitle></EmptyHeader>
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

    loadState()
    loadTasks()
    const interval = window.setInterval(() => { loadState(); loadTasks() }, 15000)
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
  const [sessionsTab, setSessionsTab] = useState<'recent' | 'acp'>('recent')

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [stateRes, tasksRes] = await Promise.all([
        fetch('/api/openclaw/state', { cache: 'no-store' }),
        fetch('/api/mission-control/tasks', { cache: 'no-store' }),
      ])
      if (stateRes.ok) { const p = (await stateRes.json()) as MissionControlState; setState(p); setError(null) }
      if (tasksRes.ok) { const p = (await tasksRes.json()) as { tasks: MissionTask[] }; setTasks(p.tasks); setTaskError(null) }
      toast.success('Data refreshed')
    } catch {
      toast.error('Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }, [])

  return (
    <SidebarProvider style={{ '--sidebar-width': '19rem' } as React.CSSProperties}>
      {/* ── Sidebar ── */}
      <Sidebar variant="floating">
        <SidebarHeader className="p-4">
          <div className="flex items-center gap-2.5">
            <Badge variant="outline" className="rounded-full border-sidebar-primary/20 bg-sidebar-primary/10 uppercase tracking-[0.2em] text-sidebar-primary">
              <Wrench className="h-3 w-3" aria-hidden="true" /> MC
            </Badge>
            <span className="font-display text-sm font-semibold tracking-tight text-sidebar-foreground">Mission Control</span>
          </div>
          {state && (
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className={`h-1.5 w-1.5 rounded-full ${state.gateway.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
              Updated {state.generatedLabel}
            </div>
          )}
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="text-muted-foreground">Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={activeView === item.id}
                      onClick={() => setActiveView(item.id)}
                      tooltip={item.label}
                      className={activeView === item.id ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-muted-foreground'}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {item.id === 'tasks' && taskMetrics.inFlight > 0 && (
                      <SidebarMenuBadge className="bg-orange-500/10 text-primary">{taskMetrics.inFlight}</SidebarMenuBadge>
                    )}
                    {item.id === 'sessions' && state && state.metrics.acpActiveRuns > 0 && (
                      <SidebarMenuBadge className="bg-emerald-500/10 text-emerald-300">{state.metrics.acpActiveRuns} ACP</SidebarMenuBadge>
                    )}
                    {item.id === 'agents' && state && (
                      <SidebarMenuBadge className="text-muted-foreground">{state.metrics.activeAgents}/{state.metrics.totalAgents}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {state && state.metrics.blockers > 0 && (
            <SidebarGroup>
              <SidebarGroupLabel className="text-muted-foreground">Alerts</SidebarGroupLabel>
              <SidebarGroupContent>
                <div className="px-2">
                  <Alert className="border-orange-500/20 bg-orange-500/5">
                    <TriangleAlert className="h-3.5 w-3.5 text-primary" />
                    <AlertTitle className="text-primary text-xs">{state.metrics.blockers} blocker{state.metrics.blockers === 1 ? '' : 's'}</AlertTitle>
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
                <Button variant="outline" size="sm" onClick={handleManualRefresh} disabled={refreshing} className="w-full" />
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
          <SidebarTrigger className="text-muted-foreground" />
          {loading && !state && <Spinner className="text-primary" />}
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
                          <Button variant="outline" size="sm" onClick={() => setActiveView('tasks')} className="rounded-full border-primary/30 bg-primary/10 text-xs text-primary-foreground hover:bg-primary/20">
                            Open Tasks <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </Button>
                        </CardAction>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="rounded-xl border border-border bg-muted/30 p-4">
                            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                              <TriangleAlert className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Attention
                            </div>
                            <div className="space-y-2">
                              {dashboardWarnings.length === 0 ? (
                                <Alert className="border-emerald-500/20 bg-emerald-500/5">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" />
                                  <AlertDescription className="text-emerald-200">All clear &mdash; no issues detected.</AlertDescription>
                                </Alert>
                              ) : (
                                dashboardWarnings.map((w, i) => (
                                  <div key={`${w.title}-${i}`} className="rounded-xl border border-border bg-card p-3">
                                    <Pill toneKey={w.toneKey}>{w.title}</Pill>
                                    <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{w.body}</p>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          <div className="rounded-xl border border-border bg-muted/30 p-4">
                            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                              <KanbanSquare className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Tasks
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { label: 'In Flight', value: taskMetrics.inFlight },
                                { label: 'Blocked', value: taskMetrics.blocked },
                                { label: 'Unassigned', value: taskMetrics.unassigned },
                                { label: 'Done', value: taskMetrics.done },
                              ].map((item) => (
                                <div key={item.label} className="rounded-xl border border-border bg-card p-3">
                                  <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{item.label}</div>
                                  <div className="font-display mt-1 text-xl font-semibold text-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>{item.value}</div>
                                </div>
                              ))}
                            </div>
                            <Button variant="link" size="sm" onClick={() => setActiveView('tasks')} className="mt-3 h-auto p-0 text-xs text-primary hover:text-primary/80">
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
                          <div className="rounded-xl border border-border bg-muted/30 p-4">
                            <div className="mb-2 text-sm font-medium text-foreground">Where attention should go</div>
                            <ItemGroup>
                              {(state?.focus ?? []).length === 0 ? (
                                <Empty className="border border-dashed border-border py-4"><EmptyHeader><EmptyTitle className="text-muted-foreground">No focus items right now.</EmptyTitle></EmptyHeader></Empty>
                              ) : (
                                (state?.focus ?? []).slice(0, 4).map((item, i) => (
                                  <Item key={`${item}-${i}`} variant="outline" size="sm" className="border-border bg-card">
                                    <ItemContent><ItemDescription className="text-muted-foreground">{item}</ItemDescription></ItemContent>
                                  </Item>
                                ))
                              )}
                            </ItemGroup>
                          </div>

                          <div className="rounded-xl border border-border bg-muted/30 p-4">
                            <div className="mb-2 text-sm font-medium text-foreground">Gateway</div>
                            <div className="space-y-2 text-sm text-muted-foreground">
                              <div className="flex items-center justify-between"><span>Service</span><span className="font-display text-xs text-foreground">{state?.gateway.service}</span></div>
                              <div className="flex items-center justify-between"><span>Listening</span><span className="font-display text-xs text-foreground">{state?.gateway.listening}</span></div>
                              <div className="flex items-center justify-between"><span>Channels</span><span className="text-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>{state?.channels.filter((c) => c.enabled).length ?? 0} enabled</span></div>
                            </div>
                            <Button variant="link" size="sm" onClick={() => setActiveView('system')} className="mt-3 h-auto p-0 text-xs text-primary hover:text-primary/80">
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
                          <Zap className="h-4 w-4 text-primary" aria-hidden="true" /> ACP Activity
                          {state.acpRuns.totalActive > 0 && (
                            <Badge variant="outline" className="ml-1 rounded-full border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-[10px] font-medium px-2">
                              {state.acpRuns.totalActive} running
                            </Badge>
                          )}
                        </CardTitle>
                        <CardAction>
                          <Button variant="link" size="sm" onClick={() => setActiveView('sessions')} className="h-auto p-0 text-xs text-primary hover:text-primary/80">
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
                                    <span className="text-[10px] text-muted-foreground font-display">{run.harness}</span>
                                  </div>
                                  <p className="text-sm text-foreground truncate">{run.task}</p>
                                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                    {run.project && <span className="flex items-center gap-1"><FolderGit2 className="h-3 w-3" />{run.project.split('/').slice(-2).join('/')}</span>}
                                    {run.model && <span className="font-display">{run.model}</span>}
                                  </div>
                                </div>
                                <div className="shrink-0 text-right">
                                  <div className="text-xs text-muted-foreground font-display tabular-nums">{run.elapsed}</div>
                                  <div className="text-[10px] text-muted-foreground">{run.startedLabel}</div>
                                </div>
                              </div>
                            </div>
                          ))}
                          {state.acpRuns.recent.slice(0, 3).map((run) => (
                            <div key={run.sessionId} className="rounded-xl border border-border bg-muted/30 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <Pill toneKey={run.status === 'idle' ? 'info' : 'inactive'}>{run.status === 'idle' ? 'Idle' : 'Completed'}</Pill>
                                    <span className="text-[10px] text-muted-foreground font-display">{run.harness}</span>
                                  </div>
                                  <p className="text-sm text-muted-foreground truncate">{run.task}</p>
                                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                    {run.project && <span className="flex items-center gap-1"><FolderGit2 className="h-3 w-3" />{run.project.split('/').slice(-2).join('/')}</span>}
                                    {run.model && <span className="font-display">{run.model}</span>}
                                  </div>
                                </div>
                                <span className="shrink-0 text-xs text-muted-foreground">{run.lastUpdatedLabel}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <section className="grid gap-5 xl:grid-cols-2">
                    {/* Recent Activity */}
                    <Card className={cardClass}>
                      <CardHeader>
                        <CardTitle className="text-base font-semibold" style={{ textWrap: 'balance' }}>Recent Activity</CardTitle>
                        <CardAction><Button variant="link" size="sm" onClick={() => setActiveView('sessions')} className="h-auto p-0 text-xs text-primary hover:text-primary/80">All sessions</Button></CardAction>
                      </CardHeader>
                      <CardContent>
                        {recentActivity.length === 0 ? (
                          <Empty className="border border-dashed border-border">
                            <EmptyHeader>
                              <EmptyMedia variant="icon"><Activity className="text-muted-foreground" /></EmptyMedia>
                              <EmptyTitle className="text-muted-foreground">No recent sessions</EmptyTitle>
                              <EmptyDescription>Activity will appear here as agents run.</EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        ) : (
                          <ItemGroup>
                            {recentActivity.map((s) => (
                              <Item key={s.sessionKey} variant="outline" size="sm" className="border-border bg-muted/30 hover:border-border">
                                <ItemContent>
                                  <ItemTitle className="text-foreground">
                                    {s.agentId}
                                    <Pill toneKey={s.isRecent ? 'active' : 'inactive'}>{s.isRecent ? 'Recent' : 'Older'}</Pill>
                                  </ItemTitle>
                                  <ItemDescription className="text-muted-foreground">{s.label ?? s.sessionKey}</ItemDescription>
                                </ItemContent>
                                <ItemActions><span className="text-xs text-muted-foreground">{s.updatedLabel}</span></ItemActions>
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
                        <CardAction><Button variant="link" size="sm" onClick={() => setActiveView('agents')} className="h-auto p-0 text-xs text-primary hover:text-primary/80">All agents</Button></CardAction>
                      </CardHeader>
                      <CardContent>
                        {topAgents.length === 0 ? (
                          <Empty className="border border-dashed border-border">
                            <EmptyHeader>
                              <EmptyMedia variant="icon"><Bot className="text-muted-foreground" /></EmptyMedia>
                              <EmptyTitle className="text-muted-foreground">No agents configured</EmptyTitle>
                              <EmptyDescription>Register agents in OpenClaw to see them here.</EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        ) : (
                          <ItemGroup>
                            {topAgents.map((a) => (
                              <Item key={a.id} variant="outline" size="sm" className="border-border bg-muted/30 hover:border-border">
                                <ItemContent>
                                  <ItemTitle className="text-foreground">
                                    <AgentIdentityLabel agent={a} className="mr-2" />
                                    <Pill toneKey={a.active ? 'active' : 'inactive'}>{a.active ? 'Active' : 'Idle'}</Pill>
                                  </ItemTitle>
                                  <ItemDescription className="text-muted-foreground">{a.activeReason}</ItemDescription>
                                </ItemContent>
                                <ItemActions><span className="text-xs text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>{a.recentSessionCount} recent</span></ItemActions>
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
                        <CardAction><Button variant="link" size="sm" onClick={() => setActiveView('tasks')} className="h-auto p-0 text-xs text-primary hover:text-primary/80">Full board</Button></CardAction>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-2 lg:grid-cols-2">
                          {tasksNeedingAttention.map((t) => (
                            <button key={t.id} type="button" onClick={() => setActiveView('tasks')} className="rounded-xl border border-border bg-muted/30 p-3 text-left transition-colors hover:border-border hover:bg-muted/60">
                              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                                <TaskPill className={`border ${STATUS_ACCENTS[t.status]} bg-muted/50 text-muted-foreground`}>{TASK_STATUSES.find((s) => s.id === t.status)?.label}</TaskPill>
                                <TaskPill className={PRIORITY_TONES[t.priority]}>{t.priority}</TaskPill>
                              </div>
                              <div className="text-sm font-medium text-foreground">{t.title}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {t.assignedAgent ? (
                                  <span className="inline-flex items-center gap-1">
                                    <span>Owner:</span>
                                    <AgentIdentityText agentId={t.assignedAgent} agent={agentsById.get(t.assignedAgent)} />
                                  </span>
                                ) : 'Unassigned'}
                              </div>
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
                    <h2 className="text-base font-semibold text-foreground" style={{ textWrap: 'balance' }}>Task Management</h2>
                    <Button variant="outline" size="sm" onClick={() => setShowCreateForm(!showCreateForm)} className="rounded-full border-primary/30 bg-primary/10 text-xs text-primary-foreground hover:bg-primary/20">
                      {showCreateForm ? 'Hide form' : (<><Plus className="h-3 w-3" aria-hidden="true" /> New Task</>)}
                    </Button>
                  </div>

                  {showCreateForm && (
                    <Card className={cardClass}>
                      <CardContent>
                        <form className="grid gap-3" onSubmit={createTask}>
                          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                            <div className="grid gap-1.5">
                              <Label className="text-xs text-muted-foreground">Title</Label>
                              <Input ref={titleInputRef} name="title" autoComplete="off" className="rounded-xl border-border bg-muted/50 text-foreground focus:border-ring" value={form.title} onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))} placeholder="What needs doing&hellip;" />
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="text-xs text-muted-foreground">Notes</Label>
                              <Input name="description" autoComplete="off" className="rounded-xl border-border bg-muted/50 text-foreground focus:border-ring" value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} placeholder="Context, constraints&hellip;" />
                            </div>
                          </div>
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="grid gap-1.5">
                              <Label className="text-xs text-muted-foreground">Status</Label>
                              <NativeSelect value={form.status} onChange={(e) => setForm((c) => ({ ...c, status: e.target.value as MissionTaskStatus }))}>
                                {TASK_STATUSES.map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.label}</NativeSelectOption>)}
                              </NativeSelect>
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="text-xs text-muted-foreground">Priority</Label>
                              <NativeSelect value={form.priority} onChange={(e) => setForm((c) => ({ ...c, priority: e.target.value as MissionTaskPriority }))}>
                                <NativeSelectOption value="low">Low</NativeSelectOption>
                                <NativeSelectOption value="medium">Medium</NativeSelectOption>
                                <NativeSelectOption value="high">High</NativeSelectOption>
                              </NativeSelect>
                            </div>
                            <div className="grid gap-1.5">
                              <Label className="text-xs text-muted-foreground">Agent</Label>
                              <NativeSelect value={form.assignedAgent} onChange={(e) => setForm((c) => ({ ...c, assignedAgent: e.target.value }))}>
                                <NativeSelectOption value="">Unassigned</NativeSelectOption>
                                {(state?.agents ?? []).map((a) => <NativeSelectOption key={a.id} value={a.id}>{formatAgentOptionLabel(a)}</NativeSelectOption>)}
                              </NativeSelect>
                            </div>
                            <Button type="submit" disabled={submittingTask} className="border-primary/40 bg-primary/10 text-primary-foreground hover:bg-primary/20">
                              {submittingTask ? (<><Spinner className="text-primary" /> Creating&hellip;</>) : 'Create'}
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
                        <Empty className="border border-dashed border-border">
                          <EmptyHeader>
                            <EmptyMedia variant="icon"><Bot className="text-muted-foreground" /></EmptyMedia>
                            <EmptyTitle className="text-muted-foreground">No agents registered</EmptyTitle>
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
                  <Tabs value={sessionsTab} onValueChange={(v) => setSessionsTab(v as 'recent' | 'acp')} className="flex flex-col gap-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <TabsList className="h-auto w-full justify-start rounded-xl border border-border bg-muted/50 p-1 md:w-auto">
                        <TabsTrigger
                          value="recent"
                          className="rounded-xl px-3 py-2 text-xs text-muted-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground"
                        >
                          <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                          Recent Sessions
                          <Badge variant="outline" className="ml-1 rounded-full border-border bg-muted/60 px-1.5 text-[10px] text-muted-foreground">
                            {state.recentSessions.length}
                          </Badge>
                        </TabsTrigger>
                        <TabsTrigger
                          value="acp"
                          className="rounded-xl px-3 py-2 text-xs text-muted-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground"
                        >
                          <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                          ACP Runs
                          <Badge variant="outline" className="ml-1 rounded-full border-cyan-500/20 bg-cyan-500/10 px-1.5 text-[10px] text-primary">
                            {state.metrics.acpTotalRuns}
                          </Badge>
                        </TabsTrigger>
                      </TabsList>

                      <div className="text-xs text-muted-foreground">
                        {sessionsTab === 'recent'
                          ? `${state.recentSessions.length} session${state.recentSessions.length === 1 ? '' : 's'} visible in OpenClaw`
                          : `${state.metrics.acpTotalRuns} ACP run${state.metrics.acpTotalRuns === 1 ? '' : 's'} detected`}
                      </div>
                    </div>

                    <TabsContent value="recent" className="mt-0">
                      <Card className={cardClass}>
                        <CardHeader>
                          <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ textWrap: 'balance' }}>
                            <Activity className="h-4 w-4 text-primary" aria-hidden="true" /> Recent Sessions
                          </CardTitle>
                          <CardDescription className="text-muted-foreground">Latest OpenClaw session activity, optimized for quick scanning.</CardDescription>
                        </CardHeader>
                        <CardContent>
                          {state.recentSessions.length === 0 ? (
                            <Empty className="border border-dashed border-border">
                              <EmptyHeader>
                                <EmptyMedia variant="icon"><Activity className="text-muted-foreground" /></EmptyMedia>
                                <EmptyTitle className="text-muted-foreground">No sessions recorded yet</EmptyTitle>
                                <EmptyDescription>Sessions will appear here as agents run.</EmptyDescription>
                              </EmptyHeader>
                            </Empty>
                          ) : (
                            <ItemGroup>
                              {state.recentSessions.slice(0, sessionsLimit).map((s) => (
                                <Item key={s.sessionKey} variant="outline" className="border-border bg-muted/30 hover:border-border flex-col items-stretch">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <ItemTitle className="text-foreground flex-wrap">
                                        {s.agentId} <span className="text-muted-foreground">/</span> <span className="font-display text-xs">{s.sessionId}</span>
                                        <Pill toneKey={s.isRecent ? 'active' : 'inactive'}>{s.isRecent ? 'Recent' : 'Older'}</Pill>
                                      </ItemTitle>
                                      <ItemDescription className="text-muted-foreground">{s.label ?? s.sessionKey}</ItemDescription>
                                    </div>
                                    <span className="shrink-0 text-xs text-muted-foreground">{s.updatedLabel}</span>
                                  </div>
                                  <Separator className="my-1 bg-muted/50" />
                                  <div className="grid gap-1.5 text-xs text-muted-foreground md:grid-cols-2">
                                    <div><span className="text-muted-foreground">Channel:</span> {s.channel}</div>
                                    <div><span className="text-muted-foreground">Model:</span> <span className="font-display">{s.model}</span></div>
                                    <div><span className="text-muted-foreground">Depth:</span> <span style={{ fontVariantNumeric: 'tabular-nums' }}>{s.spawnDepth}</span></div>
                                    <div className="min-w-0"><span className="text-muted-foreground">File:</span> <span className="font-display truncate">{s.sessionFile ?? '\u2014'}</span></div>
                                  </div>
                                </Item>
                              ))}
                              {state.recentSessions.length > sessionsLimit && (
                                <Button variant="outline" onClick={() => setSessionsLimit((n) => n + 20)} className="w-full border-dashed border-border text-muted-foreground hover:border-border hover:text-foreground">
                                  Show more ({state.recentSessions.length - sessionsLimit} remaining)
                                </Button>
                              )}
                            </ItemGroup>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="acp" className="mt-0">
                      <Card className={cardClass}>
                        <CardHeader>
                          <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ textWrap: 'balance' }}>
                            <Zap className="h-4 w-4 text-primary" aria-hidden="true" /> ACP Runs
                            {state.acpRuns.totalActive > 0 && (
                              <Badge variant="outline" className="ml-1 rounded-full border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-[10px] font-medium px-2">
                                {state.acpRuns.totalActive} active
                              </Badge>
                            )}
                          </CardTitle>
                          <CardDescription className="text-muted-foreground">Claude Code and other ACP harness activity in a dedicated lane.</CardDescription>
                          <CardAction>
                            <span className="text-xs text-muted-foreground">{state.metrics.acpTotalRuns} session{state.metrics.acpTotalRuns === 1 ? '' : 's'} detected</span>
                          </CardAction>
                        </CardHeader>
                        <CardContent>
                          {state.acpRuns.active.length === 0 && state.acpRuns.recent.length === 0 ? (
                            <Empty className="border border-dashed border-border">
                              <EmptyHeader>
                                <EmptyMedia variant="icon"><Zap className="text-muted-foreground" /></EmptyMedia>
                                <EmptyTitle className="text-muted-foreground">No ACP runs detected</EmptyTitle>
                                <EmptyDescription>Claude Code and other ACP sessions will appear here when active.</EmptyDescription>
                              </EmptyHeader>
                            </Empty>
                          ) : (
                            <ItemGroup>
                              {[...state.acpRuns.active, ...state.acpRuns.recent].map((run) => (
                                <Item key={run.sessionId} variant="outline" className="border-border bg-muted/30 hover:border-border flex-col items-stretch">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <ItemTitle className="text-foreground flex-wrap gap-2">
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
                                        <span className="text-[10px] text-muted-foreground font-display uppercase tracking-wider">{run.harness}</span>
                                      </ItemTitle>
                                      <ItemDescription className="text-muted-foreground mt-1">{run.task}</ItemDescription>
                                    </div>
                                    <div className="shrink-0 text-right">
                                      {run.status === 'running' && <div className="text-xs font-display text-primary tabular-nums">{run.elapsed}</div>}
                                      <span className="text-xs text-muted-foreground">{run.lastUpdatedLabel}</span>
                                    </div>
                                  </div>
                                  <Separator className="my-1.5 bg-muted/50" />
                                  <div className="grid gap-1.5 text-xs text-muted-foreground md:grid-cols-2">
                                    <div><span className="text-muted-foreground">Session:</span> <span className="font-display">{run.sessionId.slice(0, 8)}</span></div>
                                    <div><span className="text-muted-foreground">Model:</span> <span className="font-display">{run.model ?? '\u2014'}</span></div>
                                    {run.project && <div className="flex items-center gap-1"><span className="text-muted-foreground">Project:</span> <span className="font-display truncate">{run.project}</span></div>}
                                    {run.gitBranch && <div><span className="text-muted-foreground">Branch:</span> <span className="font-display">{run.gitBranch}</span></div>}
                                    {run.workingDirectory && <div className="md:col-span-2"><span className="text-muted-foreground">CWD:</span> <span className="font-display truncate">{run.workingDirectory}</span></div>}
                                    {run.version && <div><span className="text-muted-foreground">Version:</span> <span className="font-display">{run.version}</span></div>}
                                    {run.status !== 'running' && <div><span className="text-muted-foreground">Duration:</span> <span className="font-display tabular-nums">{run.elapsed}</span></div>}
                                  </div>
                                </Item>
                              ))}
                            </ItemGroup>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>
                )}
              </TabsContent>

              {/* ══════════════════ SYSTEM ══════════════════ */}
              <TabsContent value="system">
                {state && (
                  <section className="grid gap-5 xl:grid-cols-2">
                    <div className="flex flex-col gap-5">
                      <Card className={cardClass}>
                        <CardHeader><CardTitle className="text-base font-semibold" style={{ textWrap: 'balance' }}>Gateway &amp; Channels</CardTitle></CardHeader>
                        <CardContent>
                          <div className="grid gap-2 text-sm text-muted-foreground">
                            <div><span className="text-muted-foreground">Service:</span> <span className="font-display text-xs">{state.gateway.service}</span></div>
                            <div><span className="text-muted-foreground">Runtime:</span> <span className="font-display text-xs">{state.gateway.runtime}</span></div>
                            <div><span className="text-muted-foreground">Listening:</span> <span className="font-display text-xs">{state.gateway.listening}</span></div>
                            <div><span className="text-muted-foreground">Logs:</span> <span className="font-display text-xs">{state.gateway.logs}</span></div>
                          </div>
                          <Separator className="my-4 bg-muted" />
                          <ItemGroup>
                            {state.channels.map((ch) => (
                              <Item key={ch.id} variant="outline" size="sm" className="border-border bg-muted/30 hover:border-border">
                                <ItemContent>
                                  <ItemTitle className="font-display text-xs text-foreground">{ch.id}</ItemTitle>
                                  <ItemDescription className="text-muted-foreground">
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
                            <Empty className="border border-dashed border-border">
                              <EmptyHeader>
                                <EmptyMedia variant="icon"><CheckCircle2 className="text-emerald-400" /></EmptyMedia>
                                <EmptyTitle className="text-muted-foreground">No blockers detected</EmptyTitle>
                              </EmptyHeader>
                            </Empty>
                          ) : (
                            <ItemGroup>
                              {state.blockers.slice(0, 8).map((b, i) => {
                                const toneKey: ToneKey = b.severity === 'critical' ? 'critical' : b.severity === 'info' ? 'info' : 'warning'
                                const isLong = b.message.length > 200
                                return (
                                  <Item key={`${b.source}-${i}`} variant="outline" className="border-border bg-muted/30 flex-col items-stretch">
                                    <div className="flex items-center gap-2 text-sm">
                                      <Pill toneKey={toneKey}>{b.severity}</Pill>
                                      <span className="text-xs text-muted-foreground">{b.source}</span>
                                    </div>
                                    {isLong ? (
                                      <Collapsible>
                                        <CollapsibleTrigger className="cursor-pointer text-sm leading-5 text-muted-foreground">{b.message.slice(0, 120)}&hellip;</CollapsibleTrigger>
                                        <CollapsibleContent>
                                          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-black/30 p-3 text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-all">{b.message}</pre>
                                        </CollapsibleContent>
                                      </Collapsible>
                                    ) : (
                                      <p className="text-sm leading-5 text-muted-foreground">{b.message}</p>
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
                        <div className="space-y-4 text-sm leading-5 text-muted-foreground">
                          <div>
                            <div className="mb-1.5 font-medium text-foreground">Live Data</div>
                            <ul className="space-y-1 text-xs text-muted-foreground">
                              <li>Agent registry from <code className="font-display text-muted-foreground">~/.openclaw/openclaw.json</code></li>
                              <li>Sessions from <code className="font-display text-muted-foreground">~/.openclaw/agents/*</code></li>
                              <li>Gateway from <code className="font-display text-muted-foreground">openclaw gateway status</code> + logs</li>
                              <li>ACP runs from <code className="font-display text-muted-foreground">~/.claude/projects/*</code></li>
                              <li>Tasks from local SQLite store</li>
                            </ul>
                          </div>
                          <Separator className="bg-muted" />
                          <div>
                            <div className="mb-1.5 font-medium text-foreground">Limitations</div>
                            <ul className="space-y-1 text-xs text-muted-foreground">
                              <li>Polling-based (15s), not push/live</li>
                              <li>No drag-and-drop on task board yet</li>
                              <li>No direct restart/log actions from UI</li>
                            </ul>
                          </div>
                          <Separator className="bg-muted" />
                          <div>
                            <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
                              <RefreshCw className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Source Paths
                            </div>
                            <div className="space-y-1 break-all text-xs text-muted-foreground">
                              {Object.entries(state.dataSources).map(([key, value]) => (
                                <div key={key}><span className="text-muted-foreground">{key}:</span> <span className="font-display">{value}</span></div>
                              ))}
                            </div>
                          </div>
                          {state.orphanAgentStores.length > 0 && (
                            <>
                              <Separator className="bg-muted" />
                              <div>
                                <div className="mb-1.5 font-medium text-foreground">Orphan Stores</div>
                                <div className="space-y-1 text-xs text-muted-foreground">
                                  {state.orphanAgentStores.map((id) => <div key={id} className="font-display">{id}</div>)}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </CardContent>
                      <CardFooter className="border-border bg-muted/10 text-xs text-muted-foreground">
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
