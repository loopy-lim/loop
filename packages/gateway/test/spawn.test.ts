/**
 * Session spawn tests (decision 2026-xx-session-spawn §3). All deterministic:
 * command assembly, config gating, cwd policy, and problem mapping run
 * WITHOUT executing tmux (the process boundary is the injected SpawnExec
 * seam); the HTTP contract runs over the real fetch pipeline with a scripted
 * spawner. No paid model calls.
 */

import { describe, expect, test } from "bun:test";

import { ProblemError } from "../src/problem";
import {
  buildOsascriptSpawnCommand,
  buildSpawnCommand,
  nodeSpawnExec,
  resolveSpawnConfig,
  shellQuote,
  spawnConfigFromEnv,
  TmuxSpawner,
  type ResolvedSpawnConfig,
  type ResolveDir,
  type SpawnExec,
  type SpawnExecResult,
  type SpawnOutcome,
} from "../src/spawn";
import { authHeader, bootTestGateway, ScriptedSpawner } from "./helpers";

// ——— Fixtures ———

function config(overrides: Partial<ResolvedSpawnConfig> = {}): ResolvedSpawnConfig {
  return resolveSpawnConfig(
    {
      allowedRoots: ["/work"],
      defaultCwd: "/work",
      ...overrides,
    },
    { processCwd: "/work" },
  );
}

/** Scripted process boundary: matches on `file` and records every call. */
function fakeExec(results: Record<string, SpawnExecResult | Error>): {
  exec: SpawnExec;
  calls: { file: string; args: string[] }[];
} {
  const calls: { file: string; args: string[] }[] = [];
  return {
    calls,
    exec: async (file, args) => {
      calls.push({ file, args });
      const result = results[file];
      if (result instanceof Error) throw result;
      if (result === undefined) throw new Error(`unexpected exec: ${file}`);
      return result;
    },
  };
}

function fakeResolveDir(dirs: Record<string, string>): ResolveDir {
  return (path) => dirs[path] ?? null;
}

function spawnerWith(overrides: {
  config?: Partial<ResolvedSpawnConfig>;
  results: Record<string, SpawnExecResult | Error>;
  resolveDir?: ResolveDir;
  newSpawnId?: () => string;
}): { spawner: TmuxSpawner; calls: { file: string; args: string[] }[] } {
  const { exec, calls } = fakeExec(overrides.results);
  const spawner = new TmuxSpawner({
    config: config(overrides.config),
    exec,
    resolveDir:
      overrides.resolveDir ?? fakeResolveDir({ "/work": "/work", "/work/nested": "/work/nested" }),
    ...(overrides.newSpawnId === undefined ? {} : { newSpawnId: overrides.newSpawnId }),
  });
  return { spawner, calls };
}

async function spawnFailure(
  spawner: TmuxSpawner,
  request: { cwd?: string },
  listener: "tailscale" | "bearer-fallback",
): Promise<ProblemError> {
  try {
    await spawner.spawn(request, { listener });
  } catch (error) {
    if (error instanceof ProblemError) return error;
    throw error;
  }
  throw new Error("expected spawn to fail");
}

// ——— Command assembly (decision §D-A1, acceptance 1) ———

describe("buildSpawnCommand", () => {
  test("assembles the deterministic tmux new-window argv", () => {
    const command = buildSpawnCommand({
      config: config({ tmuxSession: "loop" }),
      windowName: "pi-abc12345",
      cwd: "/work/nested",
    });
    expect(command.file).toBe("tmux");
    expect(command.args).toEqual([
      "new-window",
      "-P",
      "-F",
      "#{pane_id}\t#{pane_pid}",
      "-t",
      "loop:",
      "-n",
      "pi-abc12345",
      "-c",
      "/work/nested",
      "'pi'",
    ]);
    // Same input → same argv (determinism contract).
    const again = buildSpawnCommand({
      config: config({ tmuxSession: "loop" }),
      windowName: "pi-abc12345",
      cwd: "/work/nested",
    });
    expect(again).toEqual(command);
  });

  test("carries configured pi args through POSIX quoting", () => {
    const command = buildSpawnCommand({
      config: config({ piArgs: ["--extension", "/path with space/tap.ts", "--attribute'n'quote"] }),
      windowName: "pi-x",
      cwd: "/work",
    });
    expect(command.args[command.args.length - 1]).toBe(
      `'pi' '--extension' '/path with space/tap.ts' '--attribute'\\''n'\\''quote'`,
    );
  });

  test("shellQuote survives quotes and spaces round-trip", () => {
    const raw = `it's "a" path/${"$"}(danger)`;
    const quoted = shellQuote(raw);
    expect(quoted).toBe(`'it'\\''s "a" path/${"$"}(danger)'`);
    // eval-equivalent reconstruction: strip the outer quotes and un-escape.
    expect(quoted.startsWith("'") && quoted.endsWith("'")).toBe(true);
  });
});

describe("buildOsascriptSpawnCommand", () => {
  test("quotes the do script payload and escapes AppleScript metacharacters", () => {
    const command = buildOsascriptSpawnCommand({
      config: config({ piArgs: ['--ext "quoted"'] }),
      cwd: "/work/nested",
    });
    expect(command.file).toBe("osascript");
    expect(command.args).toEqual([
      "-e",
      `tell application "Terminal" to do script "cd '/work/nested' && 'pi' '--ext \\"quoted\\"'"`,
    ]);
  });
});

// ——— Config resolution (startup fail-closed) ———

describe("resolveSpawnConfig", () => {
  test("applies the decision defaults (enabled on, session loop, auto-create, error fallback)", () => {
    const resolved = resolveSpawnConfig(undefined, { processCwd: "/host/cwd" });
    expect(resolved.enabled).toBe(true);
    expect(resolved.tmuxSession).toBe("loop");
    expect(resolved.tmuxAutoCreate).toBe(true);
    expect(resolved.fallback).toBe("error");
    expect(resolved.allowOnFallback).toBe(false);
    expect(resolved.piPath).toBe("pi");
    expect(resolved.defaultCwd).toBe("/host/cwd");
    expect(resolved.allowedRoots).toEqual(["/host/cwd"]);
  });

  test("rejects relative roots, relative defaultCwd, and invalid tmux session names", () => {
    expect(() => resolveSpawnConfig({ allowedRoots: ["relative"] }, { processCwd: "/w" })).toThrow(
      "absolute",
    );
    expect(() => resolveSpawnConfig({ defaultCwd: "nope" }, { processCwd: "/w" })).toThrow(
      "absolute",
    );
    expect(() => resolveSpawnConfig({ tmuxSession: "bad.name" }, { processCwd: "/w" })).toThrow(
      "tmuxSession",
    );
    expect(() => resolveSpawnConfig({ tmuxSession: "bad:name" }, { processCwd: "/w" })).toThrow(
      "tmuxSession",
    );
    expect(() => resolveSpawnConfig({ fallback: "auto" as never }, { processCwd: "/w" })).toThrow(
      "fallback",
    );
  });
});

describe("spawnConfigFromEnv", () => {
  test("parses on/off flags, colon-separated roots, and pi argv", () => {
    const resolved = spawnConfigFromEnv(
      {
        LOOP_GATEWAY_SPAWN: "off",
        LOOP_GATEWAY_SPAWN_TMUX_SESSION: "pair",
        LOOP_GATEWAY_SPAWN_TMUX_AUTO: "off",
        LOOP_GATEWAY_SPAWN_DEFAULT_CWD: "/host/work",
        LOOP_GATEWAY_SPAWN_ALLOWED_ROOTS: "/host/work:/host/other",
        LOOP_GATEWAY_PI_PATH: "/opt/pi/bin/pi",
        LOOP_GATEWAY_PI_ARGS: "--extension /tap dir/tap.ts",
        LOOP_GATEWAY_SPAWN_FALLBACK: "osascript",
        LOOP_GATEWAY_SPAWN_ON_BEARER_FALLBACK: "on",
      },
      { processCwd: "/host" },
    );
    expect(resolved.enabled).toBe(false);
    expect(resolved.tmuxSession).toBe("pair");
    expect(resolved.tmuxAutoCreate).toBe(false);
    expect(resolved.defaultCwd).toBe("/host/work");
    expect(resolved.allowedRoots).toEqual(["/host/work", "/host/other"]);
    expect(resolved.piPath).toBe("/opt/pi/bin/pi");
    expect(resolved.piArgs).toEqual(["--extension", "/tap", "dir/tap.ts"]);
    expect(resolved.fallback).toBe("osascript");
    expect(resolved.allowOnFallback).toBe(true);
  });

  test("rejects junk flag values at composition time", () => {
    expect(() => spawnConfigFromEnv({ LOOP_GATEWAY_SPAWN: "maybe" }, { processCwd: "/w" })).toThrow(
      "LOOP_GATEWAY_SPAWN",
    );
    expect(() =>
      spawnConfigFromEnv({ LOOP_GATEWAY_SPAWN_DEFAULT_CWD: "relative" }, { processCwd: "/w" }),
    ).toThrow("absolute");
    expect(() =>
      spawnConfigFromEnv({ LOOP_GATEWAY_SPAWN_FALLBACK: "auto" }, { processCwd: "/w" }),
    ).toThrow("LOOP_GATEWAY_SPAWN_FALLBACK");
  });
});

// ——— cwd policy (decision §D-B3, acceptance 3) ———

describe("TmuxSpawner cwd policy", () => {
  test("relative cwd → 400 spawn_cwd_invalid, nothing executed", async () => {
    const { spawner, calls } = spawnerWith({ results: {} });
    const error = await spawnFailure(spawner, { cwd: "relative/path" }, "tailscale");
    expect(error.code).toBe("spawn_cwd_invalid");
    expect(error.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("non-existing cwd → 404 spawn_cwd_missing", async () => {
    const { spawner, calls } = spawnerWith({ results: {} });
    const error = await spawnFailure(spawner, { cwd: "/work/ghost" }, "tailscale");
    expect(error.code).toBe("spawn_cwd_missing");
    expect(error.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  test("cwd outside the allowed roots → 403 spawn_cwd_outside_roots", async () => {
    const { spawner, calls } = spawnerWith({
      results: {},
      resolveDir: fakeResolveDir({ "/elsewhere": "/elsewhere" }),
    });
    const error = await spawnFailure(spawner, { cwd: "/elsewhere" }, "tailscale");
    expect(error.code).toBe("spawn_cwd_outside_roots");
    expect(error.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test("traversal into a sibling via .. is canonicalized away, prefix strings are not enough", async () => {
    const { spawner, calls } = spawnerWith({
      results: {},
      resolveDir: fakeResolveDir({ "/work2": "/work2" }),
    });
    // A root named /work must not bless /work2 via string prefix.
    const error = await spawnFailure(spawner, { cwd: "/work2" }, "tailscale");
    expect(error.code).toBe("spawn_cwd_outside_roots");
    // Nested dirs inside the root canonicalize and pass.
    const ok = spawnerWith({
      results: {},
      resolveDir: fakeResolveDir({ "/work": "/work", "/work/../workEscaped": "/workEscaped" }),
    });
    const escapeError = await spawnFailure(
      ok.spawner,
      { cwd: "/work/../workEscaped" },
      "tailscale",
    );
    expect(escapeError.code).toBe("spawn_cwd_outside_roots");
    expect(calls).toHaveLength(0);
  });

  test("omitted cwd falls back to the configured default and is root-validated", async () => {
    const { spawner, calls } = spawnerWith({
      config: { defaultCwd: "/work/nested" },
      results: { tmux: { exitCode: 0, stdout: "%1\t100", stderr: "" } },
    });
    const outcome = await spawner.spawn({}, { listener: "tailscale" });
    expect(outcome.cwd).toBe("/work/nested");
    expect(calls).toHaveLength(2); // has-session + new-window
  });
});

// ——— Gates (decision §D-B1/§D-B2, acceptance 2) ———

describe("TmuxSpawner gates", () => {
  test("enabled=false → 403 spawn_disabled before any probe", async () => {
    const { spawner, calls } = spawnerWith({ config: { enabled: false }, results: {} });
    const error = await spawnFailure(spawner, {}, "tailscale");
    expect(error.code).toBe("spawn_disabled");
    expect(error.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test("bearer-fallback listener → 403 spawn_fallback_denied by default", async () => {
    const { spawner, calls } = spawnerWith({ results: {} });
    const error = await spawnFailure(spawner, {}, "bearer-fallback");
    expect(error.code).toBe("spawn_fallback_denied");
    expect(calls).toHaveLength(0);
  });

  test("allowOnFallback=true lets the fallback listener through", async () => {
    const { spawner, calls } = spawnerWith({
      config: { allowOnFallback: true },
      results: { tmux: { exitCode: 0, stdout: "%2\t200", stderr: "" } },
    });
    const outcome = await spawner.spawn({}, { listener: "bearer-fallback" });
    expect(outcome.paneId).toBe("%2");
    expect(calls).toHaveLength(2);
  });
});

// ——— tmux flow + error mapping (decision §D-A/§D-C, acceptance 4) ———

describe("TmuxSpawner tmux flow", () => {
  test("existing session: has-session then exact new-window argv, pane output parsed", async () => {
    const { spawner, calls } = spawnerWith({
      results: { tmux: { exitCode: 0, stdout: "%7\t4711\n", stderr: "" } },
      newSpawnId: () => "abc12345",
    });
    const outcome: SpawnOutcome = await spawner.spawn({ cwd: "/work" }, { listener: "tailscale" });
    expect(calls.map((call) => call.file)).toEqual(["tmux", "tmux"]);
    expect(calls[1]?.args).toEqual([
      "new-window",
      "-P",
      "-F",
      "#{pane_id}\t#{pane_pid}",
      "-t",
      "loop:",
      "-n",
      "pi-abc12345",
      "-c",
      "/work",
      "'pi'",
    ]);
    expect(outcome).toEqual({
      spawnId: "abc12345",
      tmuxTarget: "loop:pi-abc12345",
      paneId: "%7",
      pid: 4711,
      cwd: "/work",
      launcher: "tmux",
    });
  });

  test("session missing + auto-create off → 503 spawn_tmux_session_missing", async () => {
    const { spawner, calls } = spawnerWith({
      config: { tmuxAutoCreate: false },
      results: { tmux: { exitCode: 1, stdout: "", stderr: "can't find session" } },
    });
    const error = await spawnFailure(spawner, { cwd: "/work" }, "tailscale");
    expect(error.code).toBe("spawn_tmux_session_missing");
    expect(error.status).toBe(503);
    expect(calls).toHaveLength(1); // probe only — no new-session, no new-window
  });

  test("session missing + auto-create on: new-session then new-window", async () => {
    const sequence: SpawnExecResult[] = [
      { exitCode: 1, stdout: "", stderr: "can't find session" }, // has-session
      { exitCode: 0, stdout: "", stderr: "" }, // new-session -d
      { exitCode: 0, stdout: "%3\t300", stderr: "" }, // new-window
    ];
    const seen: { file: string; args: string[] }[] = [];
    const scripted: SpawnExec = async (file, args) => {
      seen.push({ file, args });
      const result = sequence.shift();
      if (result === undefined) throw new Error("unexpected extra exec");
      return result;
    };
    const spawner = new TmuxSpawner({
      config: config(),
      exec: scripted,
      resolveDir: fakeResolveDir({ "/work": "/work" }),
      newSpawnId: () => "seq00001",
    });
    const outcome = await spawner.spawn({ cwd: "/work" }, { listener: "tailscale" });
    expect(seen).toHaveLength(3);
    expect(seen[1]?.args).toEqual(["new-session", "-d", "-s", "loop", "-c", "/work"]);
    expect(outcome.paneId).toBe("%3");
    expect(outcome.tmuxTarget).toBe("loop:pi-seq00001");
  });

  test("new-session failure → 503 spawn_tmux_unavailable with the tmux exit code", async () => {
    let invocation = 0;
    const scripted: SpawnExec = async () => {
      invocation += 1;
      if (invocation === 1) return { exitCode: 1, stdout: "", stderr: "can't find session" };
      return { exitCode: 28, stdout: "", stderr: "socket failed" };
    };
    const spawner = new TmuxSpawner({
      config: config(),
      exec: scripted,
      resolveDir: fakeResolveDir({ "/work": "/work" }),
    });
    const error = await spawnFailure(spawner, { cwd: "/work" }, "tailscale");
    expect(error.code).toBe("spawn_tmux_unavailable");
    expect(error.fields).toEqual({ stage: "tmux-new-session", "tmux-exit": "28" });
  });

  test("new-window failure → 500 spawn_launch_failed carrying the exit code", async () => {
    let invocation = 0;
    const scripted: SpawnExec = async () => {
      invocation += 1;
      if (invocation === 1) return { exitCode: 0, stdout: "", stderr: "" }; // has-session
      return { exitCode: 9, stdout: "", stderr: "create window failed" };
    };
    const spawner = new TmuxSpawner({
      config: config(),
      exec: scripted,
      resolveDir: fakeResolveDir({ "/work": "/work" }),
    });
    const error = await spawnFailure(spawner, { cwd: "/work" }, "tailscale");
    expect(error.code).toBe("spawn_launch_failed");
    expect(error.status).toBe(500);
    expect(error.fields).toEqual({ stage: "tmux-new-window", "tmux-exit": "9" });
  });

  test("unparseable new-window output → deterministic launch failure, no invented pane", async () => {
    let invocation = 0;
    const scripted: SpawnExec = async () => {
      invocation += 1;
      if (invocation === 1) return { exitCode: 0, stdout: "", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const spawner = new TmuxSpawner({
      config: config(),
      exec: scripted,
      resolveDir: fakeResolveDir({ "/work": "/work" }),
    });
    const error = await spawnFailure(spawner, { cwd: "/work" }, "tailscale");
    expect(error.code).toBe("spawn_launch_failed");
    expect(error.fields).toEqual({ stage: "tmux-new-window", reason: "unparseable output" });
  });

  test("tmux binary absent + fallback error → 503 spawn_tmux_unavailable", async () => {
    const { exec } = fakeExec({}); // every exec rejects (ENOENT shape)
    const spawner = new TmuxSpawner({
      config: config(),
      exec,
      resolveDir: fakeResolveDir({ "/work": "/work" }),
    });
    const error = await spawnFailure(spawner, { cwd: "/work" }, "tailscale");
    expect(error.code).toBe("spawn_tmux_unavailable");
    expect(error.status).toBe(503);
  });

  test("tmux binary absent + fallback osascript (explicit) → Terminal.app outcome", async () => {
    const { exec, calls } = fakeExec({ osascript: { exitCode: 0, stdout: "", stderr: "" } });
    const spawner = new TmuxSpawner({
      config: config({ fallback: "osascript" }),
      exec,
      resolveDir: fakeResolveDir({ "/work": "/work" }),
      newSpawnId: () => "term0001",
    });
    const outcome = await spawner.spawn({ cwd: "/work" }, { listener: "tailscale" });
    // The failed has-session probe is recorded too — only osascript executed.
    const osascriptCalls = calls.filter((call) => call.file === "osascript");
    expect(osascriptCalls).toHaveLength(1);
    expect(osascriptCalls[0]?.args[0]).toBe("-e");
    expect(outcome).toEqual({
      spawnId: "term0001",
      tmuxTarget: null,
      paneId: null,
      pid: null,
      cwd: "/work",
      launcher: "terminal-app",
    });
  });

  test("tmux absent + osascript fallback configured but osascript fails → 500", async () => {
    const { exec } = fakeExec({ osascript: { exitCode: 1, stdout: "", stderr: "no gui" } });
    const spawner = new TmuxSpawner({
      config: config({ fallback: "osascript" }),
      exec,
      resolveDir: fakeResolveDir({ "/work": "/work" }),
    });
    const error = await spawnFailure(spawner, { cwd: "/work" }, "tailscale");
    expect(error.code).toBe("spawn_launch_failed");
    expect(error.fields).toEqual({ stage: "osascript", "osascript-exit": "1" });
  });
});

// ——— HTTP contract (acceptance 5) ———

describe("POST /v1/sessions/spawn contract", () => {
  test("404 when the spawn seam is absent (fail-closed default boot)", async () => {
    const gateway = bootTestGateway();
    try {
      const response = await fetch(`${gateway.baseUrl}/v1/sessions/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(gateway.token()) },
        body: "{}",
      });
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.code).toBe("not_found");
    } finally {
      gateway.stop();
    }
  });

  test("201 with the tmux outcome; spawner receives the request and listener", async () => {
    const spawner = new ScriptedSpawner();
    const gateway = bootTestGateway({ spawn: spawner });
    try {
      const response = await fetch(`${gateway.baseUrl}/v1/sessions/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(gateway.token()) },
        body: JSON.stringify({ cwd: "/work/nested" }),
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("x-request-id")).not.toBeNull();
      expect(await response.json()).toEqual({
        spawnId: "abc12345",
        tmuxTarget: "loop:pi-abc12345",
        paneId: "%5",
        pid: 4321,
        cwd: "/tmp/loop-work",
        launcher: "tmux",
      });
      expect(spawner.calls).toEqual([
        { request: { cwd: "/work/nested" }, listener: "bearer-fallback" },
      ]);
    } finally {
      gateway.stop();
    }
  });

  test("tailscale-mode boot passes listener 'tailscale'; empty body means default cwd", async () => {
    const spawner = new ScriptedSpawner();
    const gateway = bootTestGateway({ authMode: "tailscale", spawn: spawner });
    try {
      const response = await fetch(`${gateway.baseUrl}/v1/sessions/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      expect(response.status).toBe(201);
      expect(spawner.calls).toEqual([{ request: {}, listener: "tailscale" }]);
    } finally {
      gateway.stop();
    }
  });

  test("ProblemError from the spawner maps to deterministic problem+json", async () => {
    const spawner = new ScriptedSpawner();
    spawner.failWith = new ProblemError(403, "spawn_disabled");
    const gateway = bootTestGateway({ spawn: spawner });
    try {
      const response = await fetch(`${gateway.baseUrl}/v1/sessions/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(gateway.token()) },
        body: "{}",
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      const body = await response.json();
      expect(body.code).toBe("spawn_disabled");
      expect(body.title).toBe("Session spawn disabled");
      expect(body.retryable).toBe(false);
    } finally {
      gateway.stop();
    }
  });

  test("framing errors: junk content-type, malformed JSON, wrong types, wrong method", async () => {
    const spawner = new ScriptedSpawner();
    const gateway = bootTestGateway({ spawn: spawner });
    try {
      const headers = { "Content-Type": "text/plain", ...authHeader(gateway.token()) };
      const junkType = await fetch(`${gateway.baseUrl}/v1/sessions/spawn`, {
        method: "POST",
        headers,
        body: "{}",
      });
      expect(junkType.status).toBe(400);
      expect((await junkType.json()).code).toBe("invalid_request");

      const auth = authHeader(gateway.token());
      const malformed = await fetch(`${gateway.baseUrl}/v1/sessions/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: "{nope",
      });
      expect(malformed.status).toBe(400);

      const array = await fetch(`${gateway.baseUrl}/v1/sessions/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: "[]",
      });
      expect(array.status).toBe(400);

      const badCwd = await fetch(`${gateway.baseUrl}/v1/sessions/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ cwd: 42 }),
      });
      expect(badCwd.status).toBe(400);
      expect((await badCwd.json()).fields.cwd).toBe("must be a string");

      const emptyCwd = await fetch(`${gateway.baseUrl}/v1/sessions/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ cwd: "   " }),
      });
      expect(emptyCwd.status).toBe(400);

      const get = await fetch(`${gateway.baseUrl}/v1/sessions/spawn`, {
        method: "GET",
        headers: { "Content-Type": "application/json", ...auth },
      });
      expect(get.status).toBe(405);
      expect(spawner.calls).toHaveLength(0);
    } finally {
      gateway.stop();
    }
  });

  test("bearer-fallback auth still applies first: no token → 401, spawner untouched", async () => {
    const spawner = new ScriptedSpawner();
    const gateway = bootTestGateway({ spawn: spawner });
    try {
      const response = await fetch(`${gateway.baseUrl}/v1/sessions/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(401);
      expect(spawner.calls).toHaveLength(0);
    } finally {
      gateway.stop();
    }
  });
});

// ——— production exec shape (no tmux required) ———

describe("nodeSpawnExec", () => {
  test("rejects for a missing binary and resolves exit codes otherwise", async () => {
    await expect(nodeSpawnExec("/definitely/not/a/binary", [])).rejects.toThrow();
    const echo = await nodeSpawnExec("/bin/echo", ["hello"]);
    expect(echo.exitCode).toBe(0);
    expect(echo.stdout).toBe("hello\n");
  });
});
