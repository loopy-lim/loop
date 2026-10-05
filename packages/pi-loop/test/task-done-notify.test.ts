import { expect, test } from "bun:test";
import { registerLoopExtension } from "../src/extension";
import { derivePersonaVocabulary } from "@loop/orchestrator/persona";
import type { SnapshotOutput } from "@loop/protocol";

test("observer announces each new done task once without playing the goal sound", async () => {
  const hooks = new Map<string, any>();
  const entries: string[] = [];
  const messages: string[] = [];
  const notifications: { title: string; sound: string }[] = [];
  let sequence = 0;
  let state: "active" | "completed" = "active";
  const backend: any = {
    snapshot: async (): Promise<SnapshotOutput> => ({
      runId: "tasks", workingDirectory: "/project", intent: "finish", state,
      lastSequence: ++sequence, activeWorkers: [], openAttentionIds: [], attention: [], guidance: [], goalCriteria: [],
      tasks: [{ id: "one", title: "First task", kind: "implementation", state: "done", preferredCompute: "fast", attempt: 1, dependencies: [], readScope: [], writeScope: [], blockedBy: [], activities: [] }],
    }),
    task: async () => ({ previousChecks: [] }),
  };
  const settings = { limits: { statusLineLimit: 8, attentionLineLimit: 6, findingsLineLimit: 5, listLineLimit: 8, lineTextLimit: 160 }, vocabulary: derivePersonaVocabulary({}) };
  registerLoopExtension({ registerTool() {}, registerCommand() {}, on: (name: string, handler: any) => hooks.set(name, handler), appendEntry: (name: string) => entries.push(name), sendMessage: async (message: any) => { messages.push(message.customType); } } as any, backend, undefined, settings, { active: true, notify: async (notification: any) => { notifications.push(notification); } } as any);
  const ctx: any = { cwd: "/project", ui: { notify() {}, setStatus() {}, setWidget() {} }, sessionManager: { getBranch: () => [{ type: "custom", customType: "loop-run-binding", data: { runId: "tasks", workingDirectory: "/project" } }] } };
  await hooks.get("session_start")({}, ctx);
  try {
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(entries.filter((entry) => entry === "loop-task-done")).toHaveLength(1);
    expect(messages.filter((message) => message === "loop-task-done")).toHaveLength(1);
    expect(notifications.filter((item) => item.title.startsWith("Loop task done"))).toHaveLength(1);
    expect(notifications[0]?.sound).toBe("none");
    state = "completed";
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(notifications.some((item) => item.title === "Loop run completed" && item.sound === "done")).toBe(true);
  } finally {
    hooks.get("session_shutdown")();
  }
});
