/**
 * Waiting-for-session composer contract (task `conversation-safearea-fix`):
 * while a run's session is not observed yet, the conversation surface must
 * NOT route a send to a brand-new run — that reads as a silent failure (the
 * draft vanishes and the app navigates away). Instead the composer's send
 * control is locked and the waiting notice above the timeline explains the
 * state in plain language. The lock lifts the moment the session appears.
 * Machine-pinned by source inspection (react-native does not load under the
 * test runtime, same rule as every other suite here).
 *
 * Gates:
 * 1. Send lock: ConversationScreen passes `sendLocked={sessionId === null}`
 *    to the Composer, the Composer folds it into its disabled state, and
 *    the screen's submit handler refuses to run while the session is
 *    unobserved (defense in depth — the control lock is not the only gate).
 * 2. Plain-language copy: the user-facing notices never carry internal
 *    vocabulary ("inventory", "observed"); the waiting notice states what
 *    is happening and when sending unlocks.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mobileRoot = join(import.meta.dir, "..");
const conversationSource = readFileSync(
  join(mobileRoot, "src/screens/ConversationScreen.tsx"),
  "utf8",
);
const composerSource = readFileSync(join(mobileRoot, "src/features/composer.tsx"), "utf8");
const copySource = readFileSync(join(mobileRoot, "src/ui/copy.ts"), "utf8");

describe("send lock while the run's session is unobserved", () => {
  test("the conversation locks the composer send exactly while sessionId is null", () => {
    expect(conversationSource).toContain("sendLocked={sessionId === null}");
  });

  test("the composer folds the lock into its disabled state", () => {
    expect(composerSource).toContain("props.sendLocked === true");
    expect(composerSource).toMatch(
      /const disabled = props\.busy \|\| empty \|\| props\.sendLocked === true;/,
    );
  });

  test("the screen's submit handler refuses to run without a session (defense in depth)", () => {
    // the guard sits after the busy check, before any routing/attachment work
    const submitAt = conversationSource.indexOf("const submit = () => {");
    const guardAt = conversationSource.indexOf("if (sessionId === null) return;", submitAt);
    const attachmentsAt = conversationSource.indexOf(
      "if (pendingAttachmentsRef.current.length > 0)",
      submitAt,
    );
    expect(submitAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(submitAt);
    expect(attachmentsAt).toBeGreaterThan(guardAt);
  });

  test("the old silent new-run routing is gone from the waiting path", () => {
    // composerTarget may only be consulted with an observed view; the
    // waiting state can never reach sendText
    expect(conversationSource).toContain("if (sessionId === null) return;");
  });
});

describe("plain-language copy — no internal vocabulary reaches the user", () => {
  test("the waiting notice names the state and the unlock, no jargon", () => {
    expect(copySource).toContain("export const WAITING_FOR_SESSION_NOTICE");
    expect(copySource).not.toContain("WAITING_FOR_INVENTORY_NOTICE");
    expect(copySource).toMatch(/WAITING_FOR_SESSION_NOTICE\s*=\s*"Connecting to this task's session/);
    expect(copySource).toMatch(/you can send once it appears/);
  });

  test("no user-facing copy mentions the inventory", () => {
    // string literals only — comments may discuss internals freely
    const literals = [...copySource.matchAll(/"([^"\n]*)"/g)].map((m) => m[1] ?? "");
    expect(literals.length).toBeGreaterThan(10);
    for (const literal of literals) {
      expect(literal.toLowerCase()).not.toContain("inventory");
    }
    expect(conversationSource).not.toContain("inventory…");
  });

  test("the conversation renders the waiting notice while the session is unobserved", () => {
    expect(conversationSource).toContain("WAITING_FOR_SESSION_NOTICE");
    expect(conversationSource).toMatch(
      /sessionId === null\)\s*\n\s*notices\.push\(\{ key: "waiting", text: WAITING_FOR_SESSION_NOTICE/,
    );
  });
});
