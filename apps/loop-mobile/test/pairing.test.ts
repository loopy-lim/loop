/**
 * QR pairing payload tests — the mobile scan-target side (decision
 * 2026-xx-qr-pairing D-A, acceptance #1/#4): the parsed payload round-trips
 * to the same ConnectionConfig pair, secret-bearing parameters are refused,
 * and the exact CLI golden payload parses unchanged (same decisions, same
 * fixture payload as packages/cli). No network, no paid model calls.
 */

import { describe, expect, test } from "bun:test";

import {
  PAIR_URL_PREFIX,
  PairUrlError,
  buildPairUrl,
  isIpLiteralHost,
  parsePairUrl,
} from "../src/auth/pairing";
import { createConnectionConfig } from "../src/auth/connection";

/** The committed golden pairing payload (shared verbatim with the CLI:
 * packages/cli/test/fixtures/pairing-qr-golden.json). */
const GOLDEN_PAYLOAD = "loop://connect?host=loopy-macbookpro.tail42f248.ts.net&port=18477";
const GOLDEN_HOST = "loopy-macbookpro.tail42f248.ts.net";

describe("pairing payload round trip", () => {
  test("the golden CLI payload parses to the same host and port", () => {
    expect(parsePairUrl(GOLDEN_PAYLOAD)).toEqual({ host: GOLDEN_HOST, port: 18477 });
    // And that pair rebuilds the exact ConnectionConfig the connect path uses.
    const { host, port } = parsePairUrl(GOLDEN_PAYLOAD);
    expect(createConnectionConfig(host, port)).toEqual({
      baseUrl: `http://${GOLDEN_HOST}:18477`,
      bearer: "",
    });
  });

  test("buildPairUrl reproduces the golden payload; parse inverts it", () => {
    expect(buildPairUrl(GOLDEN_HOST, 18477)).toBe(GOLDEN_PAYLOAD);
    expect(parsePairUrl(buildPairUrl(GOLDEN_HOST, 18477))).toEqual({
      host: GOLDEN_HOST,
      port: 18477,
    });
    expect(buildPairUrl(GOLDEN_HOST, "18477")).toBe(GOLDEN_PAYLOAD);
  });

  test("port boundaries 1 and 65535 survive; fractional, signed, and junk fail", () => {
    expect(parsePairUrl(buildPairUrl(GOLDEN_HOST, 1)).port).toBe(1);
    expect(parsePairUrl(buildPairUrl(GOLDEN_HOST, 65535)).port).toBe(65535);
    for (const bad of [0, -1, 65536, 1.5, "abc", ""]) {
      expect(() => buildPairUrl(GOLDEN_HOST, bad as number)).toThrow(PairUrlError);
      expect(() => parsePairUrl(`loop://connect?host=${GOLDEN_HOST}&port=${bad}`)).toThrow(
        PairUrlError,
      );
    }
  });
});

describe("payload refusals (decision §D-A)", () => {
  test("unknown parameters are ignored (forward compatibility)", () => {
    expect(parsePairUrl(`${GOLDEN_PAYLOAD}&v=2`)).toEqual({ host: GOLDEN_HOST, port: 18477 });
    expect(parsePairUrl(`${GOLDEN_PAYLOAD}&future=whatever`)).toEqual({
      host: GOLDEN_HOST,
      port: 18477,
    });
  });

  test("secret-bearing parameters are refused outright", () => {
    for (const key of [
      "token",
      "secret",
      "bearer",
      "password",
      "api_key",
      "apiKey",
      "credential",
    ]) {
      expect(() => parsePairUrl(`${GOLDEN_PAYLOAD}&${key}=x`)).toThrow(/must not carry secrets/);
    }
  });

  test("duplicate keys keep the first value; parameter names are case-sensitive", () => {
    expect(parsePairUrl(`${GOLDEN_PAYLOAD}&port=1`)).toEqual({ host: GOLDEN_HOST, port: 18477 });
    expect(() => parsePairUrl("loop://connect?HOST=x&port=1")).toThrow(/requires host and port/);
  });

  test("wrong scheme, wrong target, and malformed hosts fail closed", () => {
    expect(() => parsePairUrl("https://example.com/connect?host=x&port=1")).toThrow(
      /not a loop pairing URL/,
    );
    expect(() => parsePairUrl("loop://pair?host=x&port=1")).toThrow(/unexpected loop URL target/);
    expect(() => parsePairUrl("loop://connect?host=x")).toThrow(/requires host and port/);
    expect(() => parsePairUrl("loop://connect?host=&port=1")).toThrow();
    expect(() => parsePairUrl("loop://connect?host=a/b&port=1")).toThrow();
    expect(() => parsePairUrl("loop://connect?host=x:y&port=1")).toThrow();
    expect(() => parsePairUrl("not a url at all")).toThrow(PairUrlError);
  });

  test("the payload prefix constant matches the other two surfaces", () => {
    expect(PAIR_URL_PREFIX).toBe("loop://connect?");
  });
});

describe("IP-literal host caveat (decision D-A, iOS ATS)", () => {
  test("numeric hosts are flagged; MagicDNS names are not", () => {
    expect(isIpLiteralHost("100.80.133.120")).toBe(true);
    expect(isIpLiteralHost(GOLDEN_HOST)).toBe(false);
    // A numeric host still parses — the OS rejects it later at ATS, the
    // generator surfaces warn about it.
    expect(parsePairUrl("loop://connect?host=100.80.133.120&port=18477")).toEqual({
      host: "100.80.133.120",
      port: 18477,
    });
  });
});
