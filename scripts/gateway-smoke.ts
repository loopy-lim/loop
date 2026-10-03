/**
 * Gateway smoke probe (task `app-device-install`).
 *
 * Boots the real gateway adapter bound to the machine's Tailscale IP and
 * probes the surface over that IP. Deterministic: no provider call, no model
 * call. Auth mode is the default tokenless tailscale mode (decision
 * 2026-xx-tokenless-auth-and-app-layout §D-A1): the listener trusts tailnet
 * membership, so requests carry no bearer and any Authorization header is
 * ignored — a signed token is still minted below to prove bearer headers
 * are harmlessly ignored rather than required. The probe also verifies the
 * loopback dual bind (decision §D-A4): the same port answers over 127.0.0.1,
 * which never leaves the machine.
 *
 * Env overrides:
 *   LOOP_GATEWAY_SMOKE_HOST  default 100.80.133.120 (this machine's Tailscale IP)
 *   LOOP_GATEWAY_SMOKE_PORT  default 18478 (deliberately ≠ the service port 18477)
 *
 * Run: bun run gateway:smoke   (final line is the verdict)
 */

import { mkdtempSync, rmSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootGatewayFromEnv } from "../packages/gateway/src/main";
import { signHs256Token } from "../packages/gateway/src/auth";

const HOST = process.env.LOOP_GATEWAY_SMOKE_HOST ?? "100.80.133.120";
const PORT = Number.parseInt(process.env.LOOP_GATEWAY_SMOKE_PORT ?? "18478", 10);
const BASE = `http://${HOST}:${PORT}`;
const ISSUER = "loop-smoke";
const AUDIENCE = "loop-smoke";

function fail(message: string): never {
  console.error(`gateway-smoke: FAIL — ${message}`);
  process.exit(1);
}

/** curl probe. The bearer never touches argv/logs: it is passed via a 0600 -K config file.
 * `base` overrides the default Tailscale BASE (used for the loopback probe). */
async function curl(method: string, path: string, token: string | null, body?: string, base: string = BASE): Promise<{ code: number; out: string }> {
  const configPath = join(tmpdir(), `loop-gw-smoke-${process.pid}.curl`);
  if (token !== null) {
    writeFileSync(configPath, `header = "Authorization: Bearer ${token}"\n`, { mode: 0o600 });
  }
  try {
    const args = ["curl", "-sS", "-X", method, `${base}${path}`, "-H", "Content-Type: application/json", "-w", "\n%{http_code}"];
    if (body !== undefined) args.push("-d", body);
    if (token !== null) args.push("-K", configPath);
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const sep = stdout.lastIndexOf("\n");
    return { code: Number.parseInt(stdout.slice(sep + 1).trim(), 10), out: stdout.slice(0, sep) };
  } finally {
    if (token !== null) unlinkSync(configPath);
  }
}

async function main(): Promise<void> {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fail(`bad port ${PORT}`);

  const dir = mkdtempSync(join(tmpdir(), "loop-gw-smoke-"));
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  // The verifier reads process.env at verification time — assign there (process
  // memory only; never persisted or printed).
  process.env.LOOP_GATEWAY_HOST = HOST;
  process.env.LOOP_GATEWAY_PORT = String(PORT);
  process.env.LOOP_GATEWAY_DATABASE_PATH = join(dir, "smoke.db");
  process.env.LOOP_GATEWAY_JWT_SECRET = secret;
  process.env.LOOP_GATEWAY_JWT_ISSUER = ISSUER;
  process.env.LOOP_GATEWAY_JWT_AUDIENCE = AUDIENCE;
  let server: Awaited<ReturnType<typeof bootGatewayFromEnv>> | null = null;
  try {
    server = await bootGatewayFromEnv(process.env);

    const token = signHs256Token({ iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 600 }, secret);

    // 1. tokenless tailscale mode: no bearer material is required, and a
    // signed bearer header is ignored rather than rejected (decision §D-A1).
    const anon = await curl("GET", "/v1/runs", null);
    if (anon.code !== 200) fail(`unauthenticated GET /v1/runs → ${anon.code}, expected 200 (tokenless tailscale mode)`);

    // 1b. loopback dual bind (decision §D-A4): the same port answers over
    // 127.0.0.1 without any bearer — loopback never leaves the machine.
    const loopback = await curl("GET", "/v1/runs", null, undefined, `http://127.0.0.1:${PORT}`);
    if (loopback.code !== 200) fail(`loopback GET /v1/runs → ${loopback.code}, expected 200 (dual bind §D-A4)`);

    // 2. submit endpoint over the Tailscale IP
    const submit = await curl("POST", "/v1/runs", token, JSON.stringify({ prompt: "gateway smoke probe", clientContext: { displayName: "smoke" } }));
    if (submit.code !== 202) fail(`POST /v1/runs → ${submit.code}, expected 202: ${submit.out.slice(0, 200)}`);
    const accepted = JSON.parse(submit.out) as { run: { runId: string; status: string } };
    const runId = accepted.run?.runId;
    if (typeof runId !== "string" || runId.length === 0) fail("submit response carried no runId");

    // 3. status endpoint over the Tailscale IP
    const status = await curl("GET", `/v1/runs/${runId}`, token);
    if (status.code !== 200) fail(`GET /v1/runs/${runId} → ${status.code}, expected 200`);
    const run = JSON.parse(status.out) as { runId: string };
    if (run.runId !== runId) fail("status response runId mismatch");

    // 4. list endpoint sees the run
    const list = await curl("GET", "/v1/runs", token);
    if (list.code !== 200 || !list.out.includes(runId)) fail("GET /v1/runs did not return the submitted run");

    // 5. SSE stream emits an initial status frame over the same IP
    const configPath = join(tmpdir(), `loop-gw-smoke-${process.pid}.curl`);
    writeFileSync(configPath, `header = "Authorization: Bearer ${token}"\n`, { mode: 0o600 });
    const sse = Bun.spawn(["curl", "-sS", "-N", "--max-time", "3", "-H", "Accept: text/event-stream", `${BASE}/v1/runs/${runId}/events`, "-K", configPath], { stdout: "pipe", stderr: "ignore" });
    const frames = await new Response(sse.stdout).text();
    unlinkSync(configPath);
    if (!frames.includes("event: status")) fail("SSE stream produced no status frame within 3s");

    console.log(`submit 202 runId=${runId}`);
    console.log(`status 200, list 200, sse status-frame ok over ${BASE}`);
    console.log(`gateway-smoke: PASS (bound to Tailscale IP ${HOST}, port ${PORT})`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    server?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
