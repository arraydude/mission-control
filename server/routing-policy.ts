/**
 * Mission Control — Auto-Routing Policy
 *
 * Deterministic heuristic router that assigns tasks to either `mida` or
 * `claude-code` based on title and description keywords.
 *
 * ── Routing rules ──────────────────────────────────────────────────────
 *
 * `mida` — simple, low-risk, tightly scoped work:
 *   • Typo fixes, copy edits, formatting, linting
 *   • Single-file config changes (env, yaml, json tweaks)
 *   • Documentation-only changes (README, comments, JSDoc)
 *   • Rename / move a single symbol or file
 *   • Style / CSS-only changes
 *   • Dependency version bumps (non-breaking)
 *
 * `claude-code` — multi-file, risky, ambiguous, or engineering-heavy:
 *   • Multi-file refactors or architecture changes
 *   • New features spanning multiple modules
 *   • Security fixes or audit tasks
 *   • Database schema migrations
 *   • Test infrastructure or CI/CD changes
 *   • Performance optimization
 *   • Bug investigation / debugging (ambiguous scope)
 *   • Anything not clearly simple
 *
 * The router never overrides an explicit `assignedAgent`.
 * ───────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoutingDecision = {
  agent: 'mida' | 'claude-code'
  reason: string
}

// ---------------------------------------------------------------------------
// Keyword lists (lowercase, matched against lowercased title + description)
// ---------------------------------------------------------------------------

/** Signals that push toward `mida` (simple work). */
const MIDA_SIGNALS: readonly { pattern: RegExp; weight: number; label: string }[] = [
  { pattern: /\btypo\b/,               weight: 3, label: 'typo fix' },
  { pattern: /\bcopy edit\b/,          weight: 3, label: 'copy edit' },
  { pattern: /\bformatting\b/,         weight: 2, label: 'formatting' },
  { pattern: /\blint(ing)?\b/,         weight: 2, label: 'linting' },
  { pattern: /\breadme\b/,             weight: 2, label: 'readme change' },
  { pattern: /\bdoc(s|umentation)?\b/, weight: 1, label: 'documentation' },
  { pattern: /\bcomment(s)?\b/,        weight: 1, label: 'comment update' },
  { pattern: /\bjsdoc\b/,              weight: 2, label: 'JSDoc update' },
  { pattern: /\brename\b/,             weight: 2, label: 'rename' },
  { pattern: /\bconfig\b/,             weight: 1, label: 'config change' },
  { pattern: /\benv\b/,                weight: 1, label: 'env update' },
  { pattern: /\bstyle(s)?\b/,          weight: 1, label: 'style change' },
  { pattern: /\bcss\b/,                weight: 2, label: 'CSS change' },
  { pattern: /\bbump\b/,               weight: 2, label: 'version bump' },
  { pattern: /\bupdate dep/,           weight: 1, label: 'dependency update' },
  { pattern: /\bminor\b/,              weight: 1, label: 'minor change' },
  { pattern: /\bchore\b/,              weight: 1, label: 'chore' },
  { pattern: /\bcleanup\b/,            weight: 1, label: 'cleanup' },
  { pattern: /\bwording\b/,            weight: 2, label: 'wording change' },
  { pattern: /\bspelling\b/,           weight: 3, label: 'spelling fix' },
  { pattern: /\bsingle.file\b/,        weight: 2, label: 'single-file scope' },
]

/** Signals that push toward `claude-code` (complex work). */
const CLAUDE_CODE_SIGNALS: readonly { pattern: RegExp; weight: number; label: string }[] = [
  { pattern: /\brefactor\b/,           weight: 3, label: 'refactor' },
  { pattern: /\barchitect/,            weight: 3, label: 'architecture' },
  { pattern: /\bmigrat/,               weight: 3, label: 'migration' },
  { pattern: /\bsecur/,                weight: 3, label: 'security' },
  { pattern: /\baudit\b/,              weight: 2, label: 'audit' },
  { pattern: /\bmulti.file\b/,         weight: 3, label: 'multi-file' },
  { pattern: /\bcross.cutting\b/,      weight: 3, label: 'cross-cutting' },
  { pattern: /\bperformance\b/,        weight: 2, label: 'performance' },
  { pattern: /\boptimiz/,              weight: 2, label: 'optimization' },
  { pattern: /\bdebug/,                weight: 2, label: 'debugging' },
  { pattern: /\binvestigat/,           weight: 2, label: 'investigation' },
  { pattern: /\bci\/?cd\b/,            weight: 2, label: 'CI/CD' },
  { pattern: /\bpipeline\b/,           weight: 2, label: 'pipeline' },
  { pattern: /\bschema\b/,             weight: 2, label: 'schema change' },
  { pattern: /\bdatabase\b/,           weight: 2, label: 'database work' },
  { pattern: /\btest infra/,           weight: 2, label: 'test infrastructure' },
  { pattern: /\bintegration\b/,        weight: 1, label: 'integration' },
  { pattern: /\bnew feature\b/,        weight: 2, label: 'new feature' },
  { pattern: /\bimplement\b/,          weight: 1, label: 'implementation' },
  { pattern: /\bdesign\b/,             weight: 1, label: 'design work' },
  { pattern: /\bapi\b/,                weight: 1, label: 'API work' },
  { pattern: /\bbug\b/,                weight: 1, label: 'bug fix' },
  { pattern: /\bbreaking\b/,           weight: 2, label: 'breaking change' },
  { pattern: /\bcomplex\b/,            weight: 2, label: 'complex scope' },
  { pattern: /\bambiguous\b/,          weight: 2, label: 'ambiguous scope' },
]

// ---------------------------------------------------------------------------
// Core routing function
// ---------------------------------------------------------------------------

/**
 * Deterministically route a task to `mida` or `claude-code` based on
 * heuristic keyword scoring of title + description.
 *
 * Returns the chosen agent and a human-readable reason.
 */
export function routeTask(title: string, description: string): RoutingDecision {
  const text = `${title} ${description}`.toLowerCase()

  let midaScore = 0
  let claudeScore = 0
  const midaReasons: string[] = []
  const claudeReasons: string[] = []

  for (const signal of MIDA_SIGNALS) {
    if (signal.pattern.test(text)) {
      midaScore += signal.weight
      midaReasons.push(signal.label)
    }
  }

  for (const signal of CLAUDE_CODE_SIGNALS) {
    if (signal.pattern.test(text)) {
      claudeScore += signal.weight
      claudeReasons.push(signal.label)
    }
  }

  // Default to claude-code for ambiguous/unknown tasks (safer choice)
  if (midaScore === 0 && claudeScore === 0) {
    return {
      agent: 'claude-code',
      reason: 'No clear signals detected; defaulting to claude-code (safer for ambiguous scope).',
    }
  }

  if (midaScore > claudeScore) {
    return {
      agent: 'mida',
      reason: `Routed to mida (score ${midaScore} vs ${claudeScore}): ${midaReasons.join(', ')}.`,
    }
  }

  return {
    agent: 'claude-code',
    reason: `Routed to claude-code (score ${claudeScore} vs ${midaScore}): ${claudeReasons.join(', ')}.`,
  }
}

// ---------------------------------------------------------------------------
// Auto-assign helper (used by API layer)
// ---------------------------------------------------------------------------

/**
 * If `assignedAgent` is not set, auto-route and return the patch to apply.
 * If already assigned, returns null (no override).
 */
export function autoAssignIfMissing(
  assignedAgent: string | null | undefined,
  title: string,
  description: string,
): { agent: string; routingReason: string } | null {
  if (assignedAgent && assignedAgent.trim()) return null

  const decision = routeTask(title, description)
  return { agent: decision.agent, routingReason: decision.reason }
}
