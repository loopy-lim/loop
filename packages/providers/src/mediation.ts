/**
 * Adapter tool mediation layer (gap analysis G5 — 도구별 allow/ask/deny,
 * 부분도입).
 *
 * Role separation (hard requirement): the loop-core attention gate is the
 * ONLY human-approval path for decisions, approvals, and conflicts. This
 * layer is the adapter-side deterministic gate for tool-level operations the
 * provider package itself executes (hook commands, adapter-owned tool
 * surfaces). It never blocks a run, never asks a human, and never overrides
 * completion checks: an `ask` verdict is resolved locally through
 * `askFallback` (fail-closed by default) because headless adapters cannot
 * pause a CLI mid-turn to prompt a person.
 *
 * First matching rule wins; unlisted requests follow `unlisted` (default
 * allow — adapters do not invent deny rules for tools they merely cannot
 * see).
 */
export type ToolMediationDecision = "allow" | "ask" | "deny";
export type ToolMediationEffect = "allow" | "deny";

export interface ToolRequest {
  /** Tool identifier (e.g. "hook", "shell", "git"). */
  tool: string;
  /** Shell command line the tool would execute, when applicable. */
  command?: string;
}

export interface ToolMediationRule {
  /** Stable rule label surfaced in verdict reasons for auditability. */
  label: string;
  /** Glob patterns matched against the tool name ("*" wildcard). */
  tools: string[];
  /** Regex source patterns; when set, the command (if any) must match one. */
  commands?: string[];
  decision: ToolMediationDecision;
  reason?: string;
}

export interface ToolMediationPolicy {
  rules: ToolMediationRule[];
  /** Decision for requests no rule matches. Default "allow". */
  unlisted?: ToolMediationDecision;
  /** Resolution for `ask` verdicts. Default "deny" (fail closed). */
  askFallback?: "allow" | "deny";
}

export interface ToolMediationVerdict {
  /** Effective effect after ask resolution; the only actionable field. */
  effect: ToolMediationEffect;
  /** Pre-fallback decision, kept as evidence. */
  decision: ToolMediationDecision;
  reason: string;
}

const UNLISTED: ToolMediationDecision = "allow";
const ASK_FALLBACK: "allow" | "deny" = "deny";

export function mediateToolCall(policy: ToolMediationPolicy, request: ToolRequest): ToolMediationVerdict {
  for (const rule of policy.rules) {
    if (!matchesTool(rule.tools, request.tool)) continue;
    if (rule.commands && !matchesCommand(rule.commands, request.command)) continue;
    const decision = rule.decision;
    const effect = resolveDecision(decision, policy);
    const detail = rule.reason ? ` (${rule.reason})` : "";
    return {
      effect,
      decision,
      reason: effect === decision
        ? `${rule.label}: ${decision}${detail}`
        : `${rule.label}: ${decision}${detail} -> ${effect} (headless adapter, askFallback=${policy.askFallback ?? ASK_FALLBACK})`,
    };
  }
  const unlisted = policy.unlisted ?? UNLISTED;
  return { effect: resolveDecision(unlisted, policy), decision: unlisted, reason: `unlisted: ${unlisted}` };
}

/**
 * Default adapter policy (G5): deterministic deny for destructive filesystem
 * operations, repository rewriting, privilege escalation, and remote code
 * execution patterns. Deliberately narrow — this is a safety net for
 * adapter-executed commands, not a general command linter.
 */
export function defaultToolMediationPolicy(): ToolMediationPolicy {
  return {
    rules: [
      {
        label: "destructive-filesystem",
        tools: ["*"],
        commands: [
          String.raw`rm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)*(/|~|\.\.)`,
          String.raw`:\(\)\s*\{.*\}\s*;\s*:`,
          String.raw`mkfs(\.\w+)?\s`,
          String.raw`dd\s+[^|]*of=/dev/(?:sd|nvme|disk)`,
        ],
        decision: "deny",
        reason: "recursive or device-level destruction",
      },
      {
        label: "history-rewrite",
        tools: ["git", "*"],
        commands: [
          String.raw`push\s+(?:--force(?:-with-lease)?|-[f])`,
          String.raw`reset\s+--hard`,
          String.raw`filter-(?:branch|repo)`,
        ],
        decision: "deny",
        reason: "rewrites shared or committed history",
      },
      {
        label: "privilege-escalation",
        tools: ["*"],
        commands: [String.raw`(?:^|\s)(?:sudo|doas)\s`],
        decision: "deny",
        reason: "elevates beyond the caller's authority",
      },
      {
        label: "remote-exec",
        tools: ["*"],
        commands: [String.raw`(?:curl|wget)\b[^|]*\|\s*(?:ba|z|)sh\b`],
        decision: "deny",
        reason: "executes code fetched at runtime",
      },
    ],
    unlisted: "allow",
    askFallback: "deny",
  };
}

function matchesTool(patterns: string[], tool: string): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(tool));
}

function matchesCommand(patterns: string[], command: string | undefined): boolean {
  if (command === undefined) return false;
  return patterns.some((pattern) => new RegExp(pattern).test(command));
}

function resolveDecision(decision: ToolMediationDecision, policy: ToolMediationPolicy): ToolMediationEffect {
  if (decision === "ask") return policy.askFallback ?? ASK_FALLBACK;
  return decision;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
