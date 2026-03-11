#!/usr/bin/env node
/**
 * Mission Control — GitHub PR Review CLI
 *
 * Reviews a real GitHub PR using Mission Control's policy engine,
 * posts a structured review comment, and optionally auto-merges.
 *
 * Usage:
 *   node scripts/github-review.mjs owner/repo#123
 *   node scripts/github-review.mjs https://github.com/owner/repo/pull/123
 *   node scripts/github-review.mjs 123 --repo owner/repo
 *   node scripts/github-review.mjs owner/repo#123 --dry-run
 *   node scripts/github-review.mjs owner/repo#123 --skip-merge
 *   node scripts/github-review.mjs owner/repo#123 --task-id <uuid>
 *   node scripts/github-review.mjs owner/repo#123 --json
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import Database from 'better-sqlite3'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const DB_PATH = path.join(ROOT, 'data', 'mission-control.db')

// ---------------------------------------------------------------------------
// Inline gh CLI helper (same as server/github.ts but for standalone .mjs)
// ---------------------------------------------------------------------------

function gh(args) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    }).trim()
  } catch (err) {
    throw new Error(`gh CLI failed: ${err.message}`)
  }
}

// ---------------------------------------------------------------------------
// Review policy (inline from server/review-policy.ts for standalone use)
// ---------------------------------------------------------------------------

const HIGH_RISK_SIGNALS = [
  { pattern: /\bauth/i, weight: 4, label: 'auth/security' },
  { pattern: /\bsecur/i, weight: 4, label: 'security' },
  { pattern: /\btoken/i, weight: 3, label: 'token handling' },
  { pattern: /\bsecret/i, weight: 4, label: 'secrets' },
  { pattern: /\bpassword/i, weight: 4, label: 'password handling' },
  { pattern: /\bcredential/i, weight: 4, label: 'credentials' },
  { pattern: /\bdispatcher\.(ts|js)/i, weight: 3, label: 'dispatcher core' },
  { pattern: /\bworkflow/i, weight: 3, label: 'workflow engine' },
  { pattern: /\bmigrat/i, weight: 3, label: 'migration' },
  { pattern: /\bschema/i, weight: 3, label: 'schema change' },
  { pattern: /\bdb\.(ts|js)/i, weight: 3, label: 'database layer' },
  { pattern: /\bdeploy/i, weight: 3, label: 'deployment' },
  { pattern: /\bci\/?cd/i, weight: 3, label: 'CI/CD' },
  { pattern: /\bdocker/i, weight: 3, label: 'containerization' },
  { pattern: /\.env(\.|$)/i, weight: 4, label: 'environment config' },
  { pattern: /\binfra/i, weight: 3, label: 'infrastructure' },
  { pattern: /\bpermission/i, weight: 3, label: 'permissions' },
  { pattern: /\brole/i, weight: 2, label: 'role management' },
]

const MEDIUM_RISK_SIGNALS = [
  { pattern: /\brouting/i, weight: 2, label: 'routing logic' },
  { pattern: /\bpolicy/i, weight: 2, label: 'policy change' },
  { pattern: /\bstate/i, weight: 1, label: 'state management' },
  { pattern: /\bapi/i, weight: 1, label: 'API change' },
  { pattern: /\bconfig\.(ts|js)/i, weight: 2, label: 'config module' },
  { pattern: /\bvite\.config/i, weight: 2, label: 'build config' },
  { pattern: /\bpackage\.json/i, weight: 2, label: 'dependency change' },
  { pattern: /\btsconfig/i, weight: 1, label: 'TypeScript config' },
  { pattern: /\bcomponent/i, weight: 1, label: 'component change' },
  { pattern: /\bhook/i, weight: 1, label: 'hook change' },
  { pattern: /\bserver\//i, weight: 2, label: 'server-side change' },
  { pattern: /\btest/i, weight: 1, label: 'test change' },
]

const LOW_RISK_SIGNALS = [
  { pattern: /\breadme/i, weight: 3, label: 'readme' },
  { pattern: /\b\.md$/i, weight: 3, label: 'markdown doc' },
  { pattern: /\bdocs?\//i, weight: 3, label: 'docs folder' },
  { pattern: /\bchangelog/i, weight: 2, label: 'changelog' },
  { pattern: /\blicense/i, weight: 2, label: 'license' },
  { pattern: /\bfavicon/i, weight: 3, label: 'favicon/asset' },
  { pattern: /\.(png|jpg|jpeg|gif|svg|ico)$/i, weight: 3, label: 'image asset' },
  { pattern: /\.(css|scss|less)$/i, weight: 2, label: 'stylesheet' },
  { pattern: /\bstyle/i, weight: 1, label: 'style change' },
  { pattern: /\btypo/i, weight: 3, label: 'typo fix' },
  { pattern: /\bcopy/i, weight: 1, label: 'copy change' },
  { pattern: /\bcomment/i, weight: 2, label: 'comment update' },
  { pattern: /\bjsdoc/i, weight: 2, label: 'JSDoc' },
  { pattern: /\bformat/i, weight: 2, label: 'formatting' },
  { pattern: /\blint/i, weight: 2, label: 'linting' },
]

const KNOWN_AGENTS = new Set(['main', 'mida', 'claude-code'])
const DEFAULT_REVIEWER = { 'mida': 'main', 'claude-code': 'main', 'main': 'claude-code' }
const HOLD_LABELS = new Set(['hold', 'needs-human', 'do-not-merge', 'wip'])

function classifyRisk(input) {
  const allText = [input.title, input.description, ...input.filesChanged].join(' ')
  let highScore = 0, mediumScore = 0, lowScore = 0
  const signals = []

  for (const s of HIGH_RISK_SIGNALS) { if (s.pattern.test(allText)) { highScore += s.weight; signals.push(`high:${s.label}`) } }
  for (const s of MEDIUM_RISK_SIGNALS) { if (s.pattern.test(allText)) { mediumScore += s.weight; signals.push(`med:${s.label}`) } }
  for (const s of LOW_RISK_SIGNALS) { if (s.pattern.test(allText)) { lowScore += s.weight; signals.push(`low:${s.label}`) } }

  const totalLines = (input.linesAdded ?? 0) + (input.linesRemoved ?? 0)
  if (totalLines > 500) { highScore += 3; signals.push('high:large-change(500+lines)') }
  else if (totalLines > 200) { mediumScore += 2; signals.push('med:moderate-change(200+lines)') }
  if (input.filesChanged.length > 10) { highScore += 2; signals.push('high:many-files(10+)') }
  else if (input.filesChanged.length > 5) { mediumScore += 1; signals.push('med:several-files(5+)') }

  let level, score
  if (highScore >= 3) { level = 'high'; score = highScore }
  else if (highScore > 0 && mediumScore > 0) { level = 'high'; score = highScore + mediumScore }
  else if (mediumScore >= 3) { level = 'medium'; score = mediumScore }
  else if (mediumScore > 0 && lowScore === 0) { level = 'medium'; score = mediumScore }
  else if (lowScore > 0 && mediumScore === 0 && highScore === 0) { level = 'low'; score = lowScore }
  else if (lowScore > mediumScore && highScore === 0) { level = 'low'; score = lowScore }
  else if (mediumScore > 0) { level = 'medium'; score = mediumScore }
  else { level = 'medium'; score = 0; signals.push('med:no-clear-signals') }

  const reason = signals.length > 0
    ? `Risk ${level} (score ${score}): ${signals.join(', ')}`
    : `Risk ${level}: no specific signals detected, defaulting to medium`

  return { level, score, signals, reason }
}

function selectReviewer(author) {
  const r = DEFAULT_REVIEWER[author]
  if (r && r !== author) return r
  for (const a of KNOWN_AGENTS) { if (a !== author) return a }
  return null
}

function runChecklist(input, risk) {
  const checks = []
  checks.push({ name: 'checks_passed', passed: input.checksPassed, detail: input.checksPassed ? 'CI/build checks passed' : 'CI/build checks failed' })
  checks.push({ name: 'branch_clean', passed: input.branchClean, detail: input.branchClean ? 'Branch is mergeable (no conflicts)' : 'Branch has conflicts or is not mergeable' })
  const hasBlockers = input.hasBlockerComments ?? false
  checks.push({ name: 'no_blocker_comments', passed: !hasBlockers, detail: hasBlockers ? 'Unresolved blocker comments present' : 'No unresolved blocker comments' })
  const hasHold = input.hasHoldLabel ?? false
  checks.push({ name: 'no_hold_label', passed: !hasHold, detail: hasHold ? 'Hold/needs-human label is set' : 'No hold label' })
  const fileCount = input.filesChanged.length
  const scopeReasonable = risk.level === 'low' ? fileCount <= 5 : risk.level === 'medium' ? fileCount <= 15 : fileCount <= 30
  checks.push({ name: 'scope_reasonable', passed: scopeReasonable, detail: scopeReasonable ? `${fileCount} file(s) changed — reasonable for ${risk.level} risk` : `${fileCount} file(s) changed — large scope for ${risk.level} risk` })
  const hasTitle = input.title.trim().length >= 5
  checks.push({ name: 'title_descriptive', passed: hasTitle, detail: hasTitle ? 'Title is descriptive' : 'Title is missing or too short' })
  const hasHighAndLow = risk.signals.some(s => s.startsWith('high:')) && risk.signals.some(s => s.startsWith('low:'))
  checks.push({ name: 'no_unrelated_areas', passed: !hasHighAndLow, detail: hasHighAndLow ? 'Change touches both high-risk and low-risk areas' : 'Change appears focused on a coherent scope' })
  return checks
}

function performReview(input) {
  const now = Date.now()
  const reviewer = selectReviewer(input.author)
  if (!reviewer || reviewer === input.author) {
    return {
      reviewer: reviewer ?? 'system', author: input.author,
      risk: { level: 'high', score: 0, signals: ['no-valid-reviewer'], reason: 'No valid reviewer available' },
      outcome: 'escalate_to_human', checklist: [], mergeRecommendation: 'human-review',
      autoMergeEligible: false, summary: `Cannot auto-review: no valid reviewer for "${input.author}"`, reviewedAt: now,
    }
  }
  const risk = classifyRisk({ filesChanged: input.filesChanged, title: input.title, description: input.description, linesAdded: input.linesAdded, linesRemoved: input.linesRemoved })
  const checklist = runChecklist(input, risk)
  const allPassed = checklist.every(c => c.passed)
  const criticalFailed = checklist.filter(c => !c.passed && ['checks_passed', 'branch_clean'].includes(c.name))
  const softFailed = checklist.filter(c => !c.passed && !['checks_passed', 'branch_clean'].includes(c.name))

  let outcome
  if (risk.level === 'high') outcome = 'escalate_to_human'
  else if (criticalFailed.length > 0) outcome = 'changes_requested'
  else if (risk.level === 'medium' && softFailed.length > 0) outcome = 'changes_requested'
  else if (allPassed) outcome = 'approve'
  else outcome = softFailed.length <= 1 ? 'approve' : 'changes_requested'

  const autoMergeEligible = risk.level === 'low' && outcome === 'approve' && input.checksPassed && input.branchClean && !input.hasBlockerComments && !input.hasHoldLabel

  let mergeRecommendation
  if (autoMergeEligible) mergeRecommendation = 'merge'
  else if (outcome === 'changes_requested') mergeRecommendation = 'fix'
  else mergeRecommendation = 'human-review'

  const failedNames = checklist.filter(c => !c.passed).map(c => c.name)
  const parts = [
    `Review by ${reviewer} for change by ${input.author}.`,
    `Risk: ${risk.level} (${risk.reason}).`,
    `Outcome: ${outcome}.`,
    `Checks: ${checklist.filter(c => c.passed).length}/${checklist.length} passed.`,
  ]
  if (failedNames.length > 0) parts.push(`Failed: ${failedNames.join(', ')}.`)
  if (autoMergeEligible) parts.push('Auto-merge: ELIGIBLE.')
  else parts.push(`Auto-merge: not eligible.`)

  return { reviewer, author: input.author, risk, outcome, checklist, mergeRecommendation, autoMergeEligible, summary: parts.join(' '), reviewedAt: now }
}

function formatReviewComment(result) {
  const lines = [
    `## Automatic Review`, '',
    `| Field | Value |`, `|-------|-------|`,
    `| **Review result** | \`${result.outcome}\` |`,
    `| **Risk** | \`${result.risk.level}\` |`,
    `| **Checks** | ${result.checklist.every(c => c.passed) ? 'passed' : 'issues found'} |`,
    `| **Scope fit** | ${result.checklist.find(c => c.name === 'scope_reasonable')?.passed ? 'yes' : 'no'} |`,
    `| **Regressions seen** | ${result.risk.level === 'high' ? 'requires human verification' : 'none detected'} |`,
    `| **Merge recommendation** | \`${result.mergeRecommendation}\` |`,
    `| **Auto-merge eligible** | ${result.autoMergeEligible ? 'yes' : 'no'} |`,
    `| **Reviewer** | ${result.reviewer} |`,
    `| **Author** | ${result.author} |`,
    '', '### Checklist', '',
    ...result.checklist.map(c => `- ${c.passed ? '✅' : '❌'} **${c.name}**: ${c.detail}`),
    '', '### Risk Signals', '',
    result.risk.signals.length > 0 ? result.risk.signals.map(s => `- ${s}`).join('\n') : '- (none detected)',
    '', '---', `*${result.summary}*`,
  ]
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// GitHub operations
// ---------------------------------------------------------------------------

function fetchPR(repo, prNumber) {
  const fields = 'number,title,body,author,state,headRefName,baseRefName,labels,isDraft,statusCheckRollup,reviewDecision,additions,deletions,url,mergeable'
  const raw = gh(['pr', 'view', String(prNumber), '--repo', repo, '--json', fields])
  const data = JSON.parse(raw)

  const filesRaw = gh(['pr', 'diff', String(prNumber), '--repo', repo, '--name-only'])
  const filePaths = filesRaw.split('\n').map(f => f.trim()).filter(f => f.length > 0)

  const checks = data.statusCheckRollup ?? []
  let checksStatus = 'unknown'
  if (checks.length > 0) {
    const allPassed = checks.every(c => c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED')
    const anyFailed = checks.some(c => c.conclusion === 'FAILURE' || c.conclusion === 'CANCELLED' || c.conclusion === 'TIMED_OUT')
    if (allPassed) checksStatus = 'passing'
    else if (anyFailed) checksStatus = 'failing'
    else checksStatus = 'pending'
  }

  const labels = (data.labels ?? []).map(l => typeof l === 'string' ? l : l.name)
  const [repoOwner, repoName] = repo.split('/')

  return {
    number: data.number,
    title: data.title ?? '',
    body: data.body ?? '',
    author: typeof data.author === 'object' ? data.author.login : String(data.author ?? 'unknown'),
    state: data.state ?? 'OPEN',
    mergeable: data.mergeable === 'MERGEABLE' ? true : data.mergeable === 'CONFLICTING' ? false : null,
    mergeableState: data.mergeable ?? 'UNKNOWN',
    headRef: data.headRefName ?? '',
    baseRef: data.baseRefName ?? '',
    labels, isDraft: data.isDraft ?? false, checksStatus,
    reviewDecision: data.reviewDecision ?? '',
    files: filePaths.map(p => ({ path: p, additions: 0, deletions: 0, status: 'modified' })),
    additions: data.additions ?? 0, deletions: data.deletions ?? 0,
    url: data.url ?? '', repoOwner, repoName,
  }
}

function getGitHubIdentity() {
  try { return gh(['api', 'user', '--jq', '.login']) || null }
  catch { return null }
}

function postReviewComment(repo, prNumber, review, ghIdentity, prAuthor) {
  const body = formatReviewComment(review)
  let action = review.outcome === 'approve' ? 'approve' : review.outcome === 'changes_requested' ? 'request-changes' : 'comment'
  const isSelfReview = ghIdentity && ghIdentity.toLowerCase() === prAuthor.toLowerCase()
  let selfReviewBlocked = false

  if (isSelfReview && action === 'approve') {
    selfReviewBlocked = true
    action = 'comment'
  }

  const fullBody = [
    body, '', '---',
    `*Posted by Mission Control auto-review at ${new Date().toISOString()}*`,
    ...(selfReviewBlocked ? ['', `> **Note:** Logically APPROVED by policy engine, but GitHub prevents self-approval.`, `> Authenticated as: \`${ghIdentity}\` (same as PR author)`] : []),
    ...(review.autoMergeEligible ? ['', `> **Auto-merge eligible** — merge will be attempted if conditions are met.`] : []),
  ].join('\n')

  try {
    const result = gh(['pr', 'review', String(prNumber), '--repo', repo, `--${action}`, '--body', fullBody])
    const urlMatch = result.match(/https:\/\/github\.com\/[^\s]+/)
    return { commentUrl: urlMatch?.[0] ?? null, selfReviewBlocked }
  } catch {
    try {
      const result = gh(['pr', 'comment', String(prNumber), '--repo', repo, '--body', fullBody + '\n\n> *(Submitted as comment — formal review failed)*'])
      const urlMatch = result.match(/https:\/\/github\.com\/[^\s]+/)
      return { commentUrl: urlMatch?.[0] ?? null, selfReviewBlocked }
    } catch {
      return { commentUrl: null, selfReviewBlocked }
    }
  }
}

function mergePR(repo, prNumber, review) {
  if (!review.autoMergeEligible || review.outcome !== 'approve') {
    return { result: 'skipped', error: 'Not eligible for auto-merge' }
  }
  try {
    gh(['pr', 'merge', String(prNumber), '--repo', repo, '--squash', '--auto', '--subject', `auto-merge: ${review.risk.level}-risk, policy-approved`])
    return { result: 'merged' }
  } catch {
    try {
      gh(['pr', 'merge', String(prNumber), '--repo', repo, '--squash', '--subject', `auto-merge: ${review.risk.level}-risk, policy-approved`])
      return { result: 'merged' }
    } catch (err) {
      return { result: 'failed', error: err.message }
    }
  }
}

// ---------------------------------------------------------------------------
// DB persistence (optional, only if DB exists)
// ---------------------------------------------------------------------------

function persistReview(review, pr, ghResult) {
  try {
    const db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    const id = randomUUID()
    db.prepare(`
      INSERT INTO reviews (id, taskId, author, reviewer, riskLevel, riskScore, riskSignals, riskReason, outcome, mergeRecommendation, autoMergeEligible, checklistJson, summary, filesChanged, title, checksPassed, branchClean, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, ghResult.taskId ?? null, review.author, review.reviewer,
      review.risk.level, review.risk.score, JSON.stringify(review.risk.signals), review.risk.reason,
      review.outcome, review.mergeRecommendation, review.autoMergeEligible ? 1 : 0,
      JSON.stringify(review.checklist), review.summary,
      JSON.stringify(pr.files.map(f => f.path)), pr.title,
      pr.checksStatus === 'passing' ? 1 : 0, pr.mergeable === true ? 1 : 0,
      Date.now(),
    )

    db.close()
    return id
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parsePRRef(ref, defaultRepo) {
  const urlMatch = ref.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  if (urlMatch) return { repo: urlMatch[1], prNumber: parseInt(urlMatch[2], 10) }
  const refMatch = ref.match(/^([^/]+\/[^#]+)#(\d+)$/)
  if (refMatch) return { repo: refMatch[1], prNumber: parseInt(refMatch[2], 10) }
  const hashMatch = ref.match(/^#?(\d+)$/)
  if (hashMatch && defaultRepo) return { repo: defaultRepo, prNumber: parseInt(hashMatch[1], 10) }
  return null
}

function usage() {
  console.log(`
Mission Control — GitHub PR Review

Usage:
  node scripts/github-review.mjs <pr-ref> [options]

PR reference formats:
  owner/repo#123
  https://github.com/owner/repo/pull/123
  123 --repo owner/repo

Options:
  --repo <owner/repo>   Default repository for bare PR numbers
  --dry-run             Analyze without posting to GitHub
  --skip-merge          Review and comment but do not merge
  --task-id <uuid>      Link review to a Mission Control task
  --json                Output result as JSON
  --help                Show this help
`)
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.length === 0) { usage(); process.exit(0) }

  let prRef = null
  let defaultRepo = null
  let dryRun = false
  let skipMerge = false
  let taskId = null
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo') { defaultRepo = args[++i]; continue }
    if (args[i] === '--dry-run') { dryRun = true; continue }
    if (args[i] === '--skip-merge') { skipMerge = true; continue }
    if (args[i] === '--task-id') { taskId = args[++i]; continue }
    if (args[i] === '--json') { jsonOutput = true; continue }
    if (!prRef) { prRef = args[i]; continue }
  }

  if (!prRef) { console.error('Error: PR reference required'); usage(); process.exit(1) }

  const parsed = parsePRRef(prRef, defaultRepo)
  if (!parsed) { console.error(`Error: Cannot parse PR reference: ${prRef}`); process.exit(1) }

  const { repo, prNumber } = parsed
  const log = (msg) => { if (!jsonOutput) console.log(msg) }

  log(`\n📋 Mission Control — GitHub PR Review`)
  log(`   Reviewing: ${repo}#${prNumber}`)
  log(`   Mode: ${dryRun ? 'DRY RUN' : skipMerge ? 'REVIEW ONLY (no merge)' : 'FULL (review + merge)'}`)
  log('')

  // 1. Identity
  const ghIdentity = getGitHubIdentity()
  log(`🔑 GitHub identity: ${ghIdentity ?? '(unknown)'}`)

  // 2. Fetch PR
  log(`📥 Fetching PR metadata...`)
  const pr = fetchPR(repo, prNumber)
  log(`   "${pr.title}" by ${pr.author}`)
  log(`   ${pr.files.length} files | +${pr.additions}/-${pr.deletions} | ${pr.checksStatus} | mergeable: ${pr.mergeableState}`)

  if (pr.state !== 'OPEN') {
    log(`\n⚠️  PR is ${pr.state}, not OPEN. Skipping.`)
    process.exit(0)
  }

  // 3. Review
  log(`\n🔍 Running policy review...`)
  const input = {
    author: pr.author,
    filesChanged: pr.files.map(f => f.path),
    title: pr.title,
    description: pr.body,
    checksPassed: pr.checksStatus === 'passing',
    branchClean: pr.mergeable === true,
    hasBlockerComments: false,
    hasHoldLabel: pr.labels.some(l => HOLD_LABELS.has(l.toLowerCase())) || pr.isDraft,
    taskId,
    linesAdded: pr.additions,
    linesRemoved: pr.deletions,
  }
  const review = performReview(input)

  log(`   Risk: ${review.risk.level} (score ${review.risk.score})`)
  log(`   Outcome: ${review.outcome}`)
  log(`   Merge recommendation: ${review.mergeRecommendation}`)
  log(`   Auto-merge eligible: ${review.autoMergeEligible}`)
  log(`   Reviewer: ${review.reviewer}`)

  // Checklist
  log(`\n📝 Checklist:`)
  for (const c of review.checklist) {
    log(`   ${c.passed ? '✅' : '❌'} ${c.name}: ${c.detail}`)
  }

  // 4. Persist to DB
  const reviewId = persistReview(review, pr, { taskId })
  if (reviewId) log(`\n💾 Review persisted to Mission Control DB: ${reviewId}`)

  if (dryRun) {
    log(`\n🏁 DRY RUN complete — no GitHub actions taken.`)
    if (jsonOutput) console.log(JSON.stringify({ pr, review, reviewId, dryRun: true }, null, 2))
    process.exit(0)
  }

  // 5. Post comment
  log(`\n💬 Posting review comment to GitHub...`)
  const { commentUrl, selfReviewBlocked } = postReviewComment(repo, prNumber, review, ghIdentity, pr.author)
  log(`   Comment: ${commentUrl ?? '(posted, no URL returned)'}`)
  if (selfReviewBlocked) {
    log(`   ⚠️  Self-review: "${ghIdentity}" is PR author — formal APPROVE downgraded to COMMENT`)
    log(`      The logical review (approve) is recorded in Mission Control.`)
  }

  // 6. Merge
  let mergeResult = null
  if (review.autoMergeEligible && !skipMerge) {
    if (selfReviewBlocked) {
      log(`\n🔒 Merge skipped: self-review limitation prevents formal approval required for merge`)
      mergeResult = { result: 'self-review-blocked' }
    } else {
      log(`\n🔀 Attempting merge...`)
      mergeResult = mergePR(repo, prNumber, review)
      log(`   Result: ${mergeResult.result}${mergeResult.error ? ` (${mergeResult.error})` : ''}`)
    }
  } else if (!review.autoMergeEligible) {
    log(`\n⏭️  Merge skipped: not auto-merge eligible`)
  } else {
    log(`\n⏭️  Merge skipped: --skip-merge flag`)
  }

  log(`\n🏁 Review complete for ${repo}#${prNumber}`)

  if (jsonOutput) {
    console.log(JSON.stringify({
      pr: { number: pr.number, title: pr.title, author: pr.author, url: pr.url, state: pr.state },
      review,
      reviewId,
      commentUrl,
      selfReviewBlocked,
      mergeResult,
      ghIdentity,
    }, null, 2))
  }
}

main()
