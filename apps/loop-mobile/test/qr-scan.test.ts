/**
 * In-app QR scan contract (task `mobile-safearea-qr-scan`): the pure model
 * (features/qrScanModel) is pinned here — payload parsing reuses the deep
 * link grammar exactly, camera-permission mapping is fail-safe, and the
 * duplicate-scan gate collapses the scanner's per-frame event bursts. No
 * native module is touched: these tests run in bun without pods or camera.
 */
import { describe, expect, test } from "bun:test";

import {
  evaluateScan,
  mapCameraPermission,
  QR_PAYLOAD_INVALID_MESSAGE,
  ScanGate,
  type ScanOutcome,
} from "../src/features/qrScanModel";

describe("qr payload evaluation (reuses the loop://connect grammar)", () => {
  test("accepts the exact payload the CLI QR and deep link carry", () => {
    const outcome = evaluateScan("loop://connect?host=loopy-macbookpro.tail42f248.ts.net&port=18477");
    expect(outcome).toEqual({
      kind: "accepted",
      host: "loopy-macbookpro.tail42f248.ts.net",
      port: 18477,
    });
  });

  test("accepts an IPv4 literal payload (parse-level; ATS is a probe concern)", () => {
    const outcome = evaluateScan("loop://connect?host=100.64.0.7&port=8080");
    expect(outcome).toEqual({ kind: "accepted", host: "100.64.0.7", port: 8080 });
  });

  test("tolerates whitespace around the decoded string", () => {
    const outcome = evaluateScan("  loop://connect?host=host-a&port=1 \n");
    expect(outcome).toEqual({ kind: "accepted", host: "host-a", port: 1 });
  });

  test("ignores unknown extra query parameters (forward compat)", () => {
    const outcome = evaluateScan("loop://connect?host=host-a&port=1234&v=2&app=loop");
    expect(outcome).toEqual({ kind: "accepted", host: "host-a", port: 1234 });
  });

  const invalidCases: Array<[string, string]> = [
    ["", "empty string"],
    ["   ", "whitespace only"],
    ["https://connect?host=a&port=1", "wrong scheme"],
    ["loop://pair?host=a&port=1", "wrong target"],
    ["loop://connect?port=1", "missing host"],
    ["loop://connect?host=a", "missing port"],
    ["loop://connect?host=&port=1", "empty host"],
    ["loop://connect?host=a&port=0", "port below range"],
    ["loop://connect?host=a&port=65536", "port above range"],
    ["loop://connect?host=a&port=abc", "non-numeric port"],
    ["loop://connect?host=a/b&port=1", "host with slash"],
    ["loop://connect?host=a:1&port=2", "host with colon"],
    ["hello world", "not a URL at all"],
  ];
  for (const [payload, label] of invalidCases) {
    test(`rejects ${label} with the stable manual-entry message`, () => {
      const outcome = evaluateScan(payload);
      expect(outcome).toEqual({ kind: "invalid", message: QR_PAYLOAD_INVALID_MESSAGE });
    });
  }

  test("refuses a secret-bearing payload outright (decision §D-A)", () => {
    // The refusal is the PARSER's (auth/pairing) — no scanner-side copy.
    const outcome = evaluateScan("loop://connect?host=a&port=1&token=super-secret");
    expect(outcome).toEqual({ kind: "invalid", message: QR_PAYLOAD_INVALID_MESSAGE });
  });
});

describe("camera permission mapping", () => {
  test("granted (vision-camera v4) and authorized both map to ready", () => {
    expect(mapCameraPermission("authorized")).toBe("ready");
    expect(mapCameraPermission("granted")).toBe("ready");
  });
  test("not-determined maps to checking (request is about to run)", () => {
    expect(mapCameraPermission("not-determined")).toBe("checking");
  });
  test("denied and restricted map to blocked with manual-entry guidance", () => {
    expect(mapCameraPermission("denied")).toBe("blocked");
    expect(mapCameraPermission("restricted")).toBe("blocked");
  });
  test("unknown statuses fail safe to blocked (never pretend the camera works)", () => {
    expect(mapCameraPermission("weird")).toBe("blocked");
    expect(mapCameraPermission("")).toBe("blocked");
  });
});

describe("scan gate (per-frame event burst dedupe)", () => {
  const PAYLOAD = "loop://connect?host=host-a&port=1";

  test("first sighting of a payload is evaluated", () => {
    const gate = new ScanGate(1000);
    const outcome = gate.offer(PAYLOAD, 0);
    expect(outcome).toEqual({ kind: "accepted", host: "host-a", port: 1 });
  });

  test("the same payload inside the cooldown collapses to idle", () => {
    const gate = new ScanGate(1000);
    void gate.offer(PAYLOAD, 0);
    expect(gate.offer(PAYLOAD, 50)).toEqual({ kind: "idle" });
    expect(gate.offer(PAYLOAD, 999)).toEqual({ kind: "idle" });
  });

  test("the same payload after the cooldown is evaluated again", () => {
    const gate = new ScanGate(1000);
    void gate.offer(PAYLOAD, 0);
    const outcome = gate.offer(PAYLOAD, 1000);
    expect(outcome).toEqual({ kind: "accepted", host: "host-a", port: 1 });
  });

  test("a different payload is evaluated immediately, no cooldown wait", () => {
    const gate = new ScanGate(60_000);
    void gate.offer(PAYLOAD, 0);
    const outcome = gate.offer("loop://connect?host=host-b&port=2", 1);
    expect(outcome).toEqual({ kind: "accepted", host: "host-b", port: 2 });
  });

  test("an invalid payload is ALSO deduped (no message flicker per frame)", () => {
    const gate = new ScanGate(1000);
    const first = gate.offer("junk scan", 0);
    expect(first.kind).toBe("invalid");
    expect(gate.offer("junk scan", 100)).toEqual({ kind: "idle" });
    // A different junk string still surfaces its (stable) rejection.
    const other: ScanOutcome = gate.offer("other junk", 100);
    expect(other).toEqual({ kind: "invalid", message: QR_PAYLOAD_INVALID_MESSAGE });
  });

  test("zero cooldown means every frame is evaluated (escape hatch)", () => {
    const gate = new ScanGate(0);
    void gate.offer(PAYLOAD, 0);
    expect(gate.offer(PAYLOAD, 0).kind).toBe("accepted");
  });

  test("rejects a negative cooldown up front", () => {
    expect(() => new ScanGate(-1)).toThrow(RangeError);
  });
});
