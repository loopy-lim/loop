/**
 * Well-known gateway runtime record (loop pair port fallback). Contract
 * covered here:
 *
 *   - the record carries exactly { host, port } — no secret field can appear
 *   - the path resolves via the existing Loop config directory convention
 *     (LOOP_CONFIG_DIR / XDG_CONFIG_HOME / ~/.config/loop) with a
 *     LOOP_GATEWAY_RUNTIME_FILE override for tests
 *   - replacement is atomic (rename over target, no temp leftovers) and a
 *     rejected record or I/O failure leaves the previous file untouched
 *   - a bound server (OS-assigned port 0) yields the ACTUAL bound port, the
 *     value the composition root records after startGateway returns
 *
 * Deterministic: temp directories only, no user config touched, no paid call.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  GATEWAY_RUNTIME_FILE_ENV,
  GATEWAY_RUNTIME_FILE_NAME,
  gatewayRuntimeRecordPath,
  magicDnsNameFromStatusOutput,
  pairingRecordHost,
  writeGatewayRuntimeRecord,
  type GatewayRuntimeRecord,
} from "../src/runtime-record";
import { bootTestGateway } from "./helpers";

describe("runtime record path resolution", () => {
  test("LOOP_GATEWAY_RUNTIME_FILE override wins (absolute and relative)", () => {
    const absolute = gatewayRuntimeRecordPath({ [GATEWAY_RUNTIME_FILE_ENV]: "/tmp/x/gw.json" });
    expect(absolute).toBe("/tmp/x/gw.json");
    const relative = gatewayRuntimeRecordPath({ [GATEWAY_RUNTIME_FILE_ENV]: "out/gw.json" });
    expect(relative.endsWith("out/gw.json") || relative.endsWith("out\\gw.json")).toBe(true);
  });

  test("default follows the existing loop config directory convention", () => {
    const loopDir = gatewayRuntimeRecordPath({ LOOP_CONFIG_DIR: "/cfg/loop" });
    expect(loopDir).toBe(join("/cfg/loop", GATEWAY_RUNTIME_FILE_NAME));

    const xdg = gatewayRuntimeRecordPath({ XDG_CONFIG_HOME: "/xdg" });
    expect(xdg).toBe(join("/xdg", "loop", GATEWAY_RUNTIME_FILE_NAME));

    const fallback = gatewayRuntimeRecordPath({});
    expect(fallback).toBe(join(homedir(), ".config", "loop", GATEWAY_RUNTIME_FILE_NAME));
  });
});

describe("runtime record writer", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync("/tmp/loop-gw-record-");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const path = () => join(root, "nested", "gateway.json");
  const record: GatewayRuntimeRecord = { host: "gw.tailnet.ts.net", port: 18477 };

  test("writes exactly { host, port } and creates missing parent directories", () => {
    writeGatewayRuntimeRecord(path(), record);
    const parsed = JSON.parse(readFileSync(path(), "utf8"));
    expect(Object.keys(parsed).toSorted()).toEqual(["host", "port"]);
    expect(parsed).toEqual(record);
  });

  test("atomically replaces an existing record and leaves no temp files", () => {
    writeGatewayRuntimeRecord(path(), record);
    const next: GatewayRuntimeRecord = { host: "100.80.133.120", port: 19000 };
    writeGatewayRuntimeRecord(path(), next);
    expect(JSON.parse(readFileSync(path(), "utf8"))).toEqual(next);
    const siblings = readdirSync(join(root, "nested"));
    expect(siblings).toEqual([GATEWAY_RUNTIME_FILE_NAME]);
  });

  test("rejects secret-shaped and malformed records without touching the target", () => {
    writeGatewayRuntimeRecord(path(), record);
    const before = readFileSync(path(), "utf8");
    for (const bad of [
      { host: "", port: 18477 },
      { host: "http://gw.ts.net", port: 18477 },
      { host: "gw.ts.net:18477", port: 18477 },
      { host: "gw with space", port: 18477 },
      { host: "gw.ts.net", port: 0 },
      { host: "gw.ts.net", port: 70000 },
      { host: "gw.ts.net", port: 18477.5 },
    ] as unknown as GatewayRuntimeRecord[]) {
      expect(() => writeGatewayRuntimeRecord(path(), bad)).toThrow();
    }
    expect(readFileSync(path(), "utf8")).toBe(before);
    expect(existsSync(`${path()}.tmp`)).toBe(false);
  });

  test("surface contains no secret-bearing fields by construction", () => {
    writeGatewayRuntimeRecord(path(), record);
    const raw = readFileSync(path(), "utf8").toLowerCase();
    for (const banned of ["token", "secret", "jwt", "bearer", "issuer", "audience", "password"]) {
      expect(raw.includes(banned)).toBe(false);
    }
  });
});

describe("bound-server integration (composition data source)", () => {
  let gateway: ReturnType<typeof bootTestGateway> | null = null;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync("/tmp/loop-gw-record-bind-");
  });

  afterEach(() => {
    gateway?.stop();
    gateway = null;
    rmSync(root, { recursive: true, force: true });
  });

  test("records the actually bound port, not the OS-assigned 0", () => {
    gateway = bootTestGateway(); // binds 127.0.0.1:0 like the real composition
    const target = join(root, "gateway.json");
    // Exactly what bootGatewayFromEnv does after startGateway returns: the
    // bound host is re-labeled via MagicDNS only for tailnet (CGNAT) binds.
    writeGatewayRuntimeRecord(target, {
      host: pairingRecordHost(gateway.server.hostname, null),
      port: gateway.server.port,
    });
    const parsed = JSON.parse(readFileSync(target, "utf8"));
    expect(parsed).toEqual({ host: "127.0.0.1", port: gateway.server.port });
    expect(parsed.port).toBeGreaterThan(0);
  });
});

describe("MagicDNS-first pairing record host", () => {
  test("magicDnsNameFromStatusOutput extracts Self.DNSName with the trailing dot stripped", () => {
    expect(
      magicDnsNameFromStatusOutput(JSON.stringify({ Self: { DNSName: "loopy-macbookpro.tail42f248.ts.net." } })),
    ).toBe("loopy-macbookpro.tail42f248.ts.net");
    expect(magicDnsNameFromStatusOutput(JSON.stringify({ Self: { DNSName: "  gw.ts.net " } }))).toBe(
      "gw.ts.net",
    );
  });

  test("magicDnsNameFromStatusOutput degrades to null on anything unusable", () => {
    expect(magicDnsNameFromStatusOutput("not json")).toBeNull();
    expect(magicDnsNameFromStatusOutput(JSON.stringify({}))).toBeNull();
    expect(magicDnsNameFromStatusOutput(JSON.stringify({ Self: {} }))).toBeNull();
    expect(magicDnsNameFromStatusOutput(JSON.stringify({ Self: { DNSName: "" } }))).toBeNull();
    expect(magicDnsNameFromStatusOutput(JSON.stringify({ Self: { DNSName: "." } }))).toBeNull();
  });

  test("pairingRecordHost re-labels a tailnet CGNAT bind with the MagicDNS name", () => {
    expect(pairingRecordHost("100.80.133.120", "loopy-macbookpro.tail42f248.ts.net")).toBe(
      "loopy-macbookpro.tail42f248.ts.net",
    );
  });

  test("pairingRecordHost keeps the bound host when no MagicDNS name is known", () => {
    // Tailscale off/not reporting: existing behavior, bare IP record.
    expect(pairingRecordHost("100.80.133.120", null)).toBe("100.80.133.120");
    expect(pairingRecordHost("100.64.0.1", "")).toBe("100.64.0.1");
  });

  test("pairingRecordHost never re-labels non-tailnet binds", () => {
    // Bearer-fallback loopback: the MagicDNS name would claim reachability
    // the gateway does not have on that interface.
    expect(pairingRecordHost("127.0.0.1", "gw.ts.net")).toBe("127.0.0.1");
    expect(pairingRecordHost("192.168.1.10", "gw.ts.net")).toBe("192.168.1.10");
  });

  test("CGNAT boundary: only 100.64.0.0/10 counts as tailnet-facing", () => {
    expect(pairingRecordHost("100.63.255.255", "gw.ts.net")).toBe("100.63.255.255");
    expect(pairingRecordHost("100.128.0.0", "gw.ts.net")).toBe("100.128.0.0");
    expect(pairingRecordHost("100.100.20.30", "gw.ts.net")).toBe("gw.ts.net");
  });
});

describe("main module docs stay honest", () => {
  test("path helper is exported from the adapter surface", async () => {
    const index = await import("../src/index");
    expect(typeof index.gatewayRuntimeRecordPath).toBe("function");
    expect(typeof index.writeGatewayRuntimeRecord).toBe("function");
  });
});
