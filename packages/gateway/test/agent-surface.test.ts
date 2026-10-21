/**
 * Agent-session-file conversation adapter contract (agent-sessions.ts).
 * Fixtures are synthetic files in a fake HOME — no paid model calls, no
 * live agent CLIs. The contract: documented storage only (no screen
 * heuristics), identity-keyed wholesale turns, honest truncation, null for
 * every unusable source.
 */

import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";

import {
  claudeProjectDirName,
  resolveAgentConversation,
  type AgentConversation,
} from "../src/agent-sessions";

let home = "";

beforeEach(() => {
  home = mkdtempSync("/tmp/agent-sessions-test-");
});

afterEach(() => {
  home = "";
});

function resolve(kind: string, cwd: string): AgentConversation | null {
  return resolveAgentConversation(kind, cwd, { home });
}

// ——— claude ———

test("claude: newest project jsonl maps user/assistant/tool turns with result pairing", () => {
  const dir = join(home, ".claude", "projects", claudeProjectDirName("/Users/loopy/dev/ll3/loop"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "older.jsonl"),
    JSON.stringify({ type: "user", uuid: "u1", timestamp: "2026-10-20T00:00:00Z", message: { role: "user", content: "이전 세션" } }) + "\n",
  );
  const lines = [
    { type: "mode", mode: "normal" }, // meta line: skipped
    { type: "user", uuid: "u0", timestamp: "2026-10-21T01:00:00Z", isMeta: true, message: { role: "user", content: "command wrapper" } }, // skipped
    { type: "user", uuid: "u1", timestamp: "2026-10-21T01:00:01Z", message: { role: "user", content: "테스트 질문" } },
    {
      type: "assistant",
      uuid: "a1",
      timestamp: "2026-10-21T01:00:02Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "확인해볼게요." },
          { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
        ],
      },
    },
    {
      type: "user",
      uuid: "u2",
      timestamp: "2026-10-21T01:00:03Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file-a\nfile-b" }],
      },
    },
    {
      type: "assistant",
      uuid: "a2",
      timestamp: "2026-10-21T01:00:04Z",
      message: { role: "assistant", content: [{ type: "text", text: "완료입니다." }] },
    },
    { type: "user", uuid: "u3", isSidechain: true, message: { role: "user", content: "subagent" } }, // skipped
  ];
  const newer = join(dir, "newer.jsonl");
  writeFileSync(newer, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const later = new Date("2026-10-21T12:00:00Z");
  utimesSync(newer, later, later);

  const conversation = resolve("claude", "/Users/loopy/dev/ll3/loop");
  if (conversation === null || conversation.surface !== "turns") throw new Error("expected turns");
  expect(conversation.kind).toBe("claude");
  expect(conversation.truncated).toBe(false);
  const kinds = conversation.turns.map((turn) => turn.kind);
  expect(kinds).toEqual(["user", "assistant", "tool", "assistant"]);
  const tool = conversation.turns[2];
  if (tool === undefined || tool.kind !== "tool") throw new Error("expected tool turn");
  expect(tool.title).toBe("Bash");
  expect(tool.state).toBe("done");
  expect(tool.detail).toBe("file-a\nfile-b");
  expect(conversation.turns[0]?.kind).toBe("user");
  expect(conversation.turns[0] && conversation.turns[0].kind === "user" ? conversation.turns[0].text : null).toBe("테스트 질문");
});

test("claude: error tool_result folds to error state", () => {
  const dir = join(home, ".claude", "projects", claudeProjectDirName("/tmp/proj-a"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "s.jsonl"),
    [
      {
        type: "assistant",
        uuid: "a1",
        message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] },
      },
      {
        type: "user",
        uuid: "u1",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "file not found" }],
        },
      },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n",
  );
  const conversation = resolve("claude", "/tmp/proj-a");
  if (conversation === null || conversation.surface !== "turns") throw new Error("expected turns");
  const tool = conversation.turns[0];
  if (tool === undefined || tool.kind !== "tool") throw new Error("expected tool first");
  expect(tool.state).toBe("error");
});

test("claude: herdr's session id keys the pane's own file over the newest", () => {
  const dir = join(home, ".claude", "projects", claudeProjectDirName("/tmp/proj-s"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "newest.jsonl"), `${JSON.stringify({ type: "user", uuid: "u-n", message: { role: "user", content: "최신 파일" } })}\n`);
  writeFileSync(join(dir, "pinned.jsonl"), `${JSON.stringify({ type: "user", uuid: "u-p", message: { role: "user", content: "페인 고정 세션" } })}\n`);
  const later = new Date("2026-10-21T12:00:00Z");
  utimesSync(join(dir, "newest.jsonl"), later, later);

  const conversation = resolveAgentConversation("claude", "/tmp/proj-s", { home }, {
    kind: "id",
    value: "pinned",
  });
  if (conversation === null || conversation.surface !== "turns") throw new Error("expected turns");
  expect(conversation.source.endsWith("pinned.jsonl")).toBe(true);
  const first = conversation.turns[0];
  expect(first && first.kind === "user" ? first.text : null).toBe("페인 고정 세션");
});

test("claude: no project dir → null", () => {
  expect(resolve("claude", "/tmp/never existed")).toBeNull();
});

// ——— codex ———

function writeCodexRollout(homeDir: string, rel: string, cwd: string, items: unknown[]): string {
  const file = join(homeDir, ".codex", "sessions", rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    [
      JSON.stringify({
        timestamp: "2026-10-21T00:00:00Z",
        type: "session_meta",
        payload: { cwd },
      }),
      ...items.map((item) => JSON.stringify(item)),
    ].join("\n") + "\n",
  );
  return file;
}

test("codex: newest rollout whose session_meta cwd matches yields chat turns", () => {
  writeCodexRollout(home, "2026/10/20/rollout-a.jsonl", "/tmp/other", []);
  writeCodexRollout(home, "2026/10/21/rollout-b.jsonl", "/tmp/proj-codex", [
    {
      type: "response_item",
      timestamp: "2026-10-21T01:00:00Z",
      payload: { type: "message", id: "m1", role: "developer", content: [{ type: "input_text", text: "## Memory" }] },
    },
    {
      type: "response_item",
      timestamp: "2026-10-21T01:00:01Z",
      payload: {
        type: "message",
        id: "m2",
        role: "user",
        content: [{ type: "input_text", text: "<environment_context>\n<cwd>/tmp/proj-codex</cwd>" }],
      },
    },
    {
      type: "response_item",
      timestamp: "2026-10-21T01:00:02Z",
      payload: { type: "message", id: "m3", role: "user", content: [{ type: "input_text", text: "실행해줘" }] },
    },
    {
      type: "response_item",
      timestamp: "2026-10-21T01:00:03Z",
      payload: {
        type: "function_call",
        call_id: "call_1",
        name: "shell",
        arguments: JSON.stringify({ cmd: "bun test" }),
      },
    },
    {
      type: "response_item",
      timestamp: "2026-10-21T01:00:04Z",
      payload: { type: "function_call_output", call_id: "call_1", output: { is_error: false, content: "ok" } },
    },
    {
      type: "response_item",
      timestamp: "2026-10-21T01:00:05Z",
      payload: { type: "message", id: "m4", role: "assistant", content: [{ type: "output_text", text: "됐습니다" }] },
    },
    { type: "response_item", payload: { type: "reasoning", summary: [] } }, // skipped
  ]);

  const conversation = resolve("codex", "/tmp/proj-codex");
  if (conversation === null || conversation.surface !== "turns") throw new Error("expected turns");
  expect(conversation.kind).toBe("codex");
  expect(conversation.turns.map((turn) => turn.kind)).toEqual(["user", "tool", "assistant"]);
  const tool = conversation.turns[1];
  if (tool === undefined || tool.kind !== "tool") throw new Error("expected tool turn");
  expect(tool.title).toBe("shell");
  expect(tool.state).toBe("done");
  expect(tool.detail).toBe("ok");
  const user = conversation.turns[0];
  const reply = conversation.turns[2];
  expect(user && user.kind === "user" ? user.text : null).toBe("실행해줘");
  expect(reply && reply.kind === "assistant" ? reply.text : null).toBe("됐습니다");
});

test("codex: unmatched cwd across rollouts → null", () => {
  writeCodexRollout(home, "2026/10/21/rollout-c.jsonl", "/tmp/elsewhere", []);
  expect(resolve("codex", "/tmp/nothing")).toBeNull();
});

// ——— agy ———

test("agy: newest summary whose workspace matches yields a summary card", () => {
  mkdirSync(join(home, ".gemini", "antigravity-cli", "conversations"), { recursive: true });
  const db = new Database(join(home, ".gemini", "antigravity-cli", "conversation_summaries.db"), { create: true });
  db.run(
    "CREATE TABLE conversation_summaries (conversation_id text PRIMARY KEY, title text NOT NULL DEFAULT '', preview text NOT NULL DEFAULT '', step_count integer NOT NULL DEFAULT 0, last_modified_time datetime NOT NULL, workspace_uris text NOT NULL, status text NOT NULL DEFAULT '')",
  );
  db.run("INSERT INTO conversation_summaries VALUES ('c1','이전 작업','예전 미리보기',3,'2026-10-20 09:00:00','[\"file:///tmp/other\"]','CASCADE_RUN_STATUS_DONE')");
  db.run(
    "INSERT INTO conversation_summaries VALUES ('c2','QR 스캐너 정리','최근 미리보기',106,'2026-10-21 11:20:00','[\"file:///tmp/proj-agy\"]','CASCADE_RUN_STATUS_IDLE')",
  );
  db.close();

  const conversation = resolve("agy", "/tmp/proj-agy");
  if (conversation === null || conversation.surface !== "summary") throw new Error("expected summary");
  expect(conversation.kind).toBe("agy");
  expect(conversation.summary.title).toBe("QR 스캐너 정리");
  expect(conversation.summary.status).toBe("idle");
  expect(conversation.summary.stepCount).toBe(106);
  expect(conversation.summary.preview).toBe("최근 미리보기");
  expect(conversation.summary.modifiedAt).toBe("2026-10-21 11:20:00");
});

test("agy: no summaries db → null", () => {
  expect(resolve("agy", "/tmp/proj-agy")).toBeNull();
});

// ——— resolution edges ———

test("unsupported kind and empty cwd → null", () => {
  expect(resolve("pi", "/tmp/proj")).toBeNull();
  expect(resolve("claude", "")).toBeNull();
});
