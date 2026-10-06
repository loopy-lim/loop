/**
 * QR pairing tests (decision 2026-xx-qr-pairing): payload round-trip, secret
 * refusal, port boundaries, encoder self-consistency against independent
 * reimplementations, and the deterministic golden matrix shared with the
 * desktop surface. No network, no paid model calls.
 */

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  QR_MAX_BYTES,
  QrCapacityError,
  encodeQr,
  encodeQrMatrix,
  formatBits,
  maskBit,
  renderAsciiQr,
} from "../src/qr";
import {
  GATEWAY_RUNTIME_FILE_ENV,
  GATEWAY_RUNTIME_FILE_NAME,
  PAIR_URL_PREFIX,
  buildPairUrl,
  formatPairText,
  gatewayRuntimeRecordPath,
  isIpLiteralHost,
  parseGatewayRuntimeRecord,
  parsePairUrl,
  resolvePair,
  runPairCommand,
  type PairDeps,
} from "../src/pair";

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}
import golden from "./fixtures/pairing-qr-golden.json";

const PAYLOAD_HOST = "loopy-macbookpro.tail42f248.ts.net";
const PAYLOAD_URL = `loop://connect?host=${PAYLOAD_HOST}&port=18477`;

// ---------------------------------------------------------------------------
// Payload round-trip (acceptance 1: parse back to the same config).
// ---------------------------------------------------------------------------

test("pair URL round-trips to the same host and port", () => {
  const url = buildPairUrl(PAYLOAD_HOST, 18477);
  expect(url).toBe(PAYLOAD_URL);
  expect(parsePairUrl(url)).toEqual({ host: PAYLOAD_HOST, port: 18477 });
});

test("port boundaries 1 and 65535 survive the round-trip; outside values fail", () => {
  expect(parsePairUrl(buildPairUrl(PAYLOAD_HOST, 1)).port).toBe(1);
  expect(parsePairUrl(buildPairUrl(PAYLOAD_HOST, 65535)).port).toBe(65535);
  for (const bad of [0, -1, 65536, 1.5, "abc", ""]) {
    expect(() => buildPairUrl(PAYLOAD_HOST, bad as number)).toThrow();
    expect(() => parsePairUrl(`loop://connect?host=${PAYLOAD_HOST}&port=${bad}`)).toThrow();
  }
});

test("unknown query parameters are ignored (forward compatibility)", () => {
  const url = `${PAYLOAD_URL}&v=2&future=1`;
  expect(parsePairUrl(url)).toEqual({ host: PAYLOAD_HOST, port: 18477 });
});

test("secret-bearing payloads are refused, never silently accepted", () => {
  for (const key of ["token", "secret", "bearer", "password", "api_key", "apiKey", "credential"]) {
    expect(() => parsePairUrl(`loop://connect?host=${PAYLOAD_HOST}&port=18477&${key}=x`)).toThrow(
      /must not carry secrets/,
    );
  }
  expect(() => parsePairUrl("https://example.com/connect?host=x&port=1")).toThrow(
    /not a loop pairing URL/,
  );
  expect(() => parsePairUrl("loop://submit?host=x&port=1")).toThrow();
  expect(() => parsePairUrl("loop://connect?host=x")).toThrow(/requires host and port/);
  expect(() => parsePairUrl("loop://connect?host=&port=1")).toThrow();
  expect(() => parsePairUrl("loop://connect?host=bad/host&port=1")).toThrow();
  expect(() => parsePairUrl("loop://connect?host=bad:port&port=1")).toThrow();
});

// ---------------------------------------------------------------------------
// Encoder self-consistency against independent reimplementations.
// ---------------------------------------------------------------------------

test("golden matrix: the shared pairing payload encodes identically on both surfaces", () => {
  const encoded = encodeQrMatrix(golden.payload);
  expect(encoded.spec.version).toBe(golden.version);
  expect(encoded.maskId).toBe(golden.maskId);
  expect(encoded.matrix).toEqual(
    golden.matrix.map((row: number[]) => row.map((cell: number) => cell === 1)),
  );
});

/** Binary-shift GF(256) multiplication — an independent code path from the
 * encoder's log/exp tables. */
function gfMul(a: number, b: number): number {
  let result = 0;
  while (b > 0) {
    if ((b & 1) !== 0) result ^= a;
    b >>= 1;
    a <<= 1;
    if (a >= 0x100) a ^= 0x11d;
  }
  return result;
}

test("Reed-Solomon: the codeword stream is divisible by an independently built generator", () => {
  const exp: number[] = [];
  {
    let value = 1;
    for (let i = 0; i < 255; i += 1) {
      exp.push(value);
      value = gfMul(value, 2);
    }
  }
  const generator = (n: number): number[] => {
    let poly: number[] = [1];
    for (let i = 0; i < n; i += 1) {
      const next: number[] = Array.from({ length: poly.length + 1 }, () => 0);
      for (let j = 0; j < poly.length; j += 1) {
        next[j] = must(next[j]) ^ must(poly[j]);
        next[j + 1] = must(next[j + 1]) ^ gfMul(must(poly[j]), must(exp[i]));
      }
      poly = next;
    }
    return poly;
  };
  const encoding = encodeQrMatrix(golden.payload);
  const spec = encoding.spec;
  const codewords: number[] = [];
  for (let i = 0; i < encoding.finalBits.length - spec.remainderBits; i += 8) {
    let byte = 0;
    for (let shift = 0; shift < 8; shift += 1)
      byte = (byte << 1) | (encoding.finalBits[i + shift] ? 1 : 0);
    codewords.push(byte);
  }
  expect(codewords.length).toBe(spec.dataCodewords + spec.eccCodewords);
  const gen = generator(spec.eccCodewords);
  const working = codewords.slice();
  for (let i = 0; i < spec.dataCodewords; i += 1) {
    const factor = must(working[i]);
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j += 1) working[i + j] = must(working[i + j]) ^ gfMul(must(gen[j]), factor);
  }
  expect(working.slice(spec.dataCodewords).every((byte) => byte === 0)).toBe(true);
});

test("placement: an independent zigzag+unmask extraction reproduces the bitstream", () => {
  const encoding = encodeQrMatrix(golden.payload);
  const size = encoding.matrix.length;
  const reserved = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const mark = (row: number, col: number): void => {
    if (row >= 0 && row < size && col >= 0 && col < size) must(reserved[row])[col] = true;
  };
  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) mark(top + dy, left + dx);
    }
  }
  for (let i = 8; i <= size - 9; i += 1) {
    mark(6, i);
    mark(i, 6);
  }
  for (const centerRow of encoding.spec.alignment) {
    for (const centerCol of encoding.spec.alignment) {
      const overlaps =
        (centerRow === 6 && centerCol === 6) ||
        (centerRow === 6 && centerCol === size - 7) ||
        (centerRow === size - 7 && centerCol === 6);
      if (!overlaps) {
        for (let dy = -2; dy <= 2; dy += 1)
          for (let dx = -2; dx <= 2; dx += 1) mark(centerRow + dy, centerCol + dx);
      }
    }
  }
  for (let i = 0; i <= 5; i += 1) mark(i, 8);
  mark(7, 8);
  mark(8, 8);
  mark(8, 7);
  for (let i = 9; i <= 14; i += 1) mark(8, 14 - i);
  for (let i = 0; i <= 7; i += 1) mark(size - 1 - i, 8);
  for (let i = 8; i <= 14; i += 1) mark(8, size - 15 + i);
  mark(size - 8, 8);

  const extracted: boolean[] = [];
  outer: for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vertical : vertical;
        if (reserved[row]?.[col]) continue;
        extracted.push(encoding.matrix[row]?.[col] !== maskBit(encoding.maskId, col, row));
        if (extracted.length === encoding.finalBits.length) break outer;
      }
    }
  }
  expect(extracted).toEqual(encoding.finalBits);
});

test("format info matches an independent BCH(15,5) computation", () => {
  const encoding = encodeQrMatrix(golden.payload);
  const size = encoding.matrix.length;
  // Independent BCH: polynomial long division of (data<<10) by 0x537.
  const data = (0b01 << 3) | encoding.maskId;
  let remainder = data << 10;
  for (let degree = 14; degree >= 10; degree -= 1) {
    if (((remainder >> degree) & 1) !== 0) remainder ^= 0x537 << (degree - 10);
  }
  const expected = ((data << 10) | remainder) ^ 0x5412;
  const placed: number[] = [];
  for (let i = 0; i <= 5; i += 1) placed.push(must(encoding.matrix[i])[8] ? 1 : 0);
  placed.push(
    must(encoding.matrix[7])[8] ? 1 : 0,
    must(encoding.matrix[8])[8] ? 1 : 0,
    must(encoding.matrix[8])[7] ? 1 : 0,
  );
  for (let i = 9; i <= 14; i += 1) placed.push(must(encoding.matrix[8])[14 - i] ? 1 : 0);
  for (let i = 0; i <= 7; i += 1) placed.push(must(encoding.matrix[size - 1 - i])[8] ? 1 : 0);
  for (let i = 8; i <= 14; i += 1) placed.push(must(encoding.matrix[8])[size - 15 + i] ? 1 : 0);
  let got = 0;
  for (let i = 0; i < 15; i += 1) if (placed[i] === 1) got |= 1 << i;
  expect(got).toBe(expected);
  expect(formatBits(encoding.maskId).length).toBe(15);
});

test("structural invariants: size, finder corners, timing alternation, capacity error", () => {
  const matrix = encodeQr(golden.payload);
  expect(matrix.length).toBe(golden.size);
  const at = (row: number, col: number): boolean => must(matrix[row])[col];
  for (const [top, left] of [
    [0, 0],
    [0, golden.size - 7],
    [golden.size - 7, 0],
  ] as const) {
    expect(at(top, left)).toBe(true);
    expect(at(top + 6, left + 6)).toBe(true);
    expect(at(top + 3, left + 3)).toBe(true);
    expect(at(top + 1, left + 1)).toBe(false);
    expect(at(top + 5, left + 1)).toBe(false);
  }
  for (let i = 8; i <= golden.size - 9; i += 1) {
    expect(at(6, i)).toBe(i % 2 === 0);
    expect(at(i, 6)).toBe(i % 2 === 0);
  }
  expect(encodeQr(golden.payload)).toEqual(matrix); // deterministic
  expect(QR_MAX_BYTES).toBe(106);
  expect(encodeQr("x".repeat(QR_MAX_BYTES)).length).toBeGreaterThan(0);
  expect(() => encodeQr("x".repeat(QR_MAX_BYTES + 1))).toThrow(QrCapacityError);
});

test("ASCII rendering: half-block lines of equal length with a quiet zone", () => {
  const matrix = encodeQr(golden.payload);
  const ascii = renderAsciiQr(matrix);
  const lines = ascii.split("\n");
  const padded = golden.size + 4; // 2-module quiet zone on every side
  expect(lines.length).toBe(Math.ceil(padded / 2)); // two matrix rows per text line
  expect(new Set(lines.map((line) => line.length))).toEqual(new Set([padded]));
  for (const line of lines) {
    for (const char of line) expect([" ", "▀", "▄", "█"]).toContain(char);
  }
  expect(lines[0]).toBe(" ".repeat(padded));
  expect(lines[lines.length - 1]).toBe(" ".repeat(padded));
});

// ---------------------------------------------------------------------------
// Host resolution (acceptance 1: deterministic parse-back of CLI output).
// ---------------------------------------------------------------------------

function pairDeps(overrides: Partial<PairDeps> = {}): PairDeps {
  return {
    env: { LOOP_GATEWAY_PORT: "18477", LOOP_GATEWAY_HOST: "100.80.133.120" },
    probe: async () => ({ exitCode: 1, output: "" }),
    // Hermetic by default: no test reaches the real user config directory;
    // record-backed cases inject a LOOP_GATEWAY_RUNTIME_FILE temp path.
    readRuntimeFile: () => null,
    ...overrides,
  };
}

test("resolvePair prefers the flag, then MagicDNS, then the record, then the env host", async () => {
  const byFlag = await resolvePair(pairDeps(), "operator.tail42f248.ts.net");
  expect(byFlag).toMatchObject({ host: "operator.tail42f248.ts.net", port: 18477, source: "flag" });

  const byMagicDns = await resolvePair(
    pairDeps({
      probe: async () => ({
        exitCode: 0,
        output: JSON.stringify({ Self: { DNSName: `${PAYLOAD_HOST}.` } }),
      }),
    }),
  );
  expect(byMagicDns).toMatchObject({ host: PAYLOAD_HOST, source: "magicdns", ipAtsWarning: false });

  const byEnv = await resolvePair(pairDeps());
  expect(byEnv).toMatchObject({ host: "100.80.133.120", source: "env", ipAtsWarning: true });
  expect(isIpLiteralHost(byEnv.host)).toBe(true);
  expect(isIpLiteralHost(PAYLOAD_HOST)).toBe(false);

  await expect(
    resolvePair(pairDeps({ env: { LOOP_GATEWAY_PORT: "18477" } })),
  ).rejects.toMatchObject({
    code: "pair-host-unresolved",
  });
});

// ---------------------------------------------------------------------------
// Port resolution: env first, gateway runtime record fallback, explicit error.
// Temp-path injection via LOOP_GATEWAY_RUNTIME_FILE keeps the suite off the
// real user config directory.
// ---------------------------------------------------------------------------

function withTempRecord(): { root: string; recordPath: string } {
  const root = mkdtempSync(join(tmpdir(), "loop-pair-record-"));
  return { root, recordPath: join(root, GATEWAY_RUNTIME_FILE_NAME) };
}

test("runtime record path follows the loop config directory convention with an override", () => {
  expect(gatewayRuntimeRecordPath({ [GATEWAY_RUNTIME_FILE_ENV]: "/tmp/x/gw.json" })).toBe(
    "/tmp/x/gw.json",
  );
  expect(gatewayRuntimeRecordPath({ LOOP_CONFIG_DIR: "/cfg/loop" })).toBe(
    join("/cfg/loop", GATEWAY_RUNTIME_FILE_NAME),
  );
  expect(gatewayRuntimeRecordPath({ XDG_CONFIG_HOME: "/xdg" })).toBe(
    join("/xdg", "loop", GATEWAY_RUNTIME_FILE_NAME),
  );
});

test("parseGatewayRuntimeRecord accepts only a clean connection pair; extra or secret fields are ignored", () => {
  expect(parseGatewayRuntimeRecord(null)).toBeNull();
  expect(parseGatewayRuntimeRecord("")).toBeNull();
  expect(parseGatewayRuntimeRecord("not json")).toBeNull();
  expect(parseGatewayRuntimeRecord('{"host":"h.ts.net"}')).toBeNull();
  expect(parseGatewayRuntimeRecord('{"port":18477}')).toBeNull();
  expect(parseGatewayRuntimeRecord('{"host":"http://h.ts.net","port":18477}')).toBeNull();
  expect(parseGatewayRuntimeRecord('{"host":"h.ts.net:18477","port":18477}')).toBeNull();
  expect(parseGatewayRuntimeRecord('{"host":"h.ts.net","port":0}')).toBeNull();
  expect(parseGatewayRuntimeRecord('{"host":"h.ts.net","port":70000}')).toBeNull();
  expect(parseGatewayRuntimeRecord('{"host":"h.ts.net","port":18477,"token":"leak"}')).toEqual({
    host: "h.ts.net",
    port: 18477,
  });
});

test("resolvePair falls back to the gateway runtime record for the port and the host", async () => {
  const { root, recordPath } = withTempRecord();
  try {
    // A MagicDNS-name record: the host comes from the record too — iOS ATS
    // accepts DNS names, so no warning fires (decision: MagicDNS-first).
    writeFileSync(recordPath, JSON.stringify({ host: "gw.tailnet.ts.net", port: 19001 }), "utf8");
    const byRecord = await resolvePair(
      pairDeps({
        env: { [GATEWAY_RUNTIME_FILE_ENV]: recordPath, LOOP_GATEWAY_HOST: "100.80.133.120" },
        readRuntimeFile: (path) => readFileSync(path, "utf8"),
      }),
    );
    expect(byRecord).toMatchObject({
      host: "gw.tailnet.ts.net",
      port: 19001,
      source: "record",
      ipAtsWarning: false,
    });
    expect(parsePairUrl(byRecord.url)).toEqual({ host: "gw.tailnet.ts.net", port: 19001 });

    // A bare-IP record still resolves (pre-MagicDNS gateways) with the ATS warning.
    writeFileSync(recordPath, JSON.stringify({ host: "100.80.133.120", port: 19001 }), "utf8");
    const byIpRecord = await resolvePair(
      pairDeps({
        env: { [GATEWAY_RUNTIME_FILE_ENV]: recordPath, LOOP_GATEWAY_HOST: "gw.env.ts.net" },
        readRuntimeFile: (path) => readFileSync(path, "utf8"),
      }),
    );
    expect(byIpRecord).toMatchObject({
      host: "100.80.133.120",
      port: 19001,
      source: "record",
      ipAtsWarning: true,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a MagicDNS name wins over a recorded or env host; a flag wins over everything", async () => {
  const { root, recordPath } = withTempRecord();
  try {
    writeFileSync(recordPath, JSON.stringify({ host: "record.ts.net", port: 19001 }), "utf8");
    const base = {
      env: {
        [GATEWAY_RUNTIME_FILE_ENV]: recordPath,
        LOOP_GATEWAY_PORT: "18477",
        LOOP_GATEWAY_HOST: "100.80.133.120",
      },
      readRuntimeFile: undefined as PairDeps["readRuntimeFile"],
    };
    const deps = (probe: PairDeps["probe"]): PairDeps => ({
      ...base,
      probe,
      readRuntimeFile: (path) => readFileSync(path, "utf8"),
    });

    // MagicDNS beats the record host and the env host.
    const byMagicDns = await resolvePair(
      deps(async () => ({
        exitCode: 0,
        output: JSON.stringify({ Self: { DNSName: "magic.ts.net." } }),
      })),
    );
    expect(byMagicDns).toMatchObject({ host: "magic.ts.net", source: "magicdns" });

    // An explicit flag still overrides MagicDNS (operator intent wins).
    const byFlag = await resolvePair(
      deps(async () => ({ exitCode: 0, output: JSON.stringify({ Self: { DNSName: "magic.ts.net" } }) })),
      "operator.ts.net",
    );
    expect(byFlag).toMatchObject({ host: "operator.ts.net", source: "flag" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a set LOOP_GATEWAY_PORT wins over the runtime record", async () => {
  const byEnv = await resolvePair(
    pairDeps({
      env: {
        LOOP_GATEWAY_PORT: "18477",
        LOOP_GATEWAY_HOST: "100.80.133.120",
        [GATEWAY_RUNTIME_FILE_ENV]: "/nonexistent-loop-pair/gateway.json",
      },
    }),
  );
  expect(byEnv.port).toBe(18477);
});

test("a set but invalid LOOP_GATEWAY_PORT fails closed instead of silently falling back", async () => {
  const { root, recordPath } = withTempRecord();
  try {
    writeFileSync(recordPath, JSON.stringify({ host: "gw.tailnet.ts.net", port: 19001 }), "utf8");
    for (const badPort of ["0", "nope", "70000"]) {
      await expect(
        resolvePair(
          pairDeps({ env: { LOOP_GATEWAY_PORT: badPort, [GATEWAY_RUNTIME_FILE_ENV]: recordPath } }),
        ),
      ).rejects.toThrow(/integer in 1\.\.65535/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolvePair fails closed on a missing or invalid gateway port", async () => {
  const { root, recordPath } = withTempRecord();
  try {
    // Neither source: the error names LOOP_GATEWAY_PORT and the record path.
    const failure = await resolvePair(
      pairDeps({ env: { [GATEWAY_RUNTIME_FILE_ENV]: recordPath } }),
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "pair-port-unresolved" });
    expect((failure as Error).message).toContain("LOOP_GATEWAY_PORT");
    expect((failure as Error).message).toContain(recordPath);

    // A malformed record is ignored, degrading to the same explicit error.
    writeFileSync(recordPath, "{ not json", "utf8");
    await expect(
      resolvePair(pairDeps({ env: { [GATEWAY_RUNTIME_FILE_ENV]: recordPath } })),
    ).rejects.toMatchObject({ code: "pair-port-unresolved" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolvePair tolerates a broken tailscale probe output", async () => {
  const broken = await resolvePair(
    pairDeps({ probe: async () => ({ exitCode: 0, output: "not json" }) }),
  );
  expect(broken.source).toBe("env");
  const emptyDns = await resolvePair(
    pairDeps({ probe: async () => ({ exitCode: 0, output: JSON.stringify({ Self: {} }) }) }),
  );
  expect(emptyDns.source).toBe("env");
});

test("MagicDNS probe falls back to the macOS app bundle CLI when PATH has no tailscale", async () => {
  const probed: string[] = [];
  const resolved = await resolvePair(
    pairDeps({
      probe: async (command, args) => {
        probed.push(`${command} ${args.join(" ")}`);
        // PATH lookup fails (spawn error); the app bundle CLI answers on
        // the first (peers-less) arg variant.
        if (command === "tailscale") throw new Error("spawn tailscale ENOENT");
        return {
          exitCode: 0,
          output: JSON.stringify({ Self: { DNSName: `${PAYLOAD_HOST}.` } }),
        };
      },
    }),
  );
  expect(resolved).toMatchObject({ host: PAYLOAD_HOST, source: "magicdns" });
  expect(probed).toEqual([
    "tailscale status --json --peers=false",
    "tailscale status --json",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale status --json --peers=false",
  ]);
});

test("MagicDNS probe falls through to plain --json when the CLI rejects --peers=false", async () => {
  const resolved = await resolvePair(
    pairDeps({
      probe: async (_command, args) =>
        args.includes("--peers=false")
          ? { exitCode: 1, output: "unknown flag: --peers" }
          : {
              exitCode: 0,
              output: JSON.stringify({ Self: { DNSName: `${PAYLOAD_HOST}.` } }),
            },
    }),
  );
  expect(resolved).toMatchObject({ host: PAYLOAD_HOST, source: "magicdns" });
});

test("MagicDNS probe prefers PATH tailscale and skips the bundle when PATH answers", async () => {
  const probed: string[] = [];
  const resolved = await resolvePair(
    pairDeps({
      probe: async (command, args) => {
        probed.push(`${command} ${args.join(" ")}`);
        expect(command).toBe("tailscale");
        return {
          exitCode: 0,
          output: JSON.stringify({ Self: { DNSName: `${PAYLOAD_HOST}.` } }),
        };
      },
    }),
  );
  expect(resolved).toMatchObject({ source: "magicdns" });
  expect(probed).toEqual(["tailscale status --json --peers=false"]);
});

test("runPairCommand output parses back to the same host and port; JSON stays machine-readable", async () => {
  const lines: string[] = [];
  const exitCode = await runPairCommand(
    pairDeps({
      probe: async () => ({
        exitCode: 0,
        output: JSON.stringify({ Self: { DNSName: `${PAYLOAD_HOST}.` } }),
      }),
    }),
    { stdout: (value) => lines.push(value), stderr: () => {} },
    {},
  );
  expect(exitCode).toBe(0);
  const text = lines.join("");
  expect(text).toContain(PAYLOAD_URL);
  expect(parsePairUrl(PAYLOAD_URL)).toEqual({ host: PAYLOAD_HOST, port: 18477 });
  expect(text).toContain("▀"); // the ASCII QR is present
  expect(text).not.toMatch(/bearer|secret|password/i);

  const jsonLines: string[] = [];
  await runPairCommand(
    pairDeps({
      probe: async () => ({
        exitCode: 0,
        output: JSON.stringify({ Self: { DNSName: `${PAYLOAD_HOST}.` } }),
      }),
    }),
    { stdout: (value) => jsonLines.push(value), stderr: () => {} },
    { json: true },
  );
  const parsed = JSON.parse(jsonLines.join(""));
  expect(parsed).toEqual({ url: PAYLOAD_URL, host: PAYLOAD_HOST, port: 18477, source: "magicdns" });
});

test("plain output warns on IP-literal hosts and still round-trips", async () => {
  const lines: string[] = [];
  await runPairCommand(pairDeps(), { stdout: (value) => lines.push(value), stderr: () => {} }, {});
  const text = lines.join("");
  expect(text).toContain("iOS ATS rejects numeric hosts");
  const url = must(text.split("\n").find((line) => line.startsWith(PAIR_URL_PREFIX)));
  expect(parsePairUrl(url)).toEqual({ host: "100.80.133.120", port: 18477 });
});

test("formatted text embeds the QR matrix exactly as rendered standalone", () => {
  const info = {
    url: PAYLOAD_URL,
    host: PAYLOAD_HOST,
    port: 18477,
    source: "magicdns" as const,
    ipAtsWarning: false,
  };
  expect(formatPairText(info)).toContain(renderAsciiQr(encodeQr(PAYLOAD_URL)));
});
