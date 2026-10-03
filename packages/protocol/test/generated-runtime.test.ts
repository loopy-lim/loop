import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRun, getSnapshot, rustra, submitPlan } from "../src/generated/bun";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "loop-rustra-"));
const databasePath = join(temporaryDirectory, "loop.sqlite");

beforeAll(async () => {
  await rustra.ready();
});

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("generated Bun commands drive a complete persisted plan setup", async () => {
  const created = await createRun({ databasePath, runId: "generated-run" });
  expect(created.state).toBe("active");

  const submitted = await submitPlan({
    databasePath,
    runId: "generated-run",
    tasks: [
      {
        id: "research",
        title: "Inspect the repository",
        kind: "research",
        dependencies: [],
        readScope: ["**/*"],
        writeScope: [],
        requirements: [],
        completionChecks: [
          {
            id: "evidence-recorded",
            command: "true",
            args: [],
            workingDirectory: null,
            timeoutMs: 1_000,
          },
        ],
        preferredCompute: "fast",
        minimumCompute: "tiny",
        maximumCompute: "strong",
        maxAttempts: 2,
      },
    ],
  });
  expect(submitted.taskCount).toBe(1);

  const snapshot = await getSnapshot({ databasePath, runId: "generated-run" });
  expect(snapshot.tasks).toHaveLength(1);
  expect(snapshot.tasks[0]?.kind).toBe("research");
  expect(snapshot.activeWorkers).toEqual([]);
});

test("generated TypeScript preserves Rust enum domains", () => {
  const generated = readFileSync(resolve(import.meta.dir, "../src/generated/types.ts"), "utf8");
  expect(generated).toContain("export type TaskKind =");
  expect(generated).toContain("export type ComputeClass =");
  expect(generated).not.toContain("kind: string;");
  expect(generated).not.toContain("preferredCompute: string;");
});

test("generated TypeScript anchors the conversation frame family (decision 2026-xx-gui-conversation D2)", () => {
  const generated = readFileSync(resolve(import.meta.dir, "../src/generated/events.ts"), "utf8");

  // All nine v1 frame events are schema-anchored under their rustra event
  // names; SSE frame names are these minus the `loop.` prefix.
  const eventNames = [
    "loop.session_list",
    "loop.user_message",
    "loop.assistant_delta",
    "loop.assistant_message",
    "loop.tool_call_started",
    "loop.tool_call_ended",
    "loop.lifecycle",
    "loop.steer_queued",
    "loop.conversation_reset",
  ];
  for (const name of eventNames) {
    expect(generated).toContain(`'${name}':`);
  }

  // Frame vocabulary types are generated (no hand-written TS copies):
  // shared structs and all enums get named exports; direct event payload
  // structs are inlined into RustraEventPayloads (pane-family precedent).
  for (const type of [
    "RemoteSessionSummary",
    "RemoteSessionState",
    "RemoteSessionResetReason",
    "ConversationUserMessageSource",
    "ConversationLifecyclePhase",
  ]) {
    expect(generated).toContain(`export type ${type}`);
  }

  // Inventory and frame payload fields ride the generated camelCase contract.
  expect(generated).toContain("sessionId: string;");
  expect(generated).toContain("sessions: RemoteSessionSummary[];");
  expect(generated).toContain("messageId: string;");
  expect(generated).toContain("imageCount: number;");
  expect(generated).toContain("toolCallId: string;");
  expect(generated).toContain("argsTruncated: boolean;");
  expect(generated).toContain("resultTruncated: boolean;");
  expect(generated).toContain("isError: boolean;");
  expect(generated).toContain("steerId: string;");

  // Enum domains are fixed at v1 (decision D2/D3), not widened to string.
  expect(generated).toContain("'cursorUnavailable' | 'sessionGone' | 'slowConsumer'");
  expect(generated).toContain("'interactive' | 'steer' | 'api'");
  expect(generated).toContain("'sessionStarted' | 'turnStarted' | 'turnEnded' | 'sessionEnded'");
  expect(generated).toContain("'live' | 'ended' | 'unobserved'");
  expect(generated).not.toContain("source: string;");
  expect(generated).not.toContain("reason: string;");
  expect(generated).not.toContain("state: string;");
});
