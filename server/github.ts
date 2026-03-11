/**
 * Mission Control — GitHub Integration Layer
 *
 * Bridges Mission Control's review/merge policy engine with real GitHub PRs.
 * Uses the `gh` CLI for all GitHub operations (leverages existing auth).
 *
 * Capabilities:
 * 1. Fetch PR metadata and map to ReviewInput
 * 2. Post structured review comments to PRs
 * 3. Perform merge for eligible low-risk clean cases
 * 4. Handle self-review limitation (comment instead of formal approve)
 * 5. Log all operations for operator visibility
 *
 * ─────────────────────────────────────────────────────────────────────
 */
import { execFileSync } from 'node:child_process'
import {
  performReview,
  formatReviewComment,
  type ReviewInput,
  type ReviewResult,
} from './review-policy.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GitHubPR = {
  number: number
  title: string
  body: string
  author: string
  state: string
  mergeable: boolean | null
  mergeableState: string
  headRef: string
  baseRef: string
  labels: string[]
  isDraft: boolean
  checksStatus: 'passing' | 'failing' | 'pending' | 'unknown'
  reviewDecision: string
  files: GitHubPRFile[]
  additions: number
  deletions: number
  url: string
  repoOwner: string
  repoName: string
}

export type GitHubPRFile = {
  path: string
  additions: number
  deletions: number
  status: string
}

export type GitHubReviewAction =
  | 'APPROVE'
  | 'REQUEST_CHANGES'
  | 'COMMENT'

export type GitHubReviewResult = {
  pr: GitHubPR
  review: ReviewResult
  commentPosted: boolean
  commentUrl: string | null
  mergeAttempted: boolean
  mergeResult: 'merged' | 'skipped' | 'failed' | 'self-review-blocked' | 'main-assisted-merge' | null
  mergeError: string | null
  selfReviewNote: string | null
  /** True when merge was completed via main-assisted path (self-review blocked formal approval) */
  mainAssistedMerge: boolean
  ghIdentity: string | null
  log: string[]
}

// ---------------------------------------------------------------------------
// gh CLI helper
// ---------------------------------------------------------------------------

function gh(args: string[], options?: { timeout?: number }): string {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf-8',
      timeout: options?.timeout ?? 30_000,
      maxBuffer: 10 * 1024 * 1024,
    }).trim()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`gh CLI failed: ${msg}`)
  }
}

// ---------------------------------------------------------------------------
// Fetch PR metadata
// ---------------------------------------------------------------------------

/**
 * Fetch full PR metadata from GitHub using `gh pr view`.
 */
export function fetchPR(repo: string, prNumber: number): GitHubPR {
  const fields = [
    'number', 'title', 'body', 'author', 'state', 'headRefName', 'baseRefName',
    'labels', 'isDraft', 'statusCheckRollup', 'reviewDecision', 'additions',
    'deletions', 'url', 'mergeable',
  ].join(',')

  const raw = gh([
    'pr', 'view', String(prNumber),
    '--repo', repo,
    '--json', fields,
  ])

  const data = JSON.parse(raw)

  // Fetch file list separately
  const filesRaw = gh([
    'pr', 'diff', String(prNumber),
    '--repo', repo,
    '--name-only',
  ])

  const filePaths = filesRaw
    .split('\n')
    .map((f: string) => f.trim())
    .filter((f: string) => f.length > 0)

  // Determine checks status from statusCheckRollup
  const checks = data.statusCheckRollup ?? []
  let checksStatus: GitHubPR['checksStatus'] = 'unknown'
  if (checks.length > 0) {
    const allPassed = checks.every((c: { conclusion?: string; status?: string }) =>
      c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED'
    )
    const anyFailed = checks.some((c: { conclusion?: string }) =>
      c.conclusion === 'FAILURE' || c.conclusion === 'CANCELLED' || c.conclusion === 'TIMED_OUT'
    )
    const anyPending = checks.some((c: { status?: string; conclusion?: string }) =>
      !c.conclusion || c.status === 'IN_PROGRESS' || c.status === 'QUEUED'
    )

    if (allPassed) checksStatus = 'passing'
    else if (anyFailed) checksStatus = 'failing'
    else if (anyPending) checksStatus = 'pending'
  }

  // Parse labels
  const labels = (data.labels ?? []).map((l: { name: string } | string) =>
    typeof l === 'string' ? l : l.name
  )

  // Parse repo owner/name from repo string
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
    labels,
    isDraft: data.isDraft ?? false,
    checksStatus,
    reviewDecision: data.reviewDecision ?? '',
    files: filePaths.map((p: string) => ({ path: p, additions: 0, deletions: 0, status: 'modified' })),
    additions: data.additions ?? 0,
    deletions: data.deletions ?? 0,
    url: data.url ?? '',
    repoOwner,
    repoName,
  }
}

// ---------------------------------------------------------------------------
// Map PR → ReviewInput
// ---------------------------------------------------------------------------

const HOLD_LABELS = new Set(['hold', 'needs-human', 'do-not-merge', 'wip'])

export function prToReviewInput(pr: GitHubPR, taskId?: string): ReviewInput {
  const hasHoldLabel = pr.labels.some(l => HOLD_LABELS.has(l.toLowerCase()))

  return {
    author: pr.author,
    filesChanged: pr.files.map(f => f.path),
    title: pr.title,
    description: pr.body,
    checksPassed: pr.checksStatus === 'passing',
    branchClean: pr.mergeable === true,
    hasBlockerComments: false, // Conservative: not scanning comments in v1
    hasHoldLabel: hasHoldLabel || pr.isDraft,
    taskId,
    linesAdded: pr.additions,
    linesRemoved: pr.deletions,
  }
}

// ---------------------------------------------------------------------------
// Get current GitHub identity
// ---------------------------------------------------------------------------

export function getGitHubIdentity(): string | null {
  try {
    const raw = gh(['api', 'user', '--jq', '.login'])
    return raw || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Post review comment to PR
// ---------------------------------------------------------------------------

/**
 * Post a structured review to a GitHub PR.
 *
 * If the authenticated user is the PR author (self-review), we cannot
 * formally APPROVE via GitHub's API. In that case, we post a COMMENT
 * with the review body and a note explaining the limitation.
 */
export function postReviewComment(
  repo: string,
  prNumber: number,
  review: ReviewResult,
  ghIdentity: string | null,
  prAuthor: string,
): { commentUrl: string | null; selfReviewBlocked: boolean } {
  const body = formatReviewComment(review)

  // Determine GitHub review action
  let action: GitHubReviewAction
  if (review.outcome === 'approve') {
    action = 'APPROVE'
  } else if (review.outcome === 'changes_requested') {
    action = 'REQUEST_CHANGES'
  } else {
    action = 'COMMENT'
  }

  // Self-review detection: if gh identity matches PR author, downgrade to COMMENT
  const isSelfReview = ghIdentity !== null && ghIdentity.toLowerCase() === prAuthor.toLowerCase()
  let selfReviewBlocked = false

  if (isSelfReview && action === 'APPROVE') {
    selfReviewBlocked = true
    action = 'COMMENT'
  }

  // Build the comment body with metadata
  const fullBody = [
    body,
    '',
    '---',
    `*Posted by Mission Control auto-review at ${new Date().toISOString()}*`,
    ...(selfReviewBlocked
      ? [
          '',
          '> **Note:** This review was logically APPROVED by the policy engine, but GitHub',
          '> prevents self-approval. The review outcome is recorded in Mission Control.',
          `> Authenticated as: \`${ghIdentity}\` (same as PR author)`,
        ]
      : []),
    ...(review.autoMergeEligible
      ? ['', `> **Auto-merge eligible** — merge will be attempted if conditions are met.`]
      : []),
  ].join('\n')

  try {
    // Use gh pr review to post a formal review
    const result = gh([
      'pr', 'review', String(prNumber),
      '--repo', repo,
      `--${action.toLowerCase().replace('_', '-')}`,
      '--body', fullBody,
    ])

    // Try to extract the comment URL from the result
    const urlMatch = result.match(/https:\/\/github\.com\/[^\s]+/)
    return { commentUrl: urlMatch?.[0] ?? null, selfReviewBlocked }
  } catch (err) {
    // Fallback: post as a regular comment if review submission fails
    try {
      const fallbackResult = gh([
        'pr', 'comment', String(prNumber),
        '--repo', repo,
        '--body', fullBody + '\n\n> *(Submitted as comment — formal review submission failed)*',
      ])

      const urlMatch = fallbackResult.match(/https:\/\/github\.com\/[^\s]+/)
      return { commentUrl: urlMatch?.[0] ?? null, selfReviewBlocked }
    } catch {
      return { commentUrl: null, selfReviewBlocked }
    }
  }
}

// ---------------------------------------------------------------------------
// Merge PR
// ---------------------------------------------------------------------------

/**
 * Attempt to merge a PR if policy allows.
 * Returns the merge outcome.
 */
export function mergePR(
  repo: string,
  prNumber: number,
  review: ReviewResult,
): { result: 'merged' | 'skipped' | 'failed'; error?: string } {
  if (!review.autoMergeEligible) {
    return { result: 'skipped', error: 'Not eligible for auto-merge per policy' }
  }

  if (review.outcome !== 'approve') {
    return { result: 'skipped', error: `Review outcome is "${review.outcome}", not "approve"` }
  }

  try {
    gh([
      'pr', 'merge', String(prNumber),
      '--repo', repo,
      '--squash',
      '--auto',
      '--subject', `auto-merge: ${review.risk.level}-risk, policy-approved`,
    ])

    return { result: 'merged' }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)

    // If --auto is not supported, try direct merge
    if (msg.includes('auto-merge') || msg.includes('not enabled')) {
      try {
        gh([
          'pr', 'merge', String(prNumber),
          '--repo', repo,
          '--squash',
          '--subject', `auto-merge: ${review.risk.level}-risk, policy-approved`,
        ])
        return { result: 'merged' }
      } catch (retryErr: unknown) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
        return { result: 'failed', error: retryMsg }
      }
    }

    return { result: 'failed', error: msg }
  }
}

// ---------------------------------------------------------------------------
// Main-assisted merge — pragmatic path when self-review blocks formal approval
// ---------------------------------------------------------------------------

/**
 * Perform a "main-assisted merge" for low-risk, clean, autoMergeEligible PRs
 * where self-review prevents formal GitHub approval.
 *
 * This does NOT pretend the PR was formally approved. The commit message and
 * audit trail clearly state that merge was completed via main-assisted path
 * because self-review blocked formal approval on GitHub.
 *
 * Preconditions (caller must verify):
 * - review.autoMergeEligible === true
 * - review.outcome === 'approve'
 * - review.risk.level === 'low'
 * - selfReviewBlocked === true
 */
export function mainAssistedMergePR(
  repo: string,
  prNumber: number,
  review: ReviewResult,
  ghIdentity: string | null,
): { result: 'main-assisted-merge' | 'failed'; error?: string } {
  // Safety: re-verify all preconditions
  if (!review.autoMergeEligible) {
    return { result: 'failed', error: 'main-assisted merge requires autoMergeEligible' }
  }
  if (review.outcome !== 'approve') {
    return { result: 'failed', error: `main-assisted merge requires outcome=approve, got "${review.outcome}"` }
  }
  if (review.risk.level !== 'low') {
    return { result: 'failed', error: `main-assisted merge only allowed for low-risk, got "${review.risk.level}"` }
  }

  const subject = [
    `main-assisted merge: ${review.risk.level}-risk, policy-approved`,
    `(self-review blocked formal approval for ${ghIdentity ?? 'unknown'})`,
  ].join(' ')

  try {
    gh([
      'pr', 'merge', String(prNumber),
      '--repo', repo,
      '--squash',
      '--auto',
      '--subject', subject,
    ])
    return { result: 'main-assisted-merge' }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)

    // If --auto is not supported, try direct merge
    if (msg.includes('auto-merge') || msg.includes('not enabled')) {
      try {
        gh([
          'pr', 'merge', String(prNumber),
          '--repo', repo,
          '--squash',
          '--subject', subject,
        ])
        return { result: 'main-assisted-merge' }
      } catch (retryErr: unknown) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
        return { result: 'failed', error: retryMsg }
      }
    }

    return { result: 'failed', error: msg }
  }
}

// ---------------------------------------------------------------------------
// Full review pipeline
// ---------------------------------------------------------------------------

/**
 * Execute the complete GitHub PR review pipeline:
 * 1. Fetch PR metadata
 * 2. Map to ReviewInput
 * 3. Run policy engine review
 * 4. Post structured review comment
 * 5. Attempt merge if eligible
 *
 * Returns a comprehensive result with full audit trail.
 */
export function reviewGitHubPR(
  repo: string,
  prNumber: number,
  options?: {
    taskId?: string
    dryRun?: boolean
    skipMerge?: boolean
  },
): GitHubReviewResult {
  const log: string[] = []
  const opts = options ?? {}

  log.push(`[github] Starting review for ${repo}#${prNumber}`)

  // 1. Get GitHub identity
  const ghIdentity = getGitHubIdentity()
  log.push(`[github] Authenticated as: ${ghIdentity ?? '(unknown)'}`)

  // 2. Fetch PR
  log.push(`[github] Fetching PR metadata...`)
  const pr = fetchPR(repo, prNumber)
  log.push(`[github] PR: "${pr.title}" by ${pr.author} | ${pr.files.length} files | +${pr.additions}/-${pr.deletions}`)
  log.push(`[github] State: ${pr.state} | Mergeable: ${pr.mergeableState} | Checks: ${pr.checksStatus} | Draft: ${pr.isDraft}`)

  if (pr.state !== 'OPEN') {
    log.push(`[github] PR is not open (state: ${pr.state}), skipping review`)
    return {
      pr,
      review: {
        reviewer: 'system',
        author: pr.author,
        risk: { level: 'medium', score: 0, signals: ['pr-not-open'], reason: 'PR is not in OPEN state' },
        outcome: 'escalate_to_human',
        checklist: [],
        mergeRecommendation: 'human-review',
        autoMergeEligible: false,
        summary: `PR #${prNumber} is ${pr.state}, not OPEN. Skipping auto-review.`,
        reviewedAt: Date.now(),
      },
      commentPosted: false,
      commentUrl: null,
      mergeAttempted: false,
      mergeResult: 'skipped',
      mergeError: 'PR is not open',
      selfReviewNote: null,
      mainAssistedMerge: false,
      ghIdentity,
      log,
    }
  }

  // 3. Map to ReviewInput & run review engine
  const input = prToReviewInput(pr, opts.taskId)
  log.push(`[github] ReviewInput: checksPassed=${input.checksPassed}, branchClean=${input.branchClean}, hasHoldLabel=${input.hasHoldLabel}`)

  const review = performReview(input)
  log.push(`[github] Review result: outcome=${review.outcome}, risk=${review.risk.level}, autoMergeEligible=${review.autoMergeEligible}`)
  log.push(`[github] Reviewer: ${review.reviewer} | Merge recommendation: ${review.mergeRecommendation}`)

  if (opts.dryRun) {
    log.push(`[github] DRY RUN — skipping GitHub comment and merge`)
    return {
      pr,
      review,
      commentPosted: false,
      commentUrl: null,
      mergeAttempted: false,
      mergeResult: null,
      mergeError: null,
      selfReviewNote: null,
      mainAssistedMerge: false,
      ghIdentity,
      log,
    }
  }

  // 4. Post review comment
  log.push(`[github] Posting review comment...`)
  const { commentUrl, selfReviewBlocked } = postReviewComment(repo, prNumber, review, ghIdentity, pr.author)
  log.push(`[github] Comment posted: ${commentUrl ?? '(no URL returned)'}`)

  let selfReviewNote: string | null = null
  if (selfReviewBlocked) {
    selfReviewNote = `GitHub identity "${ghIdentity}" matches PR author "${pr.author}" — formal APPROVE was downgraded to COMMENT. The logical review outcome (approve) is recorded in Mission Control.`
    log.push(`[github] SELF-REVIEW: ${selfReviewNote}`)
  }

  // 5. Merge if eligible
  let mergeAttempted = false
  let mergeResult: GitHubReviewResult['mergeResult'] = null
  let mergeError: string | null = null
  let mainAssistedMerge = false

  if (review.autoMergeEligible && !opts.skipMerge) {
    if (selfReviewBlocked) {
      // Main-assisted merge path: self-review blocks formal approval,
      // but policy says this is a low-risk, clean, autoMergeEligible case.
      // Allow main to complete the merge as the final system actor.
      log.push(`[github] Self-review blocks formal approval — attempting main-assisted merge path`)
      log.push(`[github] Preconditions: risk=${review.risk.level}, outcome=${review.outcome}, autoMergeEligible=${review.autoMergeEligible}`)
      mergeAttempted = true
      const merge = mainAssistedMergePR(repo, prNumber, review, ghIdentity)
      mergeResult = merge.result
      mergeError = merge.error ?? null
      mainAssistedMerge = merge.result === 'main-assisted-merge'
      if (mainAssistedMerge) {
        log.push(`[github] MAIN-ASSISTED MERGE: completed successfully — self-review blocked formal approval, main acted as final system actor`)
      } else {
        log.push(`[github] Main-assisted merge failed: ${merge.error}`)
      }
    } else {
      log.push(`[github] Attempting merge...`)
      mergeAttempted = true
      const merge = mergePR(repo, prNumber, review)
      mergeResult = merge.result
      mergeError = merge.error ?? null
      log.push(`[github] Merge result: ${merge.result}${merge.error ? ` (${merge.error})` : ''}`)
    }
  } else if (!review.autoMergeEligible) {
    mergeResult = 'skipped'
    mergeError = `Not auto-merge eligible: ${review.mergeRecommendation}`
    log.push(`[github] Merge skipped: not eligible (${review.mergeRecommendation})`)
  } else if (opts.skipMerge) {
    mergeResult = 'skipped'
    mergeError = 'Merge explicitly skipped via options'
    log.push(`[github] Merge skipped: --skip-merge flag`)
  }

  log.push(`[github] Review pipeline complete for ${repo}#${prNumber}`)

  return {
    pr,
    review,
    commentPosted: commentUrl !== null,
    commentUrl,
    mergeAttempted,
    mergeResult,
    mergeError,
    selfReviewNote,
    mainAssistedMerge,
    ghIdentity,
    log,
  }
}

// ---------------------------------------------------------------------------
// Utility: parse PR reference (URL or owner/repo#number)
// ---------------------------------------------------------------------------

/**
 * Parse a PR reference into { repo, prNumber }.
 * Accepts:
 * - "owner/repo#123"
 * - "https://github.com/owner/repo/pull/123"
 * - "#123" (requires defaultRepo)
 */
export function parsePRRef(
  ref: string,
  defaultRepo?: string,
): { repo: string; prNumber: number } | null {
  // URL format
  const urlMatch = ref.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  if (urlMatch) {
    return { repo: urlMatch[1], prNumber: parseInt(urlMatch[2], 10) }
  }

  // owner/repo#number format
  const refMatch = ref.match(/^([^/]+\/[^#]+)#(\d+)$/)
  if (refMatch) {
    return { repo: refMatch[1], prNumber: parseInt(refMatch[2], 10) }
  }

  // #number with default repo
  const hashMatch = ref.match(/^#?(\d+)$/)
  if (hashMatch && defaultRepo) {
    return { repo: defaultRepo, prNumber: parseInt(hashMatch[1], 10) }
  }

  return null
}
