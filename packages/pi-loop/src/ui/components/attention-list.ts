import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { emptyState, moreItems, separator } from "@loop/presentation";
import type { AttentionKind } from "@loop/protocol";

import type { LoopUiFgToken, LoopUiTheme } from "./ui-theme";

/**
 * Reusable pi-tui list of open attention items (dashboard overlay building
 * block). Render contract matches ../files-viewer.ts: lines fit within the
 * supplied width, `invalidate()` drops cached output, and all color comes
 * from `LoopUiTheme` semantic tokens.
 */

/** Semantic foreground token per attention kind. */
export const attentionKindToken: Record<AttentionKind, LoopUiFgToken> = {
  question: "accent",
  decision: "accent",
  approval: "accent",
  conflict: "warning",
  failure: "error",
};

/** Glyph per attention kind — `!` for hard conflicts/failures, `?` to answer. */
export const attentionKindGlyph: Record<AttentionKind, string> = {
  question: "?",
  decision: "?",
  approval: "?",
  conflict: "!",
  failure: "!",
};

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  summary: string;
  taskId?: string | null;
}

export interface AttentionListOptions {
  items: () => AttentionItem[];
  theme: LoopUiTheme;
  /** Maximum item lines before an overflow summary; defaults to 6. */
  maxItems?: number;
}

interface ListCache {
  width: number;
  signature: string;
  lines: string[];
}

export class AttentionList implements Component {
  private readonly maxItems: number;
  private cache: ListCache | undefined;

  constructor(private readonly options: AttentionListOptions) {
    this.maxItems = Math.max(1, options.maxItems ?? 6);
  }

  /** Drops the cached render so the next `render(width)` rebuilds themed output. */
  invalidate(): void {
    this.cache = undefined;
  }

  render(width: number): string[] {
    const items = this.options.items();
    const signature = JSON.stringify(items);
    if (this.cache && this.cache.width === width && this.cache.signature === signature) {
      return this.cache.lines;
    }
    const safeWidth = Math.max(12, width);
    const { theme } = this.options;
    const lines: string[] = [];
    if (items.length === 0) {
      lines.push(theme.fg("dim", truncateToWidth(emptyState.attentionOk, safeWidth)));
    } else {
      const header = `Attention ${separator.list} ${items.length} open`;
      lines.push(theme.fg("accent", theme.bold(truncateToWidth(header, safeWidth))));
      const visible = items.slice(0, this.maxItems);
      for (const item of visible) {
        const detail = item.taskId ? ` (${item.taskId})` : "";
        const text = truncateToWidth(`${attentionKindGlyph[item.kind]} ${item.summary}${detail}`, safeWidth);
        lines.push(theme.fg(attentionKindToken[item.kind], text));
      }
      const omitted = items.length - visible.length;
      if (omitted > 0) {
        lines.push(theme.fg("dim", truncateToWidth(moreItems(omitted, "attention items"), safeWidth)));
      }
    }
    this.cache = { width, signature, lines };
    return lines;
  }
}
