/**
 * Mission Control — Auto-Review + Auto-Merge Policy Engine
 *
 * Implements the AUTO_REVIEW_POLICY:
 * 1. Deterministic risk classification (low / medium / high)
 * 2. Author ≠ reviewer enforcement (hard rule)
 * 3. Review checklist evaluation with structured outcomes
 * 4. Conditional auto-merge eligibility (low-risk clean cases only)
 *
 * ── Risk classification ──────────────────────────────────────────────
 *
 * risk:low  — docs, copy, assets, small visual/UI tweaks, tiny refactors
 * risk:medium — multi-file features, routing/policy, state management
 * risk:high — auth/security, dispatcher core, workflow engine, DB schema,
 *             deployment/runtime, anything with costly regressions
 *
 * ── Review outcomes ──────────────────────────────────────────────────
 *
 * approve           — all checks pass, scope is clean
 * changes_requested — issues found that must be fixed
 * escalate_to_human — risk too high or ambiguous for auto-decision
 * ─────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = 'low' | 'medium' | 'high'

export type ReviewOutcome = 'approve' | 'changes_requested' | 'escalate_to_human'

export type MergeRecommendation = 'merge' | 'fix' | 'human-review'

export type ReviewCheckItem = {
  name: string
  passed: boolean
  detail: string
}

export type RiskClassification = {
  level: RiskLevel
  score: number
  signals: string[]
  reason: string
}

export type ReviewInput = {
  /** The actor/agent that authored the change */
  author: string
  /** Files changed (paths relative to repo root) */
  filesChanged: string[]
  /** PR/change title */
  title: string
  /** PR/change description/body */
  description: string
  /** Whether CI/build checks passed */
  checksPassed: boolean
  /** Whether the branch is mergeable (no conflicts) */
  branchClean: boolean
  /** Whether there are unresolved blocker comments */
  hasBlockerComments?: boolean
  /** Whether a hold/needs-human label is present */
  hasHoldLabel?: boolean
  /** Optional: task ID this review is linked to */
  taskId?: string
  /** Lines added (approximate) */
  linesAdded?: number
  /** Lines removed (approximate) */
  linesRemoved?: number
}

export type ReviewResult = {
  /** Unique review ID (assigned by caller) */
  id?: string
  /** The reviewer actor */
  reviewer: string
  /** The author actor */
  author: string
  /** Risk classification */
  risk: RiskClassification
  /** Review outcome */
  outcome: ReviewOutcome
  /** Individual checklist results */
  checklist: ReviewCheckItem[]
  /** Merge recommendation */
  mergeRecommendation: MergeRecommendation
  /** Whether auto-merge is allowed by policy */
  autoMergeEligible: boolean
  /** Human-readable summary */
  summary: string
  /** Timestamp */
  reviewedAt: number
}

// ---------------------------------------------------------------------------
// Constants — known agents and default reviewer routing
// ---------------------------------------------------------------------------

const KNOWN_AGENTS = new Set(['main', 'mida', 'claude-code'])

/**
 * Default reviewer for each author, per policy:
 * - mida → main
 * - claude-code → main
 * - main → claude-code
 */
const DEFAULT_REVIEWER: Record<string, string> = {
  'mida': 'main',
  'claude-code': 'main',
  'main': 'claude-code',
}

// ---------------------------------------------------------------------------
// Risk classification — file-pattern scoring
// ---------------------------------------------------------------------------

type RiskSignal = { pattern: RegExp; weight: number; label: string }

const HIGH_RISK_SIGNALS: RiskSignal[] = [
  { pattern: /\bauth/i,                   weight: 4, label: 'auth/security' },
  { pattern: /\bsecur/i,                  weight: 4, label: 'security' },
  { pattern: /\btoken/i,                  weight: 3, label: 'token handling' },
  { pattern: /\bsecret/i,                 weight: 4, label: 'secrets' },
  { pattern: /\bpassword/i,               weight: 4, label: 'password handling' },
  { pattern: /\bcredential/i,             weight: 4, label: 'credentials' },
  { pattern: /\bdispatcher\.(ts|js)/i,    weight: 3, label: 'dispatcher core' },
  { pattern: /\bworkflow/i,               weight: 3, label: 'workflow engine' },
  { pattern: /\bmigrat/i,                 weight: 3, label: 'migration' },
  { pattern: /\bschema/i,                 weight: 3, label: 'schema change' },
  { pattern: /\bdb\.(ts|js)/i,            weight: 3, label: 'database layer' },
  { pattern: /\bdeploy/i,                 weight: 3, label: 'deployment' },
  { pattern: /\bci\/?cd/i,               weight: 3, label: 'CI/CD' },
  { pattern: /\bdocker/i,                 weight: 3, label: 'containerization' },
  { pattern: /\.env(\.|$)/i,              weight: 4, label: 'environment config' },
  { pattern: /\binfra/i,                  weight: 3, label: 'infrastructure' },
  { pattern: /\bpermission/i,             weight: 3, label: 'permissions' },
  { pattern: /\brole/i,                   weight: 2, label: 'role management' },
]

const MEDIUM_RISK_SIGNALS: RiskSignal[] = [
  { pattern: /\brouting/i,                weight: 2, label: 'routing logic' },
  { pattern: /\bpolicy/i,                 weight: 2, label: 'policy change' },
  { pattern: /\bstate/i,                  weight: 1, label: 'state management' },
  { pattern: /\bapi/i,                    weight: 1, label: 'API change' },
  { pattern: /\bconfig\.(ts|js)/i,        weight: 2, label: 'config module' },
  { pattern: /\bvite\.config/i,           weight: 2, label: 'build config' },
  { pattern: /\bpackage\.json/i,          weight: 2, label: 'dependency change' },
  { pattern: /\btsconfig/i,               weight: 1, label: 'TypeScript config' },
  { pattern: /\bcomponent/i,              weight: 1, label: 'component change' },
  { pattern: /\bhook/i,                   weight: 1, label: 'hook change' },
  { pattern: /\bserver\//i,              weight: 2, label: 'server-side change' },
  { pattern: /\btest/i,                   weight: 1, label: 'test change' },
]

const LOW_RISK_SIGNALS: RiskSignal[] = [
  { pattern: /\breadme/i,                 weight: 3, label: 'readme' },
  { pattern: /\b\.md$/i,                  weight: 3, label: 'markdown doc' },
  { pattern: /\bdocs?\//i,               weight: 3, label: 'docs folder' },
  { pattern: /\bchangelog/i,              weight: 2, label: 'changelog' },
  { pattern: /\blicense/i,                weight: 2, label: 'license' },
  { pattern: /\bfavicon/i,                weight: 3, label: 'favicon/asset' },
  { pattern: /\.(png|jpg|jpeg|gif|svg|ico)$/i, weight: 3, label: 'image asset' },
  { pattern: /\.(css|scss|less)$/i,       weight: 2, label: 'stylesheet' },
  { pattern: /\bstyle/i,                  weight: 1, label: 'style change' },
  { pattern: /\btypo/i,                   weight: 3, label: 'typo fix' },
  { pattern: /\bcopy/i,                   weight: 1, label: 'copy change' },
  { pattern: /\bcomment/i,                weight: 2, label: 'comment update' },
  { pattern: /\bjsdoc/i,                  weight: 2, label: 'JSDoc' },
  { pattern: /\bformat/i,                 weight: 2, label: 'formatting' },
  { pattern: /\blint/i,                   weight: 2, label: 'linting' },
]

/**
 * Classify the risk level of a change based on files changed, title,
 * and description. Returns a deterministic risk classification.
 */
export function classifyRisk(input: {
  filesChanged: string[]
  title: string
  description: string
  linesAdded?: number
  linesRemoved?: number
}): RiskClassification {
  const allText = [
    input.title,
    input.description,
    ...input.filesChanged,
  ].join(' ')

  let highScore = 0
  let mediumScore = 0
  let lowScore = 0
  const signals: string[] = []

  for (const signal of HIGH_RISK_SIGNALS) {
    if (signal.pattern.test(allText)) {
      highScore += signal.weight
      signals.push(`high:${signal.label}`)
    }
  }

  for (const signal of MEDIUM_RISK_SIGNALS) {
    if (signal.pattern.test(allText)) {
      mediumScore += signal.weight
      signals.push(`med:${signal.label}`)
    }
  }

  for (const signal of LOW_RISK_SIGNALS) {
    if (signal.pattern.test(allText)) {
      lowScore += signal.weight
      signals.push(`low:${signal.label}`)
    }
  }

  // Heuristic: large changes bump risk
  const totalLines = (input.linesAdded ?? 0) + (input.linesRemoved ?? 0)
  if (totalLines > 500) {
    highScore += 3
    signals.push('high:large-change(500+lines)')
  } else if (totalLines > 200) {
    mediumScore += 2
    signals.push('med:moderate-change(200+lines)')
  }

  // Many files also bump risk
  if (input.filesChanged.length > 10) {
    highScore += 2
    signals.push('high:many-files(10+)')
  } else if (input.filesChanged.length > 5) {
    mediumScore += 1
    signals.push('med:several-files(5+)')
  }

  // Determine level: high signals dominate, then compare medium vs low
  let level: RiskLevel
  let score: number

  if (highScore >= 3) {
    level = 'high'
    score = highScore
  } else if (highScore > 0 && mediumScore > 0) {
    level = 'high'
    score = highScore + mediumScore
  } else if (mediumScore >= 3) {
    level = 'medium'
    score = mediumScore
  } else if (mediumScore > 0 && lowScore === 0) {
    level = 'medium'
    score = mediumScore
  } else if (lowScore > 0 && mediumScore === 0 && highScore === 0) {
    level = 'low'
    score = lowScore
  } else if (lowScore > mediumScore && highScore === 0) {
    level = 'low'
    score = lowScore
  } else if (mediumScore > 0) {
    level = 'medium'
    score = mediumScore
  } else {
    // No signals at all — default to medium (cautious)
    level = 'medium'
    score = 0
    signals.push('med:no-clear-signals')
  }

  const reason = signals.length > 0
    ? `Risk ${level} (score ${score}): ${signals.join(', ')}`
    : `Risk ${level}: no specific signals detected, defaulting to medium`

  return { level, score, signals, reason }
}

// ---------------------------------------------------------------------------
// Reviewer selection — author ≠ reviewer (hard rule)
// ---------------------------------------------------------------------------

/**
 * Select a reviewer for a given author. The reviewer MUST differ from the author.
 * Returns null if no valid reviewer can be determined.
 */
export function selectReviewer(author: string): string | null {
  // Use default routing table
  const defaultReviewer = DEFAULT_REVIEWER[author]
  if (defaultReviewer && defaultReviewer !== author) {
    return defaultReviewer
  }

  // Fallback: pick any known agent that isn't the author
  for (const agent of KNOWN_AGENTS) {
    if (agent !== author) return agent
  }

  return null
}

/**
 * Validate that author and reviewer are different actors.
 * Returns true if the pair is valid.
 */
export function validateAuthorReviewerPair(author: string, reviewer: string): boolean {
  return author !== reviewer
}

// ---------------------------------------------------------------------------
// Review checklist
// ---------------------------------------------------------------------------

function runChecklist(input: ReviewInput, risk: RiskClassification): ReviewCheckItem[] {
  const checks: ReviewCheckItem[] = []

  // 1. Build/checks passed
  checks.push({
    name: 'checks_passed',
    passed: input.checksPassed,
    detail: input.checksPassed ? 'CI/build checks passed' : 'CI/build checks failed',
  })

  // 2. Branch is clean/mergeable
  checks.push({
    name: 'branch_clean',
    passed: input.branchClean,
    detail: input.branchClean ? 'Branch is mergeable (no conflicts)' : 'Branch has conflicts or is not mergeable',
  })

  // 3. No blocker comments
  const hasBlockers = input.hasBlockerComments ?? false
  checks.push({
    name: 'no_blocker_comments',
    passed: !hasBlockers,
    detail: hasBlockers ? 'Unresolved blocker comments present' : 'No unresolved blocker comments',
  })

  // 4. No hold label
  const hasHold = input.hasHoldLabel ?? false
  checks.push({
    name: 'no_hold_label',
    passed: !hasHold,
    detail: hasHold ? 'Hold/needs-human label is set' : 'No hold label',
  })

  // 5. Scope is reasonable (heuristic: file count relative to risk)
  const fileCount = input.filesChanged.length
  const scopeReasonable = risk.level === 'low'
    ? fileCount <= 5
    : risk.level === 'medium'
      ? fileCount <= 15
      : fileCount <= 30
  checks.push({
    name: 'scope_reasonable',
    passed: scopeReasonable,
    detail: scopeReasonable
      ? `${fileCount} file(s) changed — reasonable for ${risk.level} risk`
      : `${fileCount} file(s) changed — large scope for ${risk.level} risk`,
  })

  // 6. Title present and descriptive
  const hasTitle = input.title.trim().length >= 5
  checks.push({
    name: 'title_descriptive',
    passed: hasTitle,
    detail: hasTitle ? 'Title is descriptive' : 'Title is missing or too short',
  })

  // 7. No unrelated areas touched (heuristic: check for mixed signals)
  const hasHighAndLow = risk.signals.some(s => s.startsWith('high:')) && risk.signals.some(s => s.startsWith('low:'))
  checks.push({
    name: 'no_unrelated_areas',
    passed: !hasHighAndLow,
    detail: hasHighAndLow
      ? 'Change touches both high-risk and low-risk areas — may include unrelated changes'
      : 'Change appears focused on a coherent scope',
  })

  return checks
}

// ---------------------------------------------------------------------------
// Core review function
// ---------------------------------------------------------------------------

/**
 * Perform an automatic review on a change. Returns a structured ReviewResult.
 *
 * This is the main entry point for the review engine.
 */
export function performReview(input: ReviewInput): ReviewResult {
  const now = Date.now()

  // 1. Select reviewer (must differ from author)
  const reviewer = selectReviewer(input.author)
  if (!reviewer) {
    return {
      reviewer: 'system',
      author: input.author,
      risk: { level: 'high', score: 0, signals: ['no-valid-reviewer'], reason: 'No valid reviewer available for this author' },
      outcome: 'escalate_to_human',
      checklist: [],
      mergeRecommendation: 'human-review',
      autoMergeEligible: false,
      summary: `Cannot auto-review: no valid reviewer found for author "${input.author}" (author ≠ reviewer is a hard rule).`,
      reviewedAt: now,
    }
  }

  // Hard rule: validate author ≠ reviewer
  if (!validateAuthorReviewerPair(input.author, reviewer)) {
    return {
      reviewer,
      author: input.author,
      risk: { level: 'high', score: 0, signals: ['self-review-blocked'], reason: 'Self-review is not allowed' },
      outcome: 'escalate_to_human',
      checklist: [],
      mergeRecommendation: 'human-review',
      autoMergeEligible: false,
      summary: `POLICY VIOLATION: author "${input.author}" cannot self-review. Escalating to human.`,
      reviewedAt: now,
    }
  }

  // 2. Classify risk
  const risk = classifyRisk({
    filesChanged: input.filesChanged,
    title: input.title,
    description: input.description,
    linesAdded: input.linesAdded,
    linesRemoved: input.linesRemoved,
  })

  // 3. Run checklist
  const checklist = runChecklist(input, risk)
  const allChecksPassed = checklist.every(c => c.passed)
  const criticalFailed = checklist.filter(c => !c.passed && ['checks_passed', 'branch_clean'].includes(c.name))
  const softFailed = checklist.filter(c => !c.passed && !['checks_passed', 'branch_clean'].includes(c.name))

  // 4. Determine outcome
  let outcome: ReviewOutcome
  if (risk.level === 'high') {
    // High risk: always escalate unless everything is perfect (then just approve for record)
    outcome = allChecksPassed ? 'escalate_to_human' : 'escalate_to_human'
  } else if (criticalFailed.length > 0) {
    // Critical checks failed → changes_requested
    outcome = 'changes_requested'
  } else if (risk.level === 'medium' && softFailed.length > 0) {
    // Medium risk with soft failures → changes_requested
    outcome = 'changes_requested'
  } else if (allChecksPassed) {
    outcome = 'approve'
  } else {
    // Low risk with only soft failures → approve with notes
    outcome = softFailed.length <= 1 ? 'approve' : 'changes_requested'
  }

  // 5. Determine merge eligibility
  const autoMergeEligible = checkMergeEligibility(risk.level, outcome, input)

  // 6. Merge recommendation
  let mergeRecommendation: MergeRecommendation
  if (autoMergeEligible) {
    mergeRecommendation = 'merge'
  } else if (outcome === 'changes_requested') {
    mergeRecommendation = 'fix'
  } else {
    mergeRecommendation = 'human-review'
  }

  // 7. Summary
  const failedNames = checklist.filter(c => !c.passed).map(c => c.name)
  const summary = buildSummary(outcome, risk, checklist, autoMergeEligible, reviewer, input.author, failedNames)

  return {
    reviewer,
    author: input.author,
    risk,
    outcome,
    checklist,
    mergeRecommendation,
    autoMergeEligible,
    summary,
    reviewedAt: now,
  }
}

// ---------------------------------------------------------------------------
// Merge eligibility — per policy
// ---------------------------------------------------------------------------

/**
 * Check whether a PR is eligible for automatic merge.
 * All conditions from the policy must be true:
 *
 * 1. Risk level allows auto-merge (low only for v1)
 * 2. Review result is 'approve'
 * 3. Build/checks passed
 * 4. Branch is clean/mergeable
 * 5. No unresolved blocker comments
 * 6. No hold/needs-human label
 */
function checkMergeEligibility(
  risk: RiskLevel,
  outcome: ReviewOutcome,
  input: ReviewInput,
): boolean {
  // Condition 1: Only low risk allows auto-merge in v1
  if (risk !== 'low') return false

  // Condition 2: Must be approved
  if (outcome !== 'approve') return false

  // Condition 3: Checks must pass
  if (!input.checksPassed) return false

  // Condition 4: Branch must be clean
  if (!input.branchClean) return false

  // Condition 5: No blocker comments
  if (input.hasBlockerComments) return false

  // Condition 6: No hold label
  if (input.hasHoldLabel) return false

  return true
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSummary(
  outcome: ReviewOutcome,
  risk: RiskClassification,
  checklist: ReviewCheckItem[],
  autoMergeEligible: boolean,
  reviewer: string,
  author: string,
  failedChecks: string[],
): string {
  const parts: string[] = []

  parts.push(`Review by ${reviewer} for change by ${author}.`)
  parts.push(`Risk: ${risk.level} (${risk.reason}).`)
  parts.push(`Outcome: ${outcome}.`)
  parts.push(`Checks: ${checklist.filter(c => c.passed).length}/${checklist.length} passed.`)

  if (failedChecks.length > 0) {
    parts.push(`Failed: ${failedChecks.join(', ')}.`)
  }

  if (autoMergeEligible) {
    parts.push('Auto-merge: ELIGIBLE — all conditions met for low-risk clean merge.')
  } else if (risk.level === 'low' && outcome === 'approve') {
    parts.push('Auto-merge: blocked (missing merge conditions).')
  } else if (risk.level !== 'low') {
    parts.push(`Auto-merge: not allowed for ${risk.level}-risk changes.`)
  } else {
    parts.push('Auto-merge: not eligible.')
  }

  return parts.join(' ')
}

/**
 * Format a ReviewResult as a structured comment (per policy spec).
 */
export function formatReviewComment(result: ReviewResult): string {
  const lines: string[] = [
    `## Automatic Review`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Review result** | \`${result.outcome}\` |`,
    `| **Risk** | \`${result.risk.level}\` |`,
    `| **Checks** | ${result.checklist.every(c => c.passed) ? 'passed' : 'issues found'} |`,
    `| **Scope fit** | ${result.checklist.find(c => c.name === 'scope_reasonable')?.passed ? 'yes' : 'no'} |`,
    `| **Regressions seen** | ${result.risk.level === 'high' ? 'requires human verification' : 'none detected'} |`,
    `| **Merge recommendation** | \`${result.mergeRecommendation}\` |`,
    `| **Auto-merge eligible** | ${result.autoMergeEligible ? 'yes' : 'no'} |`,
    `| **Reviewer** | ${result.reviewer} |`,
    `| **Author** | ${result.author} |`,
    '',
    '### Checklist',
    '',
    ...result.checklist.map(c => `- ${c.passed ? '✅' : '❌'} **${c.name}**: ${c.detail}`),
    '',
    `### Risk Signals`,
    '',
    result.risk.signals.length > 0
      ? result.risk.signals.map(s => `- ${s}`).join('\n')
      : '- (none detected)',
    '',
    '---',
    `*${result.summary}*`,
  ]

  return lines.join('\n')
}
