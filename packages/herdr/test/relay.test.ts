import { describe, expect, test } from "bun:test";

import {
  SteerRelaySession,
  encodeDisplayFrame,
  parsePaneLine,
  runSteerRelaySession,
  type SteerRelayDelivery,
} from "../src/relay";

/** Fake surface redaction honoring the injected contract (production wires providers' redactProviderText). */
function fakeRedact(line: string, limit: number): string {
  return line.replace(/(?:api_key|token)=\S+/gi, "[credential]=[redacted]").slice(0, limit);
}

interface FakeRelay {
  deliveries: SteerRelayDelivery[];
  echoes: string[];
  session: SteerRelaySession;
  failNext: boolean;
}

function fakeRelay(
  overrides: Partial<ConstructorParameters<typeof SteerRelaySession>[0]> = {},
): FakeRelay {
  const relay: FakeRelay = { deliveries: [], echoes: [], failNext: false } as unknown as FakeRelay;
  relay.session = new SteerRelaySession({
    runId: "run-1",
    taskId: "t-1",
    deliver: async (input) => {
      if (relay.failNext) {
        relay.failNext = false;
        throw new Error("steer backend rejected api_key=abc123");
      }
      relay.deliveries.push(input);
    },
    echo: (line) => relay.echoes.push(line),
    redact: fakeRedact,
    ...overrides,
  });
  return relay;
}

describe("parsePaneLine", () => {
  test("display frames round-trip through encode/parse", () => {
    const frame = encodeDisplayFrame("[message] hello world");
    expect(parsePaneLine(frame)).toEqual({ kind: "display", text: "[message] hello world" });
  });

  test("frames survive embedded newlines as single-line JSON", () => {
    const frame = encodeDisplayFrame("[message] line1\nline2");
    expect(frame).not.toContain("\n");
    expect(parsePaneLine(frame)).toEqual({ kind: "display", text: "[message] line1\nline2" });
  });

  test("user-typed JSON that is not a display frame is steer input", () => {
    expect(parsePaneLine('{"a": 1}')).toEqual({ kind: "steer", text: '{"a": 1}' });
    expect(parsePaneLine('{"loopDisplay": 1}')).toEqual({
      kind: "steer",
      text: '{"loopDisplay": 1}',
    });
    expect(parsePaneLine('{"loopDisplay":"x","extra":2}')).toEqual({
      kind: "steer",
      text: '{"loopDisplay":"x","extra":2}',
    });
    expect(parsePaneLine("{not json}")).toEqual({ kind: "steer", text: "{not json}" });
  });
});

describe("SteerRelaySession", () => {
  test("a typed line is delivered as steer with the worker's run/task ids and echoed redacted", async () => {
    const relay = fakeRelay();
    await relay.session.handleLine("Preserve api_key=abc123 compatibility");

    expect(relay.deliveries).toEqual([
      { runId: "run-1", taskId: "t-1", message: "Preserve api_key=abc123 compatibility" },
    ]);
    expect(relay.echoes).toEqual(["→ steer: Preserve [credential]=[redacted] compatibility"]);
  });

  test("the steer message carries the raw typed line; only the echo is redacted", async () => {
    const relay = fakeRelay();
    await relay.session.handleLine("keep token=supersecret enabled");

    expect(relay.deliveries[0]?.message).toBe("keep token=supersecret enabled");
    expect(relay.echoes[0]).toBe("→ steer: keep [credential]=[redacted] enabled");
    expect(relay.echoes[0]).not.toContain("supersecret");
  });

  test("display frames are echoed into the pane and never steered", async () => {
    const relay = fakeRelay();
    await relay.session.handleLine(encodeDisplayFrame("[lifecycle] starting t-1"));

    expect(relay.deliveries).toEqual([]);
    expect(relay.echoes).toEqual(["[lifecycle] starting t-1"]);
  });

  test("multi-line input delivers one steer per line and skips blank lines", async () => {
    const relay = fakeRelay();
    await relay.session.handleLine("first guidance");
    await relay.session.handleLine("   ");
    await relay.session.handleLine("second guidance");

    expect(relay.deliveries.map((delivery) => delivery.message)).toEqual([
      "first guidance",
      "second guidance",
    ]);
    expect(relay.echoes).toHaveLength(2);
  });

  test("echoes are clamped to the line limit", async () => {
    const relay = fakeRelay({ lineTextLimit: 20 });
    await relay.session.handleLine("a very long steer message that must be clamped");

    expect(relay.deliveries[0]?.message).toBe("a very long steer message that must be clamped");
    expect(relay.echoes[0]).toBe("→ steer: a very long steer me");
    expect(relay.echoes[0]!.length).toBeLessThanOrEqual("→ steer: ".length + 20);
  });

  test("a failed delivery echoes a redacted failure and the relay stays alive", async () => {
    const relay = fakeRelay();
    relay.failNext = true;
    await relay.session.handleLine("first try api_key=abc123 fails");
    await relay.session.handleLine("second try works");

    expect(relay.deliveries).toEqual([
      { runId: "run-1", taskId: "t-1", message: "second try works" },
    ]);
    expect(relay.echoes[0]).toContain("! steer not delivered:");
    expect(relay.echoes[0]).toContain("[credential]=[redacted]");
    expect(relay.echoes[0]).not.toContain("abc123");
    expect(relay.echoes[1]).toBe("→ steer: second try works");
  });

  test("a user typing a display frame gets it displayed (no steer, no crash)", async () => {
    const relay = fakeRelay();
    await relay.session.handleLine('{"loopDisplay":"hi"}');

    expect(relay.deliveries).toEqual([]);
    expect(relay.echoes).toEqual(["hi"]);
  });
});

describe("runSteerRelaySession", () => {
  test("processes every line and returns when the source ends (pane close → stdin EOF)", async () => {
    const relay = fakeRelay();
    const lines = (async function* lineSource() {
      yield "guidance one";
      yield encodeDisplayFrame("[message] progress");
      yield "guidance two";
    })();

    await runSteerRelaySession(lines, {
      runId: "run-1",
      taskId: "t-1",
      deliver: async (input) => void relay.deliveries.push(input),
      echo: (line) => relay.echoes.push(line),
      redact: fakeRedact,
    });

    expect(relay.deliveries.map((delivery) => delivery.message)).toEqual([
      "guidance one",
      "guidance two",
    ]);
    expect(relay.echoes).toEqual([
      "→ steer: guidance one",
      "[message] progress",
      "→ steer: guidance two",
    ]);
  });
});
