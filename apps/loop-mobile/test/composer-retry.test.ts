/**
 * Unit tests for the composer retry contract (decision
 * 2026-xx-codex-detail-checklist C10, AC10-3): the first send and the
 * Resend button share ONE path; a failure reaches onFailure and the
 * draft-clearing success branch never runs; retry re-invokes the same
 * routed target — steer stays on the steer endpoint while running.
 * Spy-based fakes only — no network, no model calls.
 */

import { describe, expect, test } from "bun:test";

import type { GatewayClient } from "../src/gateway-client/client";
import { composerTarget, sendComposerText } from "../src/state/composer";

/** Minimal structural fake of the two client seams the composer uses. */
function fakeClient(options: {
  steer: (runId: string, text: string) => Promise<void>;
  submit: (text: string) => Promise<{ run: { runId: string } }>;
  input?: (sessionId: string, input: { text: string; attachments: readonly { attachmentId: string }[] }) => Promise<{ inputId: string }>;
}): GatewayClient {
  return {
    steerRun: options.steer,
    submitPrompt: options.submit,
    submitSessionInput: options.input,
  } as unknown as GatewayClient;
}

/** onSuccess must not run when the send failed (the draft is preserved). */
const draftClearingOnSuccess = (_result: { runId: string | null }): never => {
  throw new Error("onSuccess must not run when the send failed");
};

describe("retry shares the submit path (C10, AC10-3)", () => {
  test("a live session without a run sends text through session input, not a new run", async () => {
    const delivered: string[] = [];
    const client = fakeClient({
      steer: async () => { throw new Error("unexpected steer"); },
      submit: async () => { throw new Error("unexpected new run"); },
      input: async (sessionId, input) => {
        delivered.push(`${sessionId}:${input.text}:${input.attachments.length}`);
        return { inputId: "in_1" };
      },
    });
    const failures: string[] = [];
    await sendComposerText(client, {
      target: composerTarget({ running: true, runId: null, sessionId: "session-1" }),
      text: "hello",
      onSuccess: () => undefined,
      onFailure: (message) => failures.push(message),
    });
    expect(delivered).toEqual(["session-1:hello:0"]);
    expect(failures).toEqual([]);
  });

  test("session input refusal surfaces an error without clearing the draft", async () => {
    const failures: string[] = [];
    let cleared = false;
    const client = fakeClient({
      steer: async () => { throw new Error("unexpected steer"); },
      submit: async () => { throw new Error("unexpected new run"); },
      input: async () => { throw new Error("session_not_live"); },
    });
    await sendComposerText(client, {
      target: composerTarget({ running: false, runId: null, sessionId: "ended-session" }),
      text: "hello",
      onSuccess: () => { cleared = true; },
      onFailure: (message) => failures.push(message),
    });
    expect(cleared).toBe(false);
    expect(failures).toEqual(["session_not_live"]);
  });

  test("a correlated idle session sends text to that session instead of spawning a run", async () => {
    const delivered: string[] = [];
    const client = fakeClient({
      steer: async () => { throw new Error("unexpected steer"); },
      submit: async () => { throw new Error("unexpected new run"); },
      input: async (id) => { delivered.push(id); return { inputId: "in_2" }; },
    });
    await sendComposerText(client, {
      target: composerTarget({ running: false, runId: "run-1", sessionId: "session-1" }),
      text: "again",
      onSuccess: () => undefined,
      onFailure: () => undefined,
    });
    expect(delivered).toEqual(["session-1"]);
  });
  test("steer failure → onFailure once, onSuccess never (draft preserved); retry hits the same steer endpoint with the same text", async () => {
    const steerCalls: Array<[string, string]> = [];
    let failFirst = true;
    const client = fakeClient({
      steer: async (runId, text) => {
        steerCalls.push([runId, text]);
        if (failFirst) {
          failFirst = false;
          throw new Error("mailbox full");
        }
      },
      submit: async () => {
        throw new Error("prompt submit must not be called while running");
      },
    });

    void draftClearingOnSuccess;

    const failures: string[] = [];
    const successes: Array<{ runId: string | null }> = [];

    // First attempt (the press that failed).
    await sendComposerText(client, {
      target: composerTarget({ running: true, runId: "run-1" }),
      text: "keep going",
      onSuccess: (result) => successes.push(result),
      onFailure: (message) => failures.push(message),
    });
    expect(failures).toEqual(["mailbox full"]);
    expect(successes).toEqual([]);
    expect(steerCalls).toHaveLength(1);

    // Resend — same handler, same target routing, same preserved text.
    await sendComposerText(client, {
      target: composerTarget({ running: true, runId: "run-1" }),
      text: "keep going",
      onSuccess: (result) => successes.push(result),
      onFailure: (message) => failures.push(message),
    });
    expect(steerCalls).toEqual([
      ["run-1", "keep going"],
      ["run-1", "keep going"],
    ]);
    expect(successes).toEqual([{ runId: null }]);
    expect(failures).toHaveLength(1);
  });

  test("idle retry re-submits through the prompt endpoint (never the steer endpoint)", async () => {
    const submitCalls: string[] = [];
    const client = fakeClient({
      steer: async () => {
        throw new Error("steer must not be called while idle");
      },
      submit: async (text) => {
        submitCalls.push(text);
        return { run: { runId: "run-2" } };
      },
    });
    const successes: Array<{ runId: string | null }> = [];
    await sendComposerText(client, {
      target: composerTarget({ running: false, runId: null }),
      text: "run the tests",
      onSuccess: (result) => successes.push(result),
      onFailure: () => undefined,
    });
    expect(submitCalls).toEqual(["run the tests"]);
    expect(successes).toEqual([{ runId: "run-2" }]);
  });
});
