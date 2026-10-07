import { matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { emptyState, renderSnapshot, type OutputLimits } from "@loop/presentation";
import type { SnapshotOutput, TaskState } from "@loop/protocol";

import { AttentionList, type AttentionItem } from "./components/attention-list";
import { ProgressLine } from "./components/progress-line";
import { TaskCard, type TaskCardData } from "./components/task-card";
import type { LoopUiTheme } from "./components/ui-theme";

/**
 * The Loop dashboard overlay (`ctx.ui.custom()`), companion to the `/files`
 * viewer in ../files-viewer.ts.
 *
 * Layout decisions kept deliberately boring:
 * - The overlay is component-driven: each active run renders a header, one
 *   `ProgressLine`, a status block reused verbatim from the presentation
 *   snapshot renderer (`renderSnapshot("status")`), an `AttentionList`, and
 *   `TaskCard`s for the most relevant tasks. No new presentation vocabulary.
 * - The dashboard is a pure view: it polls nothing. The host passes a `runs`
 *   getter and calls `requestRender` (typically after refreshing snapshots);
 *   every render re-reads the getter, and the whole overlay is cached by a
 *   data signature until `invalidate()`.
 * - Keyboard: ESC or `q` closes via `done(undefined)`, matching the viewer's
 *   ESC path.
 */

/** Generous overlay budgets; the components truncate to the overlay width. */
export const dashboardLimits: OutputLimits = {
  statusLineLimit: 8,
  attentionLineLimit: 8,
  findingsLineLimit: 5,
  listLineLimit: 24,
  lineTextLimit: 160,
};

/** One run's dashboard view: the snapshot plus its presentation-rendered status block. */
export interface DashboardRunView {
  snapshot: SnapshotOutput;
  /** Lines from `renderSnapshot("status", ...)` — the reused data source. */
  statusLines: string[];
}

/** Builds one run's view, reusing the existing presentation snapshot output. */
export function dashboardRunView(
  snapshot: SnapshotOutput,
  limits: OutputLimits = dashboardLimits,
  nowMs: number = Date.now(),
): DashboardRunView {
  return {
    snapshot,
    statusLines: renderSnapshot("status", snapshot, limits, { nowMs }).split("\n"),
  };
}

/** Card priority: trouble first, finished last. Shared order for one run's cards. */
const cardStatePriority: Record<TaskState, number> = {
  attention: 0,
  failed: 1,
  running: 2,
  verifying: 3,
  ready: 4,
  pending: 5,
  blocked: 6,
  cancelled: 7,
  done: 8,
};

export interface DashboardOptions {
  /** Live getter re-read on every render (one view per active run). */
  runs: () => DashboardRunView[];
  theme: LoopUiTheme;
  done: (result: undefined) => void;
  /** Called after data changes so the TUI re-renders. */
  requestRender?: () => void;
  /** Task cards shown per run; defaults to 4. */
  maxTasks?: number;
  /** Reused presentation status lines shown per run; defaults to 4. */
  maxStatusLines?: number;
}

interface OverlayCache {
  width: number;
  signature: string;
  lines: string[];
}

export class DashboardOverlay implements Component {
  private readonly maxTasks: number;
  private readonly maxStatusLines: number;
  private cache: OverlayCache | undefined;

  constructor(private readonly options: DashboardOptions) {
    this.maxTasks = Math.max(0, options.maxTasks ?? 4);
    this.maxStatusLines = Math.max(0, options.maxStatusLines ?? 4);
  }

  /** Drops the cached render so the next `render(width)` rebuilds from `runs()`. */
  invalidate(): void {
    this.cache = undefined;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.options.done(undefined);
      return;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const runs = this.options.runs();
    const signature = JSON.stringify(runs);
    if (this.cache && this.cache.width === width && this.cache.signature === signature) {
      return this.cache.lines;
    }

    const { theme } = this.options;
    const lines: string[] = [
      theme.fg(
        "accent",
        theme.bold(truncateToWidth(` Loop dashboard · ${runs.length} run(s)`, safeWidth - 1)),
      ),
    ];
    if (runs.length === 0) {
      lines.push(theme.fg("dim", truncateToWidth(` ${emptyState.noRuns}`, safeWidth)));
    }
    for (const run of runs) {
      lines.push("", ...this.renderRun(run, safeWidth));
    }
    lines.push("", theme.fg("dim", truncateToWidth(` Esc/q close`, safeWidth - 1)));
    const out = lines.map((line) => truncateToWidth(line, safeWidth));
    this.cache = { width, signature, lines: out };
    return out;
  }

  private renderRun(run: DashboardRunView, width: number): string[] {
    const { snapshot } = run;
    const { theme } = this.options;
    const header = [snapshot.runId, snapshot.state, ...(snapshot.intent ? [snapshot.intent] : [])].join(" · ");
    const done = snapshot.tasks.filter((task) => task.state === "done").length;
    // Children render at width-2 so the one-space indent never truncates them.
    const bodyWidth = Math.max(12, width - 2);
    const attention = new AttentionList({
      theme,
      items: (): AttentionItem[] =>
        run.snapshot.attention.map(({ id, kind, summary, taskId }) => ({ id, kind, summary, taskId })),
    });
    return [
      theme.fg("accent", theme.bold(truncateToWidth(` ${header}`, width - 1))),
      ...new ProgressLine({
        theme,
        data: () => ({ label: "tasks", done, total: snapshot.tasks.length }),
      })
        .render(bodyWidth)
        .map((line) => ` ${line}`),
      ...run.statusLines
        .slice(0, this.maxStatusLines)
        .map((line) => theme.fg("dim", truncateToWidth(` ${line}`, width - 1))),
      ...attention.render(bodyWidth).map((line) => ` ${line}`),
      ...this.renderTaskCards(snapshot, bodyWidth),
    ];
  }

  private renderTaskCards(snapshot: SnapshotOutput, width: number): string[] {
    return [...snapshot.tasks]
      .sort((left, right) => cardStatePriority[left.state] - cardStatePriority[right.state])
      .slice(0, this.maxTasks)
      .flatMap((task) =>
        new TaskCard({
          theme: this.options.theme,
          data: (): TaskCardData => ({
            id: task.id,
            title: task.title,
            kind: task.kind,
            state: task.state,
            attempt: task.attempt,
          }),
        })
          .render(width)
          .map((line) => ` ${line}`),
      );
  }
}

/** Structural subset of `ctx.ui` needed to host the overlay (see extension.ts PiContext). */
export interface DashboardHost {
  custom<T>(
    factory: (
      tui: { requestRender(): void },
      theme: LoopUiTheme,
      keybindings: unknown,
      done: (result: T) => void,
    ) => unknown,
    options?: {
      overlay?: boolean;
      overlayOptions?: { anchor?: string; width?: string; maxHeight?: string };
    },
  ): Promise<T>;
}

export type DashboardOpenOptions = Pick<DashboardOptions, "runs" | "maxTasks" | "maxStatusLines">;

/**
 * Opens the dashboard as a centered overlay and resolves `undefined` when the
 * user closes it (ESC/q). Rejects if the host has no interactive TUI.
 */
export function openDashboard(host: DashboardHost, options: DashboardOpenOptions): Promise<undefined> {
  return host.custom<undefined>(
    (tui, theme, _keybindings, done) =>
      new DashboardOverlay({
        ...options,
        theme,
        done,
        requestRender: () => tui.requestRender(),
      }),
    { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "90%" } },
  );
}
