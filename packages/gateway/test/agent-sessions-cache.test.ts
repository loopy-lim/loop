/**
 * Session parse cache (agent-sessions.ts) — the streamed-conversation
 * contract: an unchanged session file PARSES once (a hit returns the cached
 * payload without touching JSON again), an appended or rewritten one
 * re-parses (a tick never sees stale turns), and a missing one is null.
 * The injected parser counts invocations, so the hit is pinned at the
 * expensive step (parse), not the cheap one (read). Fixtures are synthetic
 * files — no paid model calls, no live agent CLIs.
 */

import { appendFileSync, mkdirSync, mkdtempSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
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

// ——— fallback floor (plan 2026-10-24 AC-1: no borrowing pre-birth sessions) ———

test("claude fallback floor: a file predating the pane birth is refused", () => {
  const home = dir;
  const project = join(home, ".claude", "projects", claudeProjectDirName("/w/floor"));
  mkdirSync(project, { recursive: true });
  const file = join(project, "old.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ type: "user", uuid: "u1", timestamp: "2026-10-01T00:00:00Z", message: { role: "user", content: "이전 세션" } })}\n`,
  );
  utimesSync(file, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  // No floor (pre-existing pane): the legacy fallback still serves.
  expect(resolveAgentConversation("claude", "/w/floor", { home })).not.toBeNull();
  // Floor before the last write: served.
  expect(
    resolveAgentConversation("claude", "/w/floor", { home }, null, Date.now() - 120_000),
  ).not.toBeNull();
  // Floor after the last write (fresh pane): the pre-birth session is refused.
  expect(resolveAgentConversation("claude", "/w/floor", { home }, null, Date.now())).toBeNull();
});

test("claude fallback floor: a record the pane wrote after birth is served", () => {
  const home = dir;
  const project = join(home, ".claude", "projects", claudeProjectDirName("/w/floor2"));
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, "new.jsonl"),
    `${JSON.stringify({ type: "user", uuid: "u1", timestamp: "2026-10-24T00:00:00Z", message: { role: "user", content: "새 기록" } })}\n`,
  );
  // mtime is now; the pane's agent "started" a minute ago.
  const served = resolveAgentConversation("claude", "/w/floor2", { home }, null, Date.now() - 60_000);
  expect(served).not.toBeNull();
  if (served === null || served.surface !== "turns") throw new Error("expected turns");
  expect(served.turns[0]).toMatchObject({ kind: "user", text: "새 기록" });
});

test("claude pinned session ignores the floor (the pane's own session)", () => {
  const home = dir;
  const project = join(home, ".claude", "projects", claudeProjectDirName("/w/pin"));
  mkdirSync(project, { recursive: true });
  const file = join(project, "sess-123.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ type: "user", uuid: "u1", timestamp: "2026-10-01T00:00:00Z", message: { role: "user", content: "이어받은 세션" } })}\n`,
  );
  utimesSync(file, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  const served = resolveAgentConversation(
    "claude",
    "/w/pin",
    { home },
    { kind: "id", value: "sess-123" },
    Date.now(),
  );
  expect(served).not.toBeNull();
});

test("codex fallback floor: a rollout predating the pane birth is skipped", () => {
  const home = dir;
  const day = join(home, ".codex", "sessions", "2026", "10", "24");
  mkdirSync(day, { recursive: true });
  const file = join(day, "rollout-old.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session_meta", payload: { cwd: "/w/codex" } })}\n${JSON.stringify({ type: "response_item", timestamp: "2026-10-01T00:00:00Z", payload: { type: "message", role: "user", content: [{ type: "text", text: "이전" }], id: "m1" } })}\n`,
  );
  utimesSync(file, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  // No floor: legacy behavior serves the cwd-matching rollout.
  expect(resolveAgentConversation("codex", "/w/codex", { home })).not.toBeNull();
  // Floor after the rollout's last write: refused.
  expect(resolveAgentConversation("codex", "/w/codex", { home }, null, Date.now())).toBeNull();
});
