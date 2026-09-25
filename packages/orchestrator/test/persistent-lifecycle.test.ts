import { beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as protocol from "@loop/protocol";
import { AgyPersistentProvider, ProviderRegistry } from "@loop/providers";
import { Orchestrator } from "../src/coordinator";

beforeAll(() => protocol.rustra.ready());

test("a completed persistent worker exits before the graph returns its summary", async () => {
  const fixture = scenario("success");
  try {
    const result = await fixture.run();
    expect(result.status).toBe("completed");
    expect(fixture.pids()).toHaveLength(1);
    for (const pid of fixture.pids()) expect(alive(pid)).toBe(false);
    const snapshot = await protocol.getSnapshot(fixture.input);
    expect(snapshot.tasks[0]?.activities.at(-1)).toContain("Checking graph dependencies");
    expect(snapshot.activeWorkers).toEqual([]);
  } finally { fixture.cleanup(); }
});

test("persistent worker timeouts retry and promote exhausted timeout failures to attention", async () => {
  const fixture = scenario("timeout");
  try {
    const result = await fixture.run();
    expect(result.status).toBe("attention");
    expect(fixture.pids()).toHaveLength(2);
    for (const pid of fixture.pids()) expect(alive(pid)).toBe(false);
    const snapshot = await protocol.getSnapshot(fixture.input);
    expect(snapshot.state).toBe("attention");
    expect(snapshot.tasks[0]).toMatchObject({ state: "failed", attempt: 2 });
    expect(snapshot.activeWorkers).toEqual([]);
    expect(snapshot.attention).toHaveLength(1);
    expect(snapshot.attention[0]?.summary).toContain("retry budget exhausted");
  } finally { fixture.cleanup(); }
});

function scenario(outcome: "success" | "timeout") {
  const directory = mkdtempSync(join(tmpdir(), "loop-persistent-lifecycle-"));
  const command = join(directory, "fake-agy");
  writeFileSync(command, [
    "#!/usr/bin/env bun",
    "if (process.argv.includes('--version')) { console.log('fixture'); process.exit(0); }",
    "require('node:fs').appendFileSync('pids', process.pid + '\\n');",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', () => {",
    "  console.log(JSON.stringify({event:'step_update',step_update:{text_delta:'Checking graph dependencies'}}));",
    ...(outcome === "success" ? ["  console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'done'}}));"] : []),
    "});",
    "process.stdin.on('end', () => process.exit(0));",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  chmodSync(command, 0o755);
  const input = { databasePath: join(directory, "run.sqlite"), runId: `persistent-${outcome}` };
  const provider = new AgyPersistentProvider({ id: "agy-fixture", cwd: directory, command, computeClasses: ["fast"], turnTimeoutMs: 200 });
  const orchestrator = new Orchestrator({ control: protocol, providers: new ProviderRegistry([provider]), maxWorkers: 1 });
  const pids = () => existsSync(join(directory, "pids")) ? readFileSync(join(directory, "pids"), "utf8").trim().split("\n").map(Number) : [];
  return {
    input, pids,
    run: () => orchestrator.run({ ...input, workingDirectory: directory, tasks: [{
      id: "work", title: "Inspect graph", kind: "research", dependencies: [], readScope: [], writeScope: [], requirements: ["inspect"],
      completionChecks: [{ id: "check", command: process.execPath, args: ["-e", "process.exit(0)"], workingDirectory: null, timeoutMs: 2000 }],
      preferredCompute: "fast", minimumCompute: "fast", maximumCompute: "fast", maxAttempts: 2,
    }] }),
    cleanup() {
      for (const pid of pids()) { try { process.kill(pid, "SIGKILL"); } catch {} }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
