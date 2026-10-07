import { classifyApproval, describeApprovalTrigger } from "./classifier";
import { SessionApprovalCache } from "./cache";
import type {
  ApprovalContext,
  ApprovalPiApi,
  ApprovalUi,
  ToolAnnotations,
  ToolCallEvent,
} from "./types";

export const APPROVAL_OPTIONS = ["Allow once", "Always (session)", "Deny"] as const;

export interface ToolApprovalOptions {
  /** Dialog override (defaults to the handler context's `ctx.ui`). */
  ui?: ApprovalUi;
  /** Annotation lookup override (defaults to `pi.getAllTools()`). */
  annotations?(toolName: string): ToolAnnotations | undefined;
  /** Cache override — lets tests isolate the always-allow state. */
  cache?: SessionApprovalCache;
}

const blockReason = (toolName: string): string => `${toolName} was not approved`;

/**
 * Registers the Codex-style tool approval flow on a pi extension API:
 *
 * - `session_start` clears the session always-allow cache.
 * - `tool_call` consults the cache, then classifies the tool's annotations.
 *   Tools that need approval prompt with Allow once / Always (session) /
 *   Deny; Deny (or a missing/declining UI) blocks the call with
 *   `{ block: true, reason }`.
 *
 * Pure policy lives in `classifier.ts`; this function only wires it to the
 * pi event surface, so non-interactive modes degrade to blocking rather
 * than silently allowing.
 */
export function registerToolApproval(pi: ApprovalPiApi, options: ToolApprovalOptions = {}): void {
  const cache = options.cache ?? new SessionApprovalCache();
  const lookup = (toolName: string): ToolAnnotations | undefined => {
    if (options.annotations) return options.annotations(toolName);
    return pi.getAllTools?.().find((tool) => tool.name === toolName)?.annotations;
  };
  const resolveUi = (context?: ApprovalContext): ApprovalUi | undefined => options.ui ?? context?.ui;

  pi.on("session_start", () => {
    cache.reset();
  });

  pi.on("tool_call", async (event, context) => {
    const { toolName } = event as ToolCallEvent;
    if (cache.isAlwaysAllowed(toolName)) return undefined;

    const annotations = lookup(toolName);
    if (classifyApproval(annotations) === "allow") return undefined;

    const verdict = await promptForApproval(resolveUi(context), toolName, annotations);
    if (verdict === "always") {
      cache.allowAlways(toolName);
      return undefined;
    }
    if (verdict === "once") return undefined;
    return { block: true, reason: blockReason(toolName) };
  });
}

type PromptVerdict = "once" | "always" | "deny";

async function promptForApproval(
  ui: ApprovalUi | undefined,
  toolName: string,
  annotations: ToolAnnotations | undefined,
): Promise<PromptVerdict> {
  if (!ui || (!ui.select && !ui.confirm)) return "deny";
  const title = `Allow ${toolName}? (${describeApprovalTrigger(annotations)})`;
  if (ui.select) {
    const choice = await ui.select(title, APPROVAL_OPTIONS);
    if (choice === APPROVAL_OPTIONS[0]) return "once";
    if (choice === APPROVAL_OPTIONS[1]) return "always";
    return "deny";
  }
  // Confirm-only UIs (e.g. RPC clients without select): yes allows once.
  const confirmed = (await ui.confirm?.(title, toolName)) === true;
  return confirmed ? "once" : "deny";
}
