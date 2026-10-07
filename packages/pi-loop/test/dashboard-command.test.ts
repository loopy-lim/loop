import { expect, test } from "bun:test";

import type { SnapshotOutput, TaskSnapshotOutput } from "@loop/protocol";

import { DashboardOverlay } from "../src/ui/dashboard";
import { taskStateGlyph } from "../src/ui/components/task-card";
import { registerLoopExtension } from "../src/extension";
import type { LoopUiTheme } from "../src/ui/components/ui-theme";

// Identity theme: the command wiring test asserts on plain text, not color.
const theme: LoopUiTheme = {
  fg: (_token, text) => text,
  bg: (_token, text) => text,
  bold: (text) => text,
  italic: (text) => text,
  underline: (text) => text,
  strikethrough: (text) => text,
};

const limits = {
  statusLineLimit: 8,
  attentionLineLimit: 6,
  findingsLineLimit: 5,
  listLineLimit: 8,
  lineTextLimit: 160,
};

function task(id: string, state: TaskSnapshotOutput["state"]): TaskSnapshotOutput {
  return {
    id,
    title: `${id} 제목`,
    kind: "implementation",
    state,
    attempt: 0,
    preferredCompute: "fast",
    dependencies: [],
    readScope: [],
    writeScope: [],
    blockedBy: [],
    activities: [],
  };
}

function snapshot(runId: string, overrides: Partial<SnapshotOutput> = {}): SnapshotOutput {
  return {
    runId,
    state: "active",
    tasks: [task("t-done", "done"), task("t-run", "running")],
    activeWorkers: [{ id: "w1", taskId: "t-run" }],
    openAttentionIds: ["a1"],
    attention: [{ id: "a1", kind: "question", summary: "작업 방향 승인 필요", taskId: "t-run" }],
    intent: "왼쪽 패널 가시화 검증",
    workingDirectory: "/project",
    guidance: [],
    goalCriteria: [],
    lastSequence: 1,
    ...overrides,
  };
}

interface HostedOverlay {
  component: unknown;
  close: () => void;
}

/** Fakes pi just enough to capture commands and host one custom overlay. */
function setupExtension(backend: {
  runs: (cwd: string) => Promise<{ runId: string; state: string }[]>;
  snapshot: (runId: string, cwd: string) => Promise<SnapshotOutput>;
}) {
  const commands = new Map<string, { description: string; handler: (args: unknown, context: unknown) => Promise<unknown> }>();
  const notifications: { message: string; level?: string }[] = [];
  let customCalls = 0;
  let hosted: HostedOverlay | undefined;
  registerLoopExtension(
    {
      registerTool() {},
      registerCommand(name: string, def: { description: string; handler: (args: unknown, context: unknown) => Promise<unknown> }) {
        commands.set(name, def);
      },
      on() {},
      appendEntry() {},
      sendMessage: async () => {},
    } as never,
    backend as never,
    undefined,
    { limits },
    { active: false } as never,
  );
  const context = {
    cwd: "/project",
    mode: "tui" as const,
    ui: {
      notify: (message: string, level?: string) => notifications.push({ message, level }),
      custom: async <T,>(
        factory: (
          tui: { requestRender(): void },
          theme: LoopUiTheme,
          keybindings: unknown,
          done: (result: T) => void,
        ) => unknown,
      ): Promise<T> => {
        customCalls += 1;
        return new Promise<T>((resolve) => {
          const component = factory(
            { requestRender() {} },
            theme,
            undefined,
            (result: T) => resolve(result),
          );
          hosted = { component, close: () => resolve(undefined as T) };
        });
      },
    },
  };
  return {
    commands,
    notifications,
    context,
    hostedOverlay: () => hosted,
    customCallCount: () => customCalls,
  };
}

/** Lets the handler's async view load settle before assertions. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("loop-dashboard hosts the overlay with active-run views only", async () => {
  const harness = setupExtension({
    runs: async () => [
      { runId: "stale-run", state: "active" }, // snapshot fails → must not blank the dashboard
      { runId: "lead-run", state: "active" },
      { runId: "done-run", state: "completed" }, // inactive → filtered out
    ],
    snapshot: async (runId) => {
      if (runId === "stale-run") throw new Error("run vanished");
      return snapshot(runId);
    },
  });

  const handler = harness.commands.get("loop-dashboard")?.handler;
  expect(handler).toBeDefined();
  const opening = handler!([], harness.context);
  await settle();

  const hosted = harness.hostedOverlay();
  expect(hosted?.component).toBeInstanceOf(DashboardOverlay);
  // No failure or empty-run notify: the overlay itself is the visible state.
  expect(harness.notifications).toEqual([]);

  const lines = (hosted!.component as DashboardOverlay).render(120);
  const text = lines.join("\n");
  // One surviving run, header visible with state and intent.
  expect(text).toContain("1 run(s)");
  expect(text).toContain("lead-run · active · 왼쪽 패널 가시화 검증");
  // Running task surfaces through TaskCard; progress counts live tasks.
  expect(text).toContain(`${taskStateGlyph.running} t-run 제목`);
  expect(text).toContain("1/2");
  // Open attention item surfaces through AttentionList.
  expect(text).toContain("Attention · 1 open");
  expect(text).toContain("? 작업 방향 승인 필요 (t-run)");
  // Stale and inactive runs never reach the panel.
  expect(text).not.toContain("stale-run");
  expect(text).not.toContain("done-run");

  hosted!.close();
  await expect(opening).resolves.toBeUndefined();
});

test("loop-dashboard reports the empty state without hosting an overlay", async () => {
  const harness = setupExtension({
    runs: async () => [{ runId: "done-run", state: "completed" }],
    snapshot: async (runId) => snapshot(runId),
  });

  await harness.commands.get("loop-dashboard")!.handler!([], harness.context);

  expect(harness.customCallCount()).toBe(0);
  expect(harness.notifications).toEqual([{ message: "No active Loop runs.", level: "info" }]);
});

test("loop-dashboard warns outside the interactive TUI", async () => {
  const harness = setupExtension({
    runs: async () => [{ runId: "lead-run", state: "active" }],
    snapshot: async (runId) => snapshot(runId),
  });

  await harness.commands.get("loop-dashboard")!.handler!([], {
    ...harness.context,
    mode: "rpc",
    ui: { notify: harness.context.ui.notify },
  });

  expect(harness.customCallCount()).toBe(0);
  expect(harness.notifications).toHaveLength(1);
  expect(harness.notifications[0]!.level).toBe("warning");
  expect(harness.notifications[0]!.message).toContain("TUI");
});
