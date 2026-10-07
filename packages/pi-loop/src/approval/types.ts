/**
 * Structural types for the tool approval flow. They intentionally mirror —
 * without importing — the pi extension API surfaces (`pi.getAllTools`,
 * `pi.on("tool_call")`, `ctx.ui.confirm` / `ctx.ui.select`) so the module
 * stays unit-testable with plain mocks and free of Bun-only imports.
 */

/** MCP-style tool annotations, as reported by `pi.getAllTools()`. */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** `tool_call` event fields the approval flow reads. */
export interface ToolCallEvent {
  toolName: string;
}

/** Returned by a `tool_call` handler to block execution with a reason. */
export interface ToolCallBlock {
  block: true;
  reason: string;
}

export type ToolCallVerdict = ToolCallBlock | undefined;

/** Dialog surface the approval flow needs from `ctx.ui`. Both methods are
 * optional: clients expose different subsets (select-only TUIs, confirm-only
 * RPC clients, none in JSON/print modes). */
export interface ApprovalUi {
  confirm?(title: string, message: string): Promise<boolean>;
  select?(title: string, options: readonly string[]): Promise<string | undefined>;
}

export interface ApprovalContext {
  ui?: ApprovalUi;
}

/** Minimal `pi` API surface the approval registration function uses. */
export interface ApprovalPiApi {
  getAllTools?(): Array<{ name: string; annotations?: ToolAnnotations }>;
  on(
    event: "tool_call" | "session_start",
    handler: (event: unknown, context: ApprovalContext) => Promise<ToolCallVerdict> | ToolCallVerdict,
  ): void;
}
