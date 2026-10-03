/**
 * GUI-conversation architecture gates (decision 2026-xx-gui-conversation §4,
 * M-GC0/M-GC1). These complement the repo-wide architecture suite (tests/ is
 * outside this task's write scope) with the session-family invariants:
 *
 * 1. The session/conversation concept never enters loop-core (Rust) — the
 *    M-GC0 identifier gate (`RemoteSession*`, `Conversation*` frame names)
 *    stays at zero hits in crates/loop-core/src.
 * 2. The gateway consumes the generated protocol types only — no hand-written
 *    TypeScript copy of a Rust conversation frame (AGENTS.md).
 */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

function repoPath(...segments: string[]): string {
  return join(root, ...segments);
}

function rustFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...rustFiles(path));
    else out.push(path);
  }
  return out;
}

function tsFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

const CONVERSATION_IDENTIFIERS =
  /RemoteSession|Conversation(UserMessage|AssistantDelta|AssistantMessage|ToolCall|Lifecycle|SteerQueued)/;

/** The exact Rust bridge type names; a local `export type <name> = …` in the
 * gateway would be a hand-written TS copy (AGENTS.md violation). */
const FRAME_TYPE_NAMES =
  "ConversationUserMessage|ConversationUserMessageSource|ConversationAssistantDelta|ConversationAssistantMessage|ConversationToolCallStarted|ConversationToolCallEnded|ConversationLifecycle|ConversationLifecyclePhase|ConversationSteerQueued|RemoteSessionResetEvent|RemoteSessionResetReason|RemoteSessionSummary|RemoteSessionListOutput|RemoteSessionState|RemoteSessionAssetRef";

test("the session/conversation concept never enters loop-core (M-GC0 gate)", () => {
  const hits: string[] = [];
  for (const file of rustFiles(repoPath("crates/loop-core/src"))) {
    // Code-level gate: prose in `///` doc comments may name the boundary it
    // explains; declarations, fields, and strings may not contain the concept.
    const code = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    if (CONVERSATION_IDENTIFIERS.test(code)) hits.push(file);
  }
  expect(hits).toEqual([]);
});

test("the gateway declares no conversation frame shapes; it consumes generated types only", () => {
  const gatewaySources = tsFiles(repoPath("packages/gateway/src"));
  const declaration = new RegExp(`export (?:type|interface) (?:${FRAME_TYPE_NAMES})\\b`);
  const offenders = gatewaySources.filter((file) => declaration.test(readFileSync(file, "utf8")));
  expect(offenders).toEqual([]);

  // The collector must actually speak the generated vocabulary (the payload
  // registry is the single source of frame shapes).
  const collector = readFileSync(repoPath("packages/gateway/src/session-collector.ts"), "utf8");
  expect(collector).toContain('RustraEventPayloads["loop.');
});
