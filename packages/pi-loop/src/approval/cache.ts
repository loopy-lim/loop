/**
 * Session-scoped "Always (session)" approval cache, keyed by tool name.
 * Deliberately not persistent and not branch-aware: a session start (new
 * conversation, session switch, or reload) clears it via `reset()`.
 */
export class SessionApprovalCache {
  readonly #allowed = new Set<string>();

  allowAlways(toolName: string): void {
    this.#allowed.add(toolName);
  }

  isAlwaysAllowed(toolName: string): boolean {
    return this.#allowed.has(toolName);
  }

  reset(): void {
    this.#allowed.clear();
  }

  get size(): number {
    return this.#allowed.size;
  }
}
