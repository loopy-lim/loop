import { expect, test } from "bun:test";
import { registerLoopExtension } from "../src/extension";
import { derivePersonaVocabulary } from "@loop/orchestrator/persona";
import type { SnapshotOutput } from "@loop/protocol";

const settings = { limits: { statusLineLimit: 8, attentionLineLimit: 6, findingsLineLimit: 5, listLineLimit: 8, lineTextLimit: 160 }, vocabulary: derivePersonaVocabulary({}) };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

for (const variant of ["dead owner after lease expiry", "resume failure after resolve", "status failure after resolve", "stale active worker"] as const) {
  test(`recovers ${variant} with bounded dispatch`, async () => {
    const tools = new Map<string, any>();
    const hooks = new Map<string, any>();
    let expires = variant === "dead owner after lease expiry" ? Date.now() + 70 : Date.now() - 100;
    let resumes = 0;
    let seq = 1;
    const snapshot = (): SnapshotOutput => ({
      runId: "recovery", workingDirectory: "/project", intent: "recover", state: "active",
      tasks: [], attention: [], openAttentionIds: [], guidance: [], goalCriteria: [],
      activeWorkers: variant === "stale active worker" ? [{ taskId: "stale" }] as SnapshotOutput["activeWorkers"] : [],
      executionOwner: "dead-owner", executionExpiresAt: expires, lastSequence: seq++,
    });
    const backend: any = {
      snapshot: async () => snapshot(), resolve: async () => {
        if (variant === "status failure after resolve") throw Error("post-commit status failed");
        return snapshot();
      },
      resume: async () => {
        resumes++;
        if (variant === "resume failure after resolve" && resumes === 1) throw Error("transient");
        expires = Date.now() + 60_000;
        return snapshot();
      },
    };
    registerLoopExtension({ registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand() {}, on: (name: string, handler: any) => hooks.set(name, handler) } as any, backend, undefined, settings);
    const ctx: any = { cwd: "/project", ui: { notify() {}, setStatus() {}, setWidget() {} }, sessionManager: { getBranch: () => [{ type: "custom", customType: "loop-run-binding", data: { runId: "recovery", workingDirectory: "/project" } }] } };
    if (variant === "resume failure after resolve") {
      // Resolve before attaching the observer so the first dispatch is the resolve path.
      await expect(tools.get("loop_resolve").execute("id", { runId: "recovery", attentionId: "a", resolution: "retry" }, new AbortController().signal, undefined, ctx)).rejects.toThrow("owner could not restart");
    }
    if (variant === "status failure after resolve") {
      const result = await tools.get("loop_resolve").execute("id", { runId: "recovery", attentionId: "a", resolution: "retry" }, new AbortController().signal, undefined, ctx);
      expect(result.content[0].text).toContain("Owner restart requested");
    }
    await hooks.get("session_start")({}, ctx);
    try {
      await wait(650);
      expect(resumes).toBe(variant === "resume failure after resolve" ? 2 : 1);
    } finally {
      hooks.get("session_shutdown")();
    }
  });
}
