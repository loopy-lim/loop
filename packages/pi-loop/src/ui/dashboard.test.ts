import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { emptyState } from "@loop/presentation";

import type { SnapshotOutput, TaskSnapshotOutput } from "@loop/protocol";

import { AttentionList } from "./components/attention-list";
import { ProgressLine } from "./components/progress-line";
import { TaskCard, taskStateGlyph } from "./components/task-card";
import type { LoopUiTheme } from "./components/ui-theme";
import {
  DashboardOverlay,
  dashboardLimits,
  dashboardRunView,
  openDashboard,
} from "./dashboard";

const theme: LoopUiTheme = {
  fg: (_token, text) => text,
  bg: (_token, text) => text,
  bold: (text) => text,
  italic: (text) => text,
  underline: (text) => text,
  strikethrough: (text) => text,
};

function task(overrides: Partial<TaskSnapshotOutput> & { id: string }): TaskSnapshotOutput {
  return {
    title: overrides.id,
    kind: "implementation",
    state: "pending",
    attempt: 0,
    preferredCompute: "fast",
    dependencies: [],
    readScope: [],
    writeScope: [],
    blockedBy: [],
    activities: [],
    ...overrides,
  };
}

export function snapshot(overrides: Partial<SnapshotOutput> = {}): SnapshotOutput {
  return {
    runId: "dash-1",
    state: "active",
    tasks: [
      task({ id: "t1", state: "done" }),
      task({ id: "t2", state: "running", title: "대시보드 오버레이" }),
      task({ id: "t3", state: "pending" }),
    ],
    activeWorkers: [{ id: "w1", taskId: "t2" }],
    openAttentionIds: ["a1"],
    attention: [{ id: "a1", kind: "question", summary: "토큰 예산 확인", taskId: "t2" }],
    intent: "대시보드 의도",
    workingDirectory: "/repo",
    guidance: [],
    goalCriteria: [],
    lastSequence: 7,
    ...overrides,
  };
}

function overlay(
  runs: SnapshotOutput[],
  overrides: { maxTasks?: number; maxStatusLines?: number } = {},
): { component: DashboardOverlay; closedCount: () => number } {
  let closed = 0;
  const component = new DashboardOverlay({
    runs: () => runs.map((run) => dashboardRunView(run)),
    theme,
    done: () => {
      closed += 1;
    },
    ...overrides,
  });
  return { component, closedCount: () => closed };
}

test("dashboard renders section header, run header, and close footer", () => {
  const { component } = overlay([snapshot()]);
  const lines = component.render(100);
  expect(lines[0]).toContain("Loop dashboard");
  expect(lines[0]).toContain("1 run(s)");
  const runHeader = lines.findIndex((line) => line.includes("dash-1 · active · 대시보드 의도"));
  expect(runHeader).toBeGreaterThan(0);
  expect(lines.at(-1)).toContain("Esc/q close");
});

test("dashboard shows the presentation empty state with no runs", () => {
  const { component } = overlay([]);
  const lines = component.render(80);
  expect(lines.some((line) => line.includes(emptyState.noRuns))).toBe(true);
  expect(lines.at(-1)).toContain("Esc/q close");
});

test("dashboard reuses the presentation snapshot status block as its data source", () => {
  const { component } = overlay([snapshot()], { maxStatusLines: 5 });
  const lines = component.render(120);
  // renderSnapshot("status") lines: Run / State / Working / Tasks counts.
  expect(lines.some((line) => line.includes("Run dash-1"))).toBe(true);
  expect(lines.some((line) => line.includes("State: active"))).toBe(true);
  expect(lines.some((line) => line.includes("Tasks: 1/3"))).toBe(true);
});

test("dashboard renders progress, attention, and task cards per run", () => {
  const { component } = overlay([snapshot()]);
  const lines = component.render(120);
  const text = lines.join("\n");
  // ProgressLine: done/total counts from the snapshot.
  expect(text).toContain("1/3");
  // AttentionList: open count header plus the item summary.
  expect(text).toContain("Attention · 1 open");
  expect(text).toContain("? 토큰 예산 확인 (t2)");
  // TaskCard: running task surfaces with its state glyph and meta line.
  expect(text).toContain(`${taskStateGlyph.running} 대시보드 오버레이`);
  expect(text).toContain("t2 · implementation · running · attempt 0");
});

test("dashboard shows the attention empty state when nothing is open", () => {
  const { component } = overlay([snapshot({ attention: [], openAttentionIds: [] })]);
  const lines = component.render(120);
  expect(lines.filter((line) => line.includes(` ${emptyState.attentionOk}`)).length).toBe(1);
});

test("dashboard caps task cards by maxTasks, trouble first", () => {
  const runs = [
    snapshot({
      tasks: [
        task({ id: "done-1", state: "done" }),
        task({ id: "run-1", state: "running" }),
        task({ id: "fail-1", state: "failed" }),
        task({ id: "pend-1", state: "pending" }),
      ],
    }),
  ];
  const { component } = overlay(runs, { maxTasks: 2 });
  const text = component.render(120).join("\n");
  expect(text).toContain("fail-1 · implementation · failed");
  expect(text).toContain("run-1 · implementation · running");
  expect(text).not.toContain("done-1 · implementation · done");
  expect(text).not.toContain("pend-1 · implementation · pending");
});

test("dashboard picks up run changes on the next render", () => {
  let runs: SnapshotOutput[] = [];
  const done: SnapshotOutput[] = [];
  const component = new DashboardOverlay({
    runs: () => runs.map((run) => dashboardRunView(run)),
    theme,
    done: () => done.push(),
  });
  expect(component.render(80).some((line) => line.includes(emptyState.noRuns))).toBe(true);
  runs = [snapshot()];
  expect(component.render(80).some((line) => line.includes("dash-1"))).toBe(true);
});

test("dashboard lines stay within the supplied width", () => {
  const { component } = overlay([snapshot({ intent: "아주 긴 의도 텍스트 — width handling check" })]);
  for (const width of [120, 80, 40, 20]) {
    for (const line of component.render(width)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  }
});

test("dashboard reuses cached lines until invalidate", () => {
  const runs = [snapshot()];
  const { component } = overlay(runs);
  const first = component.render(80);
  expect(component.render(80)).toBe(first); // unchanged runs → cached array reused
  component.invalidate();
  expect(component.render(80)).not.toBe(first); // invalidate → fresh render
});

test("dashboard closes on ESC and q through the done callback", () => {
  const escape = overlay([snapshot()]);
  escape.component.handleInput("\x1b");
  expect(escape.closedCount()).toBe(1);

  const q = overlay([snapshot()]);
  q.component.handleInput("q");
  expect(q.closedCount()).toBe(1);

  const other = overlay([snapshot()]);
  other.component.handleInput("j");
  expect(other.closedCount()).toBe(0);
});

test("openDashboard hosts the overlay via ctx.ui.custom with overlay options", async () => {
  let resolveOpen: ((result: undefined) => void) | undefined;
  let hostedOptions: { overlay?: boolean; overlayOptions?: Record<string, string> } | undefined;
  const custom = async <T>(
    factory: (
      tui: { requestRender(): void },
      theme: LoopUiTheme,
      keybindings: unknown,
      done: (result: T) => void,
    ) => unknown,
    options?: { overlay?: boolean; overlayOptions?: Record<string, string> },
  ): Promise<T> => {
    hostedOptions = options;
    let hostedDone: ((result: T) => void) | undefined;
    const component = factory(
      { requestRender: () => hostedDone?.(undefined as T) },
      theme,
      undefined,
      (result: T) => hostedDone?.(result),
    );
    expect(component).toBeInstanceOf(DashboardOverlay);
    return new Promise<T>((resolve) => {
      resolveOpen = resolve as (result: undefined) => void;
      hostedDone = (result) => {
        hostedDone = undefined;
        resolve(result);
      };
    });
  };
  const pending = openDashboard({ custom }, { runs: () => [] });
  await Promise.resolve();
  expect(hostedOptions?.overlay).toBe(true);
  expect(hostedOptions?.overlayOptions?.anchor).toBe("center");
  // The close path on the hosted component resolves the open promise.
  resolveOpen?.(undefined);
  await expect(pending).resolves.toBeUndefined();
});

test("dashboard module exports stay aligned with the component barrel", () => {
  // The overlay composes the shared components, not copies of them.
  expect(new AttentionList({ items: () => [], theme }).render(20)).toEqual([emptyState.attentionOk]);
  expect(new ProgressLine({ theme, data: () => ({ label: "x", done: 0, total: 0 }) }).render(20)).toHaveLength(1);
  expect(new TaskCard({ theme, data: () => ({ id: "t", title: "t", kind: "implementation", state: "pending", attempt: 0 }) }).render(20).length).toBeGreaterThan(0);
  expect(dashboardLimits.lineTextLimit).toBeGreaterThan(0);
});
