/**
 * Session parse cache (agent-sessions.ts) — the streamed-conversation
 * contract: an unchanged session file PARSES once (a hit returns the cached
 * payload without touching JSON again), an appended or rewritten one
 * re-parses (a tick never sees stale turns), and a missing one is null.
 * The injected parser counts invocations, so the hit is pinned at the
 * expensive step (parse), not the cheap one (read). Fixtures are synthetic
 * files — no paid model calls, no live agent CLIs.
 */

import { appendFileSync, mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";

import {
  SessionParseCache,
  claudeProjectDirName,
  resolveAgentConversation,
} from "../src/agent-sessions";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync("/tmp/agent-sessions-cache-test-");
});

afterEach(() => {
  dir = "";
});

function countingParseCache<T>(parse: (text: string) => T): {
  cache: SessionParseCache<T>;
  parses: () => number;
} {
  let parses = 0;
  const cache = new SessionParseCache((text: string) => {
    parses += 1;
    return parse(text);
  });
  return { cache, parses: () => parses };
}

test("parse cache: unchanged file parses once, appended file re-parses", async () => {
  const { cache, parses } = countingParseCache((text: string) => text.split("\n").length - 1);
  const file = join(dir, "session.jsonl");
  writeFileSync(file, "a\n");
  expect(cache.read(file)).toEqual({ ok: true, payload: 1 });
  expect(cache.read(file)).toEqual({ ok: true, payload: 1 });
  expect(parses()).toBe(1); // second call was a fingerprint hit — no re-parse
  await Bun.sleep(5); // separate mtimes: a same-ms write can be indistinguishable on coarse clocks
  appendFileSync(file, "b\n");
  expect(cache.read(file)).toEqual({ ok: true, payload: 2 });
  expect(parses()).toBe(2);
  expect(cache.read(file)).toEqual({ ok: true, payload: 2 });
  expect(parses()).toBe(2);
});

test("parse cache: same-size rewrite is not served stale", async () => {
  const { cache, parses } = countingParseCache((text: string) => text.trim());
  const file = join(dir, "session.jsonl");
  writeFileSync(file, "aaaa");
  expect(cache.read(file)).toEqual({ ok: true, payload: "aaaa" });
  await Bun.sleep(5);
  writeFileSync(file, "bbbb"); // same size, moved mtime
  expect(cache.read(file)).toEqual({ ok: true, payload: "bbbb" });
  expect(parses()).toBe(2);
});

test("parse cache: missing file is null, recreation and deletion converge", () => {
  const { cache, parses } = countingParseCache((text: string) => text);
  const file = join(dir, "session.jsonl");
  expect(cache.read(file)).toEqual({ ok: false });
  writeFileSync(file, "x\n");
  expect(cache.read(file)).toEqual({ ok: true, payload: "x\n" });
  unlinkSync(file);
  expect(cache.read(file)).toEqual({ ok: false });
  expect(parses()).toBe(1);
});

test("parse cache: eviction keeps the resident set at the cap", () => {
  const { cache, parses } = countingParseCache((text: string) => text.trim());
  const files: string[] = [];
  for (let index = 0; index < 66; index += 1) {
    const file = join(dir, `s${index}.jsonl`);
    writeFileSync(file, String(index));
    files.push(file);
    cache.read(file);
  }
  const afterFill = parses();
  // The first file fell out of the 64-entry FIFO — its next read re-parses.
  expect(cache.read(files[0]!)).toEqual({ ok: true, payload: "0" });
  expect(parses()).toBe(afterFill + 1);
  // The newest file is still cached.
  expect(cache.read(files[65]!)).toEqual({ ok: true, payload: "65" });
  expect(parses()).toBe(afterFill + 1);
});

test("resolveAgentConversation reflects appended turns across calls (route-level no-stale)", async () => {
  const home = dir;
  const project = join(home, ".claude", "projects", claudeProjectDirName("/w/cache"));
  mkdirSync(project, { recursive: true });
  const file = join(project, "s.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ type: "user", uuid: "u1", timestamp: "2026-10-22T00:00:00Z", message: { role: "user", content: "첫 질문" } })}\n`,
  );
  const first = resolveAgentConversation("claude", "/w/cache", { home });
  if (first === null || first.surface !== "turns") throw new Error("expected turns");
  expect(first.turns.length).toBe(1);
  await Bun.sleep(5);
  appendFileSync(
    file,
    `${JSON.stringify({ type: "assistant", uuid: "a1", timestamp: "2026-10-22T00:00:01Z", message: { role: "assistant", content: [{ type: "text", text: "답변" }] } })}\n`,
  );
  const second = resolveAgentConversation("claude", "/w/cache", { home });
  if (second === null || second.surface !== "turns") throw new Error("expected turns");
  expect(second.turns.length).toBe(2);
  expect(second.turns[1]).toMatchObject({ kind: "assistant", text: "답변" });
});
