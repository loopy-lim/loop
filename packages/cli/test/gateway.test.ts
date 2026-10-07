/**
 * Gateway daemon supervision tests (decision: loop pair auto-spawn): the
 * spawn/reuse decision table, fail-closed Tailscale planning, pid record
 * hygiene, `gateway status`/`gateway stop` behavior, and the pair
 * auto-start hook. Real sockets and real child processes only — no paid
 * model calls, no network beyond loopback.
 */

import { expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  DEFAULT_DATABASE_FILE_NAME,
  decideGatewayAction,
  ensureGatewayRunning,
  formatGatewayStatusJson,
  formatGatewayStatusText,
  gatewayEntryCandidates,
  gatewayPidFilePath,
  gatewayStop,
  GATEWAY_PID_SUFFIX,
  isCgnatIpv4,
  isPortAccepting,
  parsePidFile,
  pickFreePort,
  planGatewaySpawn,
  readGatewayStatus,
  resolveBunCommand,
  resolveGatewayEntryPath,
  type EnsureGatewayOptions,
  type GatewayStatusInfo,
} from "../src/gateway";
import { GATEWAY_RUNTIME_FILE_ENV, runPairCommand } from "../src/pair";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

// ---------------------------------------------------------------------------
// Temp scaffolding: the LOOP_GATEWAY_RUNTIME_FILE override relocates the
// runtime record AND the pid record, so the suite never touches the real
// user config directory.
// ---------------------------------------------------------------------------

function tempGatewayRoot(): {
  root: string;
  recordPath: string;
  pidPath: string;
  env: Record<string, string>;
} {
  const root = mkdtempSync(join(tmpdir(), "loop-gateway-"));
  const recordPath = join(root, "gateway.json");
  return {
    root,
    recordPath,
    pidPath: `${recordPath}${GATEWAY_PID_SUFFIX}`,
    env: { [GATEWAY_RUNTIME_FILE_ENV]: recordPath },
  };
}

/** A real loopback listener standing in for the bound gateway. */
async function listenLoopback(): Promise<{ server: Server; port: number }> {
  const server = createServer();
  await new Promise<void>((fulfil) => {
    server.listen(0, "127.0.0.1", () => fulfil());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no tcp address");
  return { server, port: address.port };
}

function baseDeps(overrides: Partial<EnsureGatewayOptions> = {}): EnsureGatewayOptions {
  const { env } = tempGatewayRoot();
  return {
    env,
    probe: async () => ({ exitCode: 1, output: "" }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Decision table (pin the auto-spawn semantics).
// ---------------------------------------------------------------------------

test("decideGatewayAction: no record and no live pid spawns; a live pid reuses the booting daemon", () => {
  expect(decideGatewayAction({ record: null, alive: false, pid: null, pidAlive: false })).toEqual({
    action: "spawn",
    reason: "no runtime record",
    stalePid: null,
  });
  expect(decideGatewayAction({ record: null, alive: false, pid: 42, pidAlive: true })).toEqual({
    action: "reuse",
    reason: "daemon pid is alive; runtime record not written yet",
  });
  expect(decideGatewayAction({ record: null, alive: false, pid: 42, pidAlive: false })).toEqual({
    action: "spawn",
    reason: "no runtime record",
    stalePid: null,
  });
});

test("decideGatewayAction: alive reuses; stale record spawns with stale pid cleanup", () => {
  const record = { host: "100.80.133.120", port: 19001 };
  expect(decideGatewayAction({ record, alive: true, pid: null, pidAlive: false })).toEqual({
    action: "reuse",
    reason: "gateway port is accepting connections",
  });
  // Manually started gateway (no pid record) that stopped: spawn again.
  expect(decideGatewayAction({ record, alive: false, pid: null, pidAlive: false })).toEqual({
    action: "spawn",
    reason: "runtime record is stale: recorded port is not accepting connections",
    stalePid: null,
  });
  // Loop-spawned daemon died: spawn again and clean the stale pid.
  expect(decideGatewayAction({ record, alive: false, pid: 7, pidAlive: false })).toEqual({
    action: "spawn",
    reason: "runtime record is stale and the recorded pid is dead",
    stalePid: 7,
  });
  // Alive pid with a not-yet-accepting port: never double-start.
  expect(decideGatewayAction({ record, alive: false, pid: 7, pidAlive: true })).toEqual({
    action: "reuse",
    reason: "daemon pid is alive; port not accepting yet",
  });
});

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

test("isCgnatIpv4 accepts exactly 100.64.0.0/10 literals", () => {
  for (const good of ["100.64.0.1", "100.80.133.120", "100.127.255.254"]) {
    expect(isCgnatIpv4(good)).toBe(true);
  }
  for (const bad of [
    "100.63.0.1",
    "100.128.0.1",
    "127.0.0.1",
    "10.0.0.1",
    "loopy.ts.net",
    "100.64.0.999",
    "",
  ]) {
    expect(isCgnatIpv4(bad)).toBe(false);
  }
});

test("pid records: path follows the runtime record override, parse is strict", () => {
  expect(gatewayPidFilePath({ [GATEWAY_RUNTIME_FILE_ENV]: "/tmp/x/gateway.json" })).toBe(
    "/tmp/x/gateway.json.pid",
  );
  expect(parsePidFile(null)).toBeNull();
  expect(parsePidFile("")).toBeNull();
  expect(parsePidFile("42\n")).toBe(42);
  expect(parsePidFile("  7  ")).toBe(7);
  expect(parsePidFile("zero")).toBeNull();
  expect(parsePidFile("-3")).toBeNull();
  expect(parsePidFile("1.5")).toBeNull();
});

test("resolveBunCommand: a bun executable is reused, anything else falls back to PATH bun", () => {
  expect(resolveBunCommand("/Users/x/.bun/bin/bun")).toBe("/Users/x/.bun/bin/bun");
  expect(resolveBunCommand("/repo/dist/loop")).toBe("bun");
});

test("gateway entry candidates cover the compiled binary and dev source layouts", () => {
  const candidates = gatewayEntryCandidates("/repo/dist/loop", "/repo/packages/cli/src");
  // Both layouts resolve to the same repo-relative entrypoint.
  expect(candidates[0]).toBe("/repo/packages/gateway/src/main.ts");
  expect(candidates[1]).toBe("/repo/packages/gateway/src/main.ts");
  // With no executable-relative candidate, resolution falls back to this
  // repository's dev source layout and finds the real composition root.
  const fallback = resolveGatewayEntryPath("/definitely/not/a/binary");
  expect(existsSync(fallback)).toBe(true);
  expect(fallback.endsWith(join("packages", "gateway", "src", "main.ts"))).toBe(true);
});

// ---------------------------------------------------------------------------
// Liveness probes over real sockets.
// ---------------------------------------------------------------------------

test("pickFreePort returns a port that then accepts and refuses connections", async () => {
  const port = await pickFreePort();
  expect(port).toBeGreaterThan(0);
  expect(await isPortAccepting("127.0.0.1", port)).toBe(false);
  const server = createServer();
  try {
    await new Promise<void>((fulfil) => {
      server.listen(port, "127.0.0.1", () => fulfil());
    });
    expect(await isPortAccepting("127.0.0.1", port)).toBe(true);
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Spawn planning: fail-closed Tailscale, free port, default database path.
// ---------------------------------------------------------------------------

test("planGatewaySpawn resolves the Tailscale bind IP, a free port, and the default database path", async () => {
  const { env } = tempGatewayRoot();
  const deps: EnsureGatewayOptions = {
    env,
    executablePath: "/repo/dist/loop",
    probe: async () => ({
      exitCode: 0,
      output: JSON.stringify({ Self: { TailscaleIPs: ["fd7a:115c:a1e0::1", "100.80.133.120"] } }),
    }),
    pickFreePort: async () => 19077,
  };
  const plan = await planGatewaySpawn(deps);
  expect(plan.host).toBe("100.80.133.120"); // IPv4 CGNAT wins over v6
  expect(plan.port).toBe(19077);
  expect(plan.databasePath.endsWith(DEFAULT_DATABASE_FILE_NAME)).toBe(true);
  // The /repo/dist/loop candidate is absent on disk, so resolution falls
  // through to this repository's dev source layout.
  expect(plan.entryPath.endsWith(join("packages", "gateway", "src", "main.ts"))).toBe(true);
  expect(existsSync(plan.entryPath)).toBe(true);
  expect(plan.command).toBe("bun");
  expect(plan.cwd).toBe(resolve(plan.entryPath, "..", "..", ".."));
  expect(plan.env).toMatchObject({
    LOOP_GATEWAY_HOST: "100.80.133.120",
    LOOP_GATEWAY_PORT: "19077",
    LOOP_GATEWAY_DATABASE_PATH: plan.databasePath,
  });
  // A --database override flows through to the daemon env unchanged.
  const overridden = await planGatewaySpawn({ ...deps, databasePath: "/data/other.sqlite" });
  expect(overridden.databasePath).toBe("/data/other.sqlite");
  expect(overridden.env.LOOP_GATEWAY_DATABASE_PATH).toBe("/data/other.sqlite");
});

test("planGatewaySpawn fails closed when Tailscale reports no CGNAT address", async () => {
  const deps = baseDeps({
    probe: async () => ({ exitCode: 1, output: "" }),
    spawnProcess: () => {
      throw new Error("must not spawn");
    },
  });
  await expect(planGatewaySpawn(deps)).rejects.toMatchObject({ code: "tailscale-unavailable" });
  await expect(ensureGatewayRunning(deps)).rejects.toMatchObject({ code: "tailscale-unavailable" });
});

// ---------------------------------------------------------------------------
// ensureGatewayRunning: reuse, operator-managed, and full spawn integration.
// ---------------------------------------------------------------------------

test("ensureGatewayRunning reuses a live gateway and never spawns", async () => {
  const { server, port } = await listenLoopback();
  const root = mkdtempSync(join(tmpdir(), "loop-gateway-reuse-"));
  const recordPath = join(root, "gateway.json");
  try {
    writeFileSync(recordPath, JSON.stringify({ host: "100.80.133.120", port }), "utf8");
    let spawns = 0;
    const result = await ensureGatewayRunning({
      env: { [GATEWAY_RUNTIME_FILE_ENV]: recordPath },
      probe: async () => ({ exitCode: 1, output: "" }),
      spawnProcess: () => {
        spawns += 1;
        throw new Error("must not spawn");
      },
    });
    expect(spawns).toBe(0);
    expect(result.decision.action).toBe("reuse");
    expect(result.record).toEqual({ host: "100.80.133.120", port });
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureGatewayRunning leaves an operator-set LOOP_GATEWAY_PORT alone", async () => {
  let spawns = 0;
  const result = await ensureGatewayRunning(
    baseDeps({
      env: { LOOP_GATEWAY_PORT: "18477", [GATEWAY_RUNTIME_FILE_ENV]: "/nonexistent/gateway.json" },
      spawnProcess: () => {
        spawns += 1;
        throw new Error("must not spawn");
      },
    }),
  );
  expect(spawns).toBe(0);
  expect(result.decision.action).toBe("external");
  expect(result.record).toBeNull();
});

test("ensureGatewayRunning spawns the daemon, records the pid, and waits for the bind", async () => {
  const { root, recordPath, pidPath, env } = tempGatewayRoot();
  const openedServers: Server[] = [];
  try {
    let spawnedArgs: {
      command: string;
      args: string[];
      env: Record<string, unknown>;
      cwd: string;
    } | null = null;
    // Read through a closure: the callback assignment is invisible to
    // control-flow narrowing at the read site below.
    const spawnedRecord = (): typeof spawnedArgs => spawnedArgs;
    const deps: EnsureGatewayOptions = {
      env,
      executablePath: "/repo/dist/loop",
      probe: async () => ({
        exitCode: 0,
        output: JSON.stringify({ Self: { TailscaleIPs: ["100.80.133.120"] } }),
      }),
      pickFreePort: () => pickFreePort(),
      spawnProcess: (command, args, options) => {
        spawnedArgs = { command, args, env: options.env, cwd: options.cwd };
        // The daemon "binds the planned port" and writes its runtime record,
        // like the composition root does right after startGateway returns.
        const plannedPort = Number(options.env.LOOP_GATEWAY_PORT);
        const server = createServer();
        void new Promise<void>((resolveListen) => {
          server.listen(plannedPort, "127.0.0.1", () => resolveListen());
        }).then(() => {
          writeFileSync(
            recordPath,
            JSON.stringify({ host: "100.80.133.120", port: plannedPort }),
            "utf8",
          );
        });
        openedServers.push(server);
        return {
          pid: 4242,
          once: (event, listener) => {
            if (event === "spawn") setTimeout(() => listener(), 10);
          },
          unref: () => undefined,
        };
      },
    };
    const result = await ensureGatewayRunning(deps);
    const spawned = must(spawnedRecord());
    expect(spawned.command).toBe("bun");
    expect(spawned.args[0]?.endsWith(join("packages", "gateway", "src", "main.ts"))).toBe(
      true,
    );
    expect(spawned.cwd).toBe(resolve(must(spawned.args[0]), "..", "..", ".."));
    expect(spawned.env).toMatchObject({ LOOP_GATEWAY_HOST: "100.80.133.120" });
    expect(readFileSync(pidPath, "utf8")).toBe("4242\n");
    expect(result.decision.action).toBe("spawn");
    expect(result.record).not.toBeNull();
    expect(result.record?.port).toBe(Number(spawned.env.LOOP_GATEWAY_PORT));
  } finally {
    for (const server of openedServers) server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureGatewayRunning cleans a stale pid record before spawning a fresh daemon", async () => {
  const { root, recordPath, pidPath, env } = tempGatewayRoot();
  // Dead port: nothing listens on 1 (loopback probe fails fast).
  writeFileSync(recordPath, JSON.stringify({ host: "100.80.133.120", port: 1 }), "utf8");
  // Dead pid: an already-exited child.
  const dead = spawn(process.execPath, ["-e", "process.exit(0)"]);
  await new Promise((fulfil) => dead.once("exit", fulfil));
  writeFileSync(pidPath, `${dead.pid}\n`, "utf8");
  const openedServers: Server[] = [];
  try {
    const result = await ensureGatewayRunning({
      env,
      executablePath: "/repo/dist/loop",
      probe: async () => ({
        exitCode: 0,
        output: JSON.stringify({ Self: { TailscaleIPs: ["100.80.133.120"] } }),
      }),
      pickFreePort: () => pickFreePort(),
      spawnProcess: (_command, _args, options) => {
        const plannedPort = Number(options.env.LOOP_GATEWAY_PORT);
        const server = createServer();
        void new Promise<void>((resolveListen) => {
          server.listen(plannedPort, "127.0.0.1", () => resolveListen());
        }).then(() => {
          writeFileSync(
            recordPath,
            JSON.stringify({ host: "100.80.133.120", port: plannedPort }),
            "utf8",
          );
        });
        openedServers.push(server);
        return {
          pid: 5151,
          once: (event, listener) => {
            if (event === "spawn") setTimeout(() => listener(), 10);
          },
        };
      },
    });
    expect(result.decision.action).toBe("spawn");
    expect(existsSync(pidPath)).toBe(true);
    expect(readFileSync(pidPath, "utf8")).toBe("5151\n"); // rewritten, not stale
  } finally {
    for (const server of openedServers) server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureGatewayRunning fails closed when the daemon never binds", async () => {
  const { env } = tempGatewayRoot();
  await expect(
    ensureGatewayRunning({
      env,
      executablePath: "/repo/dist/loop",
      probe: async () => ({
        exitCode: 0,
        output: JSON.stringify({ Self: { TailscaleIPs: ["100.80.133.120"] } }),
      }),
      pickFreePort: async () => 19099,
      spawnProcess: () => ({
        pid: 6161,
        once: (event, listener) => {
          if (event === "spawn") setTimeout(() => listener(), 5);
        },
      }),
      bootTimeoutMs: 200,
      pollIntervalMs: 20,
    }),
  ).rejects.toMatchObject({ code: "gateway-boot-timeout" });
});

// ---------------------------------------------------------------------------
// `loop gateway status`.
// ---------------------------------------------------------------------------

test("gateway status: running, stopped, and stale pid shapes in text and JSON", async () => {
  const { server, port } = await listenLoopback();
  const root = mkdtempSync(join(tmpdir(), "loop-gateway-status-"));
  const recordPath = join(root, "gateway.json");
  try {
    const deps = baseDeps({ env: { [GATEWAY_RUNTIME_FILE_ENV]: recordPath } });
    const stopped: GatewayStatusInfo = await readGatewayStatus(deps);
    expect(stopped).toMatchObject({ running: false, record: null, pid: null });
    expect(formatGatewayStatusText(stopped)).toContain("gateway: not running");
    expect(JSON.parse(formatGatewayStatusJson(stopped))).toEqual({
      running: false,
      host: null,
      port: null,
      pid: null,
      pidAlive: false,
    });

    // A deterministically dead pid: an already-exited child.
    const dead = spawn(process.execPath, ["-e", "process.exit(0)"]);
    await new Promise((fulfil) => dead.once("exit", fulfil));
    const deadPid = dead.pid as number;
    writeFileSync(recordPath, JSON.stringify({ host: "100.80.133.120", port }), "utf8");
    writeFileSync(`${recordPath}${GATEWAY_PID_SUFFIX}`, `${deadPid}\n`, "utf8");
    const running: GatewayStatusInfo = await readGatewayStatus(deps);
    expect(running.running).toBe(true);
    expect(running.pid).toBe(deadPid);
    expect(running.pidAlive).toBe(false);
    const text = formatGatewayStatusText(running);
    expect(text).toContain("gateway: running");
    expect(text).toContain("host: 100.80.133.120");
    expect(text).toContain(`port: ${port}`);
    expect(text).toContain(`pid: ${deadPid} (stale)`);
    const parsedJson = JSON.parse(formatGatewayStatusJson(running));
    expect(parsedJson).toMatchObject({
      running: true,
      host: "100.80.133.120",
      port,
      pid: deadPid,
    });
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `loop gateway stop` over a real child process.
// ---------------------------------------------------------------------------

function spawnSleeper(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e6)"], {
    stdio: "ignore",
  });
  return child;
}

test("gateway stop terminates the recorded pid and removes the pid record", async () => {
  const { pidPath, env } = tempGatewayRoot();
  const child = spawnSleeper();
  try {
    await new Promise<void>((fulfil) => child.once("spawn", fulfil));
    writeFileSync(pidPath, `${child.pid}\n`, "utf8");
    const result = await gatewayStop(baseDeps({ env }));
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain(`pid ${child.pid}`);
    expect(result.message).toContain("stopped");
    expect(existsSync(pidPath)).toBe(false);
  } finally {
    child.kill("SIGKILL");
  }
});

test("gateway stop cleans a stale pid record without signaling anything", async () => {
  const { pidPath, env } = tempGatewayRoot();
  const dead = spawn(process.execPath, ["-e", "process.exit(0)"]);
  await new Promise((fulfil) => dead.once("exit", fulfil));
  writeFileSync(pidPath, `${dead.pid}\n`, "utf8");
  const result = await gatewayStop(baseDeps({ env }));
  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("stale pid record");
  expect(existsSync(pidPath)).toBe(false);
});

test("gateway stop refuses to guess for a manually started gateway, and is idempotent when stopped", async () => {
  const { server, port } = await listenLoopback();
  const root = mkdtempSync(join(tmpdir(), "loop-gateway-stop-"));
  const recordPath = join(root, "gateway.json");
  try {
    const deps = baseDeps({ env: { [GATEWAY_RUNTIME_FILE_ENV]: recordPath } });
    writeFileSync(recordPath, JSON.stringify({ host: "100.80.133.120", port }), "utf8");
    const manual = await gatewayStop(deps);
    expect(manual.exitCode).toBe(1);
    expect(manual.message).toContain("no pid record");

    server.close();
    const stopped = await gatewayStop(deps);
    expect(stopped.exitCode).toBe(0);
    expect(stopped.message).toContain("gateway is not running");
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `loop pair` auto-start hook wiring.
// ---------------------------------------------------------------------------

test("runPairCommand calls ensureGateway before resolving the pair", async () => {
  const { root, recordPath } = tempGatewayRoot();
  try {
    let calls = 0;
    const exit = await runPairCommand(
      {
        env: { [GATEWAY_RUNTIME_FILE_ENV]: recordPath, LOOP_GATEWAY_HOST: "100.80.133.120" },
        probe: async () => ({ exitCode: 1, output: "" }),
        ensureGateway: async () => {
          calls += 1;
          // The spawned daemon lands its runtime record before resolution.
          writeFileSync(
            recordPath,
            JSON.stringify({ host: "100.80.133.120", port: 19055 }),
            "utf8",
          );
        },
      },
      { stdout: () => undefined, stderr: () => undefined },
      {},
    );
    expect(calls).toBe(1);
    expect(exit).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runPairCommand propagates a fail-closed auto-start refusal", async () => {
  await expect(
    runPairCommand(
      {
        env: {},
        probe: async () => ({ exitCode: 1, output: "" }),
        ensureGateway: async () => {
          throw Object.assign(new Error("tailscale-unavailable: no CGNAT address"), {
            code: "tailscale-unavailable",
          });
        },
      },
      { stdout: () => undefined, stderr: () => undefined },
      {},
    ),
  ).rejects.toMatchObject({ code: "tailscale-unavailable" });
});
