/**
 * Real-run integration (decision 2026-xx-real-run-planner acceptance 1–3).
 *
 * Boots the real composition — generated protocol (Rust bridge) over a temp
 * SQLite store, the deterministic-local provider registry (FakeProvider,
 * free), and the orchestrator hand-off planner — behind the real HTTP/SSE
 * server on an ephemeral loopback port, then proves that a submitted prompt
 * starts a real durable Loop run with the standard graph template, that the
 * run list matches the store, and that worker output reaches the stream.
 *
 * No paid model call: the provider lane is deterministic-local by decision D2.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { Hs256BearerVerifier, signHs256Token } from "../src/auth";
import { RunEventLog } from "../src/events";
import { orchestratorPlanner } from "../src/planner";
import { deterministicLocalRegistry, protocolRuntimePort } from "../src/main";
import { GatewayService } from "../src/service";
import { startGateway } from "../src/server";
import { readSseUntil, submitPromptLike, type ParsedFrame } from "./helpers";

/** The repo itself: a real git worktree the read-only checks can assert. */
const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

type RealGateway = {
  baseUrl: string;
  token: string;
  databasePath: string;
  protocol: Awaited<ReturnType<typeof protocolRuntimePort>>["protocol"];
  stop: () => void;
};

async function bootRealGateway(): Promise<RealGateway> {
  const dir = mkdtempSync(join(tmpdir(), "loop-gw-real-"));
  const databasePath = join(dir, "loop.sqlite");
  const runtime = await protocolRuntimePort(databasePath, 25);
  const protocol = runtime.protocol;

  const { LoopRuntime } = await import("@loop/orchestrator");

  // Deterministic-local lane (decision D2): free workers only; the mirroring
  // layer records lifecycle/result lines into the store so the wire carries
  // real worker output. Shared with the production boot path so composition
  // cannot drift (execution-owner-aware store recording included).
  const providers = await deterministicLocalRegistry(protocol, databasePath);
  const loopRuntime = new LoopRuntime({
    control: protocol,
    databasePath,
    providers,
    maxWorkers: 2,
    workerVisibility: "watch",
  });
  const abort = new AbortController();

  const service = new GatewayService({
    runtime,
    planner: orchestratorPlanner({
      execution: loopRuntime,
      workingDirectory: REPO_ROOT,
      signal: abort.signal,
    }),
    log: new RunEventLog(1, 1024),
    planningLimit: 8,
  });

  const secret = `real-run-secret-${Math.random().toString(36).slice(2)}`;
  const authEnvNames = {
    secretEnv: "LOOP_REAL_RUN_SECRET",
    issuerEnv: "LOOP_REAL_RUN_ISSUER",
    audienceEnv: "LOOP_REAL_RUN_AUDIENCE",
  };
  const issuer = "loop-real-run";
  const audience = "loop-real-run";
  const server = startGateway(
    {
      host: "127.0.0.1",
      port: 0, // test-only OS-assigned port; parseGatewayConfig never emits this
      auth: authEnvNames,
      heartbeatMs: 15_000,
    },
    {
      service,
      verifier: new Hs256BearerVerifier(authEnvNames, () => Date.now()),
      inspector: { assertBindable: () => undefined },
    },
  );
  // The verifier reads material values from the environment at verification
  // time (process memory only) — assign there, as production does.
  process.env.LOOP_REAL_RUN_SECRET = secret;
  process.env.LOOP_REAL_RUN_ISSUER = issuer;
  process.env.LOOP_REAL_RUN_AUDIENCE = audience;

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    token: signHs256Token(
      { iss: issuer, aud: audience, exp: Math.floor(Date.now() / 1000) + 600 },
      secret,
    ),
    databasePath,
    protocol,
    stop: () => {
      abort.abort();
      server.stop();
      delete process.env.LOOP_REAL_RUN_SECRET;
      delete process.env.LOOP_REAL_RUN_ISSUER;
      delete process.env.LOOP_REAL_RUN_AUDIENCE;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function outputEvents(
  frames: ParsedFrame[],
): { taskId: string; activityId: string; text: string }[] {
  return frames
    .filter((frame) => frame.event === "output")
    .map((frame) => frame.data as { taskId: string; activityId: string; text: string });
}

describe("submitted prompt → real durable Loop run", () => {
  test("prepare commits the template graph, the run completes, and the store agrees", async () => {
    const gateway = await bootRealGateway();
    try {
      const response = await submitPromptLike(gateway, {
        prompt: "Document the real-run gateway lane and verify it",
      });
      expect(response.status).toBe(202);
      const accepted = (await response.json()) as { run: { runId: string } };
      const runId = accepted.run.runId;

      // Acceptance 1: the run is durable in the same store the CLI reads.
      const durable = await gateway.protocol.listRuns({ databasePath: gateway.databasePath });
      expect(durable.map((entry) => entry.runId)).toContain(runId);

      // Acceptance 1: the plan is the multi-task template graph, not a
      // single gateway-app stub. Store order is not insertion order, so
      // compare the id set and the template's dependency chain.
      const snapshot = await gateway.protocol.getSnapshot({
        databasePath: gateway.databasePath,
        runId,
      });
      expect(snapshot.tasks.map((task) => task.id).toSorted()).toEqual([
        "decision",
        "implementation",
        "research",
        "verification",
      ]);
      const dependenciesOf = (taskId: string) =>
        snapshot.tasks.find((task) => task.id === taskId)?.dependencies ?? [];
      expect(dependenciesOf("decision")).toEqual(["research"]);
      expect(dependenciesOf("implementation")).toEqual(["decision"]);
      expect(dependenciesOf("verification")).toEqual(["implementation"]);

      // Acceptance 3 + 1: stream to terminal; worker output is real content.
      const stream = await fetch(`${gateway.baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
        headers: { Accept: "text/event-stream", Authorization: `Bearer ${gateway.token}` },
      });
      expect(stream.status).toBe(200);
      const { frames } = await readSseUntil(
        stream,
        (parsed) => parsed.some((frame) => frame.event === "terminal"),
        30_000,
      );
      const statuses = frames.filter(
        (frame) => frame.event === "status" || frame.event === "terminal",
      );
      const terminal = statuses.at(-1)?.data as {
        run: { status: string; terminal: boolean; taskCounts: Record<string, number> };
      };
      expect(terminal.run.terminal).toBe(true);
      expect(terminal.run.status).toBe("completed");
      expect(terminal.run.taskCounts.done).toBe(4);

      const outputs = outputEvents(frames);
      const resultLine = outputs.find(
        (event) =>
          event.taskId === "implementation" && event.text.includes("implementation complete"),
      );
      expect(resultLine).toBeDefined();
      expect(resultLine?.activityId).toMatch(/^\d+:implementation:\d+$/);
      const lifecycleLine = outputs.find(
        (event) => event.taskId === "research" && event.text.startsWith("[lifecycle]"),
      );
      expect(lifecycleLine).toBeDefined();

      // Acceptance 1: the store agrees with the wire on the terminal state.
      const finalSnapshot = await gateway.protocol.getSnapshot({
        databasePath: gateway.databasePath,
        runId,
      });
      expect(finalSnapshot.state).toBe("completed");

      // Acceptance 2: the gateway run list equals the store's durable set.
      const pageResponse = await fetch(`${gateway.baseUrl}/v1/runs?limit=100`, {
        headers: { Authorization: `Bearer ${gateway.token}` },
      });
      expect(pageResponse.status).toBe(200);
      const page = (await pageResponse.json()) as { runs: { runId: string }[] };
      expect(page.runs.map((run) => run.runId).toSorted()).toEqual(
        durable.map((entry) => entry.runId).toSorted(),
      );
    } finally {
      gateway.stop();
    }
  }, 60_000);

  test("a store run created outside the gateway is listed and adoptable for SSE", async () => {
    const gateway = await bootRealGateway();
    try {
      // A run the CLI would have created directly in the store.
      await gateway.protocol.prepareRun({
        databasePath: gateway.databasePath,
        runId: "run_foreign",
        intent: "cli-created run",
        workingDirectory: REPO_ROOT,
        tasks: [
          {
            id: "solo",
            title: "solo task",
            kind: "implementation",
            dependencies: [],
            readScope: ["."],
            writeScope: ["."],
            requirements: ["stand still"],
            completionChecks: [
              {
                id: "ok",
                command: "git",
                args: ["rev-parse", "--is-inside-work-tree"],
                timeoutMs: 10_000,
              },
            ],
            preferredCompute: "fast",
            minimumCompute: "tiny",
            maximumCompute: "balanced",
            maxAttempts: 1,
          },
        ],
      });

      const pageResponse = await fetch(`${gateway.baseUrl}/v1/runs`, {
        headers: { Authorization: `Bearer ${gateway.token}` },
      });
      const page = (await pageResponse.json()) as { runs: { runId: string; status: string }[] };
      expect(page.runs.map((run) => run.runId)).toContain("run_foreign");

      // Single GET adopts the durable run and projects the store truth.
      const runResponse = await fetch(`${gateway.baseUrl}/v1/runs/run_foreign`, {
        headers: { Authorization: `Bearer ${gateway.token}` },
      });
      expect(runResponse.status).toBe(200);
      const run = (await runResponse.json()) as {
        runId: string;
        status: string;
        tasks: { taskId: string }[];
      };
      expect(run.runId).toBe("run_foreign");
      expect(run.tasks.map((task) => task.taskId)).toEqual(["solo"]);

      // SSE observation works for the adopted run too.
      const stream = await fetch(`${gateway.baseUrl}/v1/runs/run_foreign/events`, {
        headers: { Accept: "text/event-stream", Authorization: `Bearer ${gateway.token}` },
      });
      expect(stream.status).toBe(200);
      const { frames } = await readSseUntil(stream, (parsed) => parsed.length >= 1, 5_000);
      expect(frames[0]?.event).toBe("status");
    } finally {
      gateway.stop();
    }
  }, 30_000);
});
