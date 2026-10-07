import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { separator } from "@loop/presentation";
import type { TaskKind, TaskState } from "@loop/protocol";

import type { LoopUiFgToken, LoopUiTheme } from "./ui-theme";

/**
 * Reusable pi-tui card for one Loop task (dashboard overlay building block).
 *
 * Render contract, shared with ../files-viewer.ts:
 * - `render(width)` returns lines that each fit within `width` (measured with
 *   `visibleWidth`, truncated with `truncateToWidth`).
 * - State changes take effect on the next render after `invalidate()`; the
 *   host calls the injected `tui.requestRender()` alongside it.
 * - Color flows exclusively through the semantic tokens of `LoopUiTheme`.
 */

/** State glyph, aligned with the `✓ ● ○ !` table in ../status.ts. */
export const taskStateGlyph: Record<TaskState, string> = {
  pending: "○",
  ready: "○",
  running: "●",
  verifying: "●",
  attention: "!",
  blocked: "○",
  done: "✓",
  failed: "!",
  cancelled: "○",
};

/** Semantic foreground token per task state. */
export const taskStateToken: Record<TaskState, LoopUiFgToken> = {
  pending: "muted",
  ready: "muted",
  running: "accent",
  verifying: "accent",
  attention: "warning",
  blocked: "dim",
  done: "success",
  failed: "error",
  cancelled: "dim",
};

export interface TaskCardData {
  id: string;
  title: string;
  kind: TaskKind;
  state: TaskState;
  attempt: number;
}

export interface TaskCardOptions {
  data: () => TaskCardData;
  theme: LoopUiTheme;
}

interface CardCache {
  width: number;
  signature: string;
  lines: string[];
}

export class TaskCard implements Component {
  private cache: CardCache | undefined;

  constructor(private readonly options: TaskCardOptions) {}

  /** Drops the cached render so the next `render(width)` rebuilds themed output. */
  invalidate(): void {
    this.cache = undefined;
  }

  render(width: number): string[] {
    const data = this.options.data();
    const signature = JSON.stringify(data);
    if (this.cache && this.cache.width === width && this.cache.signature === signature) {
      return this.cache.lines;
    }
    const safeWidth = Math.max(12, width);
    const { theme } = this.options;
    const glyph = taskStateGlyph[data.state];
    const title = truncateToWidth(data.title || data.id, safeWidth - 2);
    const header = `${theme.fg(taskStateToken[data.state], glyph)} ${theme.bold(title)}`;
    const meta = [data.id, data.kind, data.state, `attempt ${data.attempt}`].join(` ${separator.list} `);
    const lines = [header, theme.fg("dim", truncateToWidth(`  ${meta}`, safeWidth))];
    this.cache = { width, signature, lines };
    return lines;
  }
}

/** Visible width of a rendered card line, for hosts composing layouts. */
export function taskCardLineWidth(line: string): number {
  return visibleWidth(line);
}
