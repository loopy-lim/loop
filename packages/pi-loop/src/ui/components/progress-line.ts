import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

import type { LoopUiTheme } from "./ui-theme";

/**
 * Reusable pi-tui single-line progress bar (dashboard overlay building
 * block). Render contract matches ../files-viewer.ts: the line fits within
 * the supplied width (measured with `visibleWidth`), `invalidate()` drops
 * cached output, and color comes from `LoopUiTheme` semantic tokens.
 */

export interface ProgressData {
  /** Short label rendered before the bar, e.g. `tui-components`. */
  label: string;
  /** Number of completed units. */
  done: number;
  /** Total number of units; 0 renders an empty bar. */
  total: number;
}

export interface ProgressLineOptions {
  data: () => ProgressData;
  theme: LoopUiTheme;
  /** Maximum bar cells; the bar shrinks to fit narrow widths. Defaults to 24. */
  maxCells?: number;
}

const MIN_BAR_CELLS = 3;
const FILLED_CELL = "▰";
const EMPTY_CELL = "▱";

interface LineCache {
  width: number;
  signature: string;
  lines: string[];
}

export class ProgressLine implements Component {
  private readonly maxCells: number;
  private cache: LineCache | undefined;

  constructor(private readonly options: ProgressLineOptions) {
    this.maxCells = Math.max(MIN_BAR_CELLS, options.maxCells ?? 24);
  }

  /** Drops the cached render so the next `render(width)` rebuilds themed output. */
  invalidate(): void {
    this.cache = undefined;
  }

  render(width: number): string[] {
    const data = this.options.data();
    const signature = JSON.stringify(data);
    if (this.cache && this.cache.width === width && this.cache.signature === signature) {
      return [this.cache.lines[0] ?? ""];
    }
    const safeWidth = Math.max(8, width);
    const { theme } = this.options;
    const counts = `${data.done}/${data.total}`;
    const budget = Math.min(
      this.maxCells,
      Math.max(MIN_BAR_CELLS, safeWidth - visibleWidth(`${data.label} ${counts}`) - 2),
    );
    // One cell per unit when the total fits the width budget, otherwise a
    // proportional bar clamped to the budget (zero total → a short empty bar).
    const cells = data.total > 0 ? Math.min(data.total, budget) : Math.min(12, budget);
    const done = Math.min(Math.max(0, data.done), Math.max(0, data.total));
    const filled = data.total > 0 ? Math.round((done / data.total) * cells) : 0;
    const filledToken = data.total > 0 && done >= data.total ? "success" : "accent";
    const bar =
      theme.fg(filledToken, FILLED_CELL.repeat(filled)) +
      theme.fg("dim", EMPTY_CELL.repeat(cells - filled));
    const text = `${data.label} ${bar} ${counts}`;
    const line = truncateToWidth(text, safeWidth);
    this.cache = { width, signature, lines: [line] };
    return [line];
  }
}
