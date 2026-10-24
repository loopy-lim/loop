/**
 * Agent-session-file conversation adapters — the structured read side of the
 * chat segment. The terminal mirror (pane.read) stays the universal fallback;
 * this module adds the agent CLIs' own on-disk session storage as a first
 * class data source, so the app can render a native conversation instead of
 * ANSI text when one exists.
 *
 * Single-file rule (the herdr-pane-source precedent): every agent CLI's
 * on-disk format knowledge lives here and only here — claude's project JSONL
 * (~/.claude/projects/<munged-cwd>/<session>.jsonl), codex's rollout JSONL
 * (~/.codex/sessions/Y/M/D/rollout-*.jsonl, cwd in session_meta), and agy's
 * transcripts (~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl)
 * with SQL summaries fallback (~/.gemini/antigravity-cli/conversation_summaries.db).
 * No screen-buffer heuristics: a turn exists only because the agent wrote
 * it to its own documented storage.
 *
 * Mapping discipline (the conversation decision D4 lineage):
 * - Turns are identity-keyed (agent-native message/call ids) and replace
 *   wholesale — the app never patches into a previous read.
 * - Unusable sources degrade to null (the route answers 404 and the app
 *   keeps the ANSI transcript); a partially readable file yields the turns
 *   it yielded, flagged `truncated` only by the turn budget, never silently.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { Database } from "bun:sqlite";

/** Kinds with a session-file adapter. The app may key quick UI on this. */
export const CONVERSATION_KINDS = ["claude", "codex", "agy"] as const;

/** Per-turn text budget (chars): a conversation is a summary view; the full
 * text lives in the agent's own file and the terminal mirror. */
const TURN_TEXT_CAP = 8_000;
const TOOL_DETAIL_CAP = 600;
/** Turn budget: only the most recent tail is returned (head is dropped). */
const TURN_BUDGET = 200;
/** codex resolver scan budget: newest-first, stop at the first cwd match. */
const CODEX_SCAN_BUDGET = 400;

/** Session parse-cache bound: entries (active sessions are few) and a rough
 * source-text byte budget across the cache, so pathological histories stay
 * bounded (FIFO eviction satisfies whichever bound trips first). */
const SESSION_CACHE_CAP = 64;
const SESSION_CACHE_BYTE_BUDGET = 64 * 1024 * 1024;

/**
 * Stat-validated parse cache for session files. The conversation route is
 * re-fetched on every streamed tick (the app's revision hook fires several
 * times a second while an agent works), so a steady session must not pay a
 * full re-read + re-parse per tick: a path is re-read and re-PARSED only
 * when its stat fingerprint (mtime ns + size) moved. Writes append → the
 * fingerprint moves → the next read reparses, so a tick never sees stale
 * turns. Cached payloads are shared read-only (the route only serializes
 * them), and parse failures (null) are cached too — a torn file is not
 * re-scanned per tick either. FIFO eviction over the entry cap and byte
 * budget; oversized parse results bypass the cache.
 */
export class SessionParseCache<T> {
  readonly #parse: (text: string) => T;
  readonly #entries = new Map<string, { mtimeNs: bigint; size: number; bytes: number; payload: T }>();
  #bytes = 0;

  constructor(parse: (text: string) => T) {
    this.#parse = parse;
  }

  /** Parsed payload for the file's current content, or null when unreadable
   * (the caller's null contract is unchanged). */
  read(file: string): { ok: true; payload: T } | { ok: false } {
    let stat: { mtimeNs: bigint; size: number };
    try {
      const raw = statSync(file, { bigint: true });
      stat = { mtimeNs: raw.mtimeNs, size: Number(raw.size) };
    } catch {
      this.#drop(file);
      return { ok: false };
    }
    const hit = this.#entries.get(file);
    if (hit !== undefined && hit.mtimeNs === stat.mtimeNs && hit.size === stat.size) {
      return { ok: true, payload: hit.payload };
    }
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      this.#drop(file);
      return { ok: false };
    }
    const payload = this.#parse(text);
    this.#drop(file);
    const bytes = text.length;
    if (bytes <= SESSION_CACHE_BYTE_BUDGET) {
      while (this.#entries.size > 0 &&
        (this.#entries.size >= SESSION_CACHE_CAP || this.#bytes + bytes > SESSION_CACHE_BYTE_BUDGET)
      ) {
        const oldest = this.#entries.keys().next();
        if (oldest.done === true) break;
        this.#drop(oldest.value);
      }
      this.#entries.set(file, { ...stat, bytes, payload });
      this.#bytes += bytes;
    }
    return { ok: true, payload };
  }

  #drop(file: string): void {
    const gone = this.#entries.get(file);
    if (gone !== undefined) {
      this.#bytes -= gone.bytes;
      this.#entries.delete(file);
    }
  }
}

/** Per-parse caches — the four session-file readers below each own one, so a
 * hit skips that reader's whole scan/JSON.parse, not just the file read. */
const claudeTurnsCache = new SessionParseCache(parseClaudeTurns);
const codexTurnsCache = new SessionParseCache(parseCodexTurns);
const codexCwdCache = new SessionParseCache(parseCodexSessionCwd);
const agyTurnsCache = new SessionParseCache(parseAgyTurns);

export type AgentConversationToolState = "running" | "done" | "error";

export type AgentConversationTurn =
  | { kind: "user"; id: string; text: string; at: string | null }
  | { kind: "assistant"; id: string; text: string; at: string | null }
  | {
      kind: "tool";
      id: string;
      title: string;
      detail: string | null;
      state: AgentConversationToolState;
      at: string | null;
    };

export type AgentConversationSummary = {
  title: string;
  /** herdr's five-state vocabulary where mappable, else the raw value. */
  status: string;
  stepCount: number;
  preview: string;
  modifiedAt: string | null;
};

export type AgentConversation =
  | { surface: "turns"; kind: string; source: string; turns: AgentConversationTurn[]; truncated: boolean }
  | { surface: "summary"; kind: "agy"; source: string; summary: AgentConversationSummary };

export type AgentConversationDeps = {
  /** Home directory override (tests); defaults to $HOME. */
  home?: string;
};

function homeDir(deps?: AgentConversationDeps): string | null {
  const home = deps?.home ?? process.env.HOME;
  return home !== undefined && home.length > 0 ? home : null;
}

/** Newest entries of a directory by mtime, names only (missing dir → []). */
function newestEntries(dir: string, suffix: string, cap: number): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(suffix))
    .map((name) => {
      try {
        return { name, at: statSync(join(dir, name)).mtimeMs };
      } catch {
        return { name, at: 0 };
      }
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, cap)
    .map((entry) => entry.name);
}

function capText(text: string, cap: number): string {
  return text.length > cap ? text.slice(-cap) : text;
}

function firstLineText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string"
      ) {
        parts.push((block as Record<string, unknown>).text as string);
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }
  return null;
}

// ——— claude (~/.claude/projects/<munged-cwd>/<session>.jsonl) ———

/** Claude Code's project-directory munging: every non-alphanumeric run in the
 * absolute cwd becomes `-` (`/Users/loopy/dev/ll3/loop` →
 * `-Users-loopy-dev-ll3-loop`). */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function claudeTurns(file: string): AgentConversationTurn[] | null {
  const read = claudeTurnsCache.read(file);
  return read.ok ? read.payload : null;
}

/** Line-parser for the claude session JSONL — cached; runs only when the
 * file's stat fingerprint moved. */
function parseClaudeTurns(text: string): AgentConversationTurn[] {
  type ToolTurn = Extract<AgentConversationTurn, { kind: "tool" }>;
  const tools = new Map<string, ToolTurn>();
  const turns: AgentConversationTurn[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // a torn tail line never takes the whole file down
    }
    const type = entry.type;
    if (type !== "user" && type !== "assistant") continue;
    if (entry.isSidechain === true || entry.isMeta === true) continue;
    const message = entry.message as Record<string, unknown> | undefined;
    if (typeof message !== "object" || message === null) continue;
    const at = typeof entry.timestamp === "string" ? entry.timestamp : null;
    const idBase = typeof entry.uuid === "string" ? entry.uuid : `${index}`;

    if (type === "user") {
      // tool_result blocks ride user lines: they close the matching tool call
      const blocks = Array.isArray(message.content) ? message.content : null;
      if (blocks !== null) {
        for (const block of blocks) {
          const b = block as Record<string, unknown>;
          if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") continue;
          const tool = tools.get(b.tool_use_id);
          if (tool === undefined) continue;
          tool.state = b.is_error === true ? "error" : "done";
          const out = firstLineText(b.content);
          if (out !== null) tool.detail = capText(out, TOOL_DETAIL_CAP);
        }
        const own = blocks
          .filter((b) => (b as Record<string, unknown>).type === "text")
          .map((b) => (b as Record<string, unknown>).text as string)
          .join("\n");
        if (own.trim().length > 0) {
          turns.push({ kind: "user", id: idBase, text: capText(own, TURN_TEXT_CAP), at });
        }
        continue;
      }
      const text = firstLineText(message.content);
      if (text === null || text.trim().length === 0) continue;
      turns.push({ kind: "user", id: idBase, text: capText(text, TURN_TEXT_CAP), at });
      continue;
    }

    // assistant: text blocks and tool_use blocks
    const blocks = Array.isArray(message.content) ? message.content : null;
    if (blocks === null) continue;
    for (const block of blocks) {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0) {
        turns.push({
          kind: "assistant",
          id: `${idBase}:t${turns.length}`,
          text: capText(b.text, TURN_TEXT_CAP),
          at,
        });
      } else if (b.type === "tool_use" && typeof b.id === "string") {
        const detail =
          b.input === undefined || b.input === null ? null : capText(JSON.stringify(b.input), TOOL_DETAIL_CAP);
        const tool: ToolTurn = {
          kind: "tool",
          id: b.id,
          title: typeof b.name === "string" ? b.name : "tool",
          detail,
          state: "running",
          at,
        };
        tools.set(b.id, tool);
        turns.push(tool);
      }
    }
  }
  return turns;
}

function claudeConversation(
  kind: string,
  cwd: string,
  home: string,
  session: AgentSessionRef | null,
): AgentConversation | null {
  const dir = join(home, ".claude", "projects", claudeProjectDirName(cwd));
  let source: string | null = null;
  if (session !== null && session.kind === "id") {
    source = claudeSessionById(home, cwd, session.value); // the pane's own session
  }
  if (source === null) {
    const newest = newestEntries(dir, ".jsonl", 1)[0];
    if (newest === undefined) return null;
    source = join(dir, newest);
  }
  const turns = claudeTurns(source);
  if (turns === null || turns.length === 0) return null;
  const truncated = turns.length > TURN_BUDGET;
  return {
    surface: "turns",
    kind,
    source,
    turns: truncated ? turns.slice(-TURN_BUDGET) : turns,
    truncated,
  };
}

// ——— codex (~/.codex/sessions/Y/M/D/rollout-*.jsonl, cwd in session_meta) ———

function newestCodexRollouts(home: string): string[] {
  const root = join(home, ".codex", "sessions");
  const out: Array<{ path: string; at: number }> = [];
  let years: string[];
  try {
    years = readdirSync(root);
  } catch {
    return [];
  }
  for (const year of years) {
    let months: string[];
    try {
      months = readdirSync(join(root, year));
    } catch {
      continue;
    }
    for (const month of months) {
      let days: string[];
      try {
        days = readdirSync(join(root, year, month));
      } catch {
        continue;
      }
      for (const day of days) {
        const dir = join(root, year, month, day);
        for (const name of newestEntries(dir, ".jsonl", 10_000)) {
          const path = join(dir, name);
          try {
            out.push({ path, at: statSync(path).mtimeMs });
          } catch {
            // raced an unlink: skip
          }
        }
      }
    }
  }
  return out
    .sort((a, b) => b.at - a.at)
    .slice(0, CODEX_SCAN_BUDGET)
    .map((entry) => entry.path);
}

function codexSessionCwd(file: string): string | null {
  const read = codexCwdCache.read(file);
  return read.ok ? read.payload : null;
}

/** Line-parser for codex's session_meta cwd — cached with the same stat
 * guard, so the up-to-400-candidate scan pays one cheap cached lookup per
 * steady file. */
function parseCodexSessionCwd(text: string): string | null {
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type !== "session_meta") continue;
    const payload = entry.payload as Record<string, unknown> | undefined;
    const cwd = payload?.cwd;
    return typeof cwd === "string" ? cwd : null;
  }
  return null;
}

function codexTurns(file: string): AgentConversationTurn[] | null {
  const read = codexTurnsCache.read(file);
  return read.ok ? read.payload : null;
}

/** Line-parser for codex rollout JSONL — cached like claude's. */
function parseCodexTurns(text: string): AgentConversationTurn[] {
  type ToolTurn = Extract<AgentConversationTurn, { kind: "tool" }>;
  const tools = new Map<string, ToolTurn>();
  const turns: AgentConversationTurn[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type !== "response_item") continue;
    const payload = entry.payload as Record<string, unknown> | undefined;
    if (typeof payload !== "object" || payload === null) continue;
    const at = typeof entry.timestamp === "string" ? entry.timestamp : null;
    const ptype = payload.type;

    if (ptype === "message") {
      const role = payload.role;
      if (role !== "user" && role !== "assistant") continue; // developer et al.
      const blocks = Array.isArray(payload.content) ? payload.content : null;
      if (blocks === null) continue;
      const texts: string[] = [];
      for (const block of blocks) {
        const b = block as Record<string, unknown>;
        if (typeof b.text === "string") texts.push(b.text);
      }
      const joined = texts.join("\n");
      if (role === "user") {
        // codex wraps its own scaffolding as user turns; they are not chat
        if (
          joined.startsWith("<environment_context>") ||
          joined.startsWith("<user_instructions>") ||
          joined.startsWith("<turn_aborted>") ||
          joined.trim().length === 0
        ) {
          continue;
        }
      }
      if (joined.trim().length === 0) continue;
      const id = typeof payload.id === "string" ? payload.id : `${turns.length}`;
      turns.push({
        kind: role === "user" ? "user" : "assistant",
        id,
        text: capText(joined, TURN_TEXT_CAP),
        at,
      });
      continue;
    }

    if (ptype === "function_call" || ptype === "custom_tool_call") {
      const callId = typeof payload.call_id === "string" ? payload.call_id : payload.id;
      if (typeof callId !== "string") continue;
      const raw =
        typeof payload.input === "string"
          ? payload.input
          : payload.arguments !== undefined
            ? JSON.stringify(payload.arguments)
            : null;
      const tool: ToolTurn = {
        kind: "tool",
        id: callId,
        title: typeof payload.name === "string" ? payload.name : "tool",
        detail: raw === null ? null : capText(raw, TOOL_DETAIL_CAP),
        state: "running",
        at,
      };
      tools.set(callId, tool);
      turns.push(tool);
      continue;
    }

    if (ptype === "function_call_output" || ptype === "custom_tool_call_output") {
      const callId = payload.call_id;
      if (typeof callId !== "string") continue;
      const tool = tools.get(callId);
      if (tool === undefined) continue;
      const out = payload.output;
      const failed =
        (typeof out === "object" && out !== null && (out as Record<string, unknown>).is_error === true) ||
        (typeof out === "object" && out !== null && (out as Record<string, unknown>).exit_code != null &&
          Number((out as Record<string, unknown>).exit_code) !== 0);
      tool.state = failed ? "error" : "done";
      const outText =
        typeof out === "string"
          ? out
          : typeof out === "object" && out !== null
            ? firstLineText((out as Record<string, unknown>).content ?? out)
            : null;
      if (outText !== null) tool.detail = capText(outText, TOOL_DETAIL_CAP);
      continue;
    }
  }
  return turns;
}

function codexConversation(
  kind: string,
  cwd: string,
  home: string,
  session: AgentSessionRef | null,
): AgentConversation | null {
  const rollouts = newestCodexRollouts(home);
  // herdr's codex integration reports the session id; rollout filenames end
  // with it, so the pane's own file matches deterministically.
  const named =
    session !== null && session.kind === "id"
      ? rollouts.find((file) => file.includes(session.value))
      : undefined;
  for (const file of named !== undefined ? [named] : rollouts) {
    if (named === undefined && codexSessionCwd(file) !== cwd) continue;
    const turns = codexTurns(file);
    if (turns === null || turns.length === 0) continue;
    const truncated = turns.length > TURN_BUDGET;
    return {
      surface: "turns",
      kind,
      source: file,
      turns: truncated ? turns.slice(-TURN_BUDGET) : turns,
      truncated,
    };
  }
  return null;
}

// ——— agy (~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl) ———

/** Strips internal <USER_REQUEST> framing so the user bubble shows clean text. */
export function cleanUserText(text: string): string {
  const match = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/.exec(text);
  if (match && match[1]) {
    return match[1].trim();
  }
  return text.trim();
}

/** Parses Antigravity (~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl)
 * into structured turns (user prompt, assistant response, and tool calls/results). */
export function agyTurns(file: string): AgentConversationTurn[] | null {
  const read = agyTurnsCache.read(file);
  return read.ok ? read.payload : null;
}

/** Line-parser for the agy transcript JSONL — cached like claude's. */
function parseAgyTurns(text: string): AgentConversationTurn[] {
  type ToolTurn = Extract<AgentConversationTurn, { kind: "tool" }>;
  const turns: AgentConversationTurn[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.length === 0) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const stepIndex = entry.step_index !== undefined ? String(entry.step_index) : `${turns.length}`;
    const at = typeof entry.created_at === "string" ? entry.created_at : null;
    const type = entry.type;

    if (type === "USER_INPUT") {
      const raw = typeof entry.content === "string" ? entry.content : "";
      const text = cleanUserText(raw);
      if (text.length > 0) {
        turns.push({
          kind: "user",
          id: `u_${stepIndex}`,
          text: capText(text, TURN_TEXT_CAP),
          at,
        });
      }
      continue;
    }

    if (type === "PLANNER_RESPONSE") {
      // 1. Text content from assistant
      if (typeof entry.content === "string" && entry.content.trim().length > 0) {
        turns.push({
          kind: "assistant",
          id: `a_${stepIndex}`,
          text: capText(entry.content, TURN_TEXT_CAP),
          at,
        });
      }
      // 2. Tool calls
      if (Array.isArray(entry.tool_calls)) {
        for (const [callIdx, call] of entry.tool_calls.entries()) {
          const c = call as Record<string, unknown>;
          const name = typeof c.name === "string" ? c.name : "tool";
          const toolId = `t_${stepIndex}_${callIdx}`;
          let detail: string | null = null;
          if (c.args !== undefined && c.args !== null) {
            detail = typeof c.args === "string" ? c.args : JSON.stringify(c.args);
          }
          const toolTurn: ToolTurn = {
            kind: "tool",
            id: toolId,
            title: name,
            detail: detail !== null ? capText(detail, TOOL_DETAIL_CAP) : null,
            state: "running",
            at,
          };
          turns.push(toolTurn);
        }
      }
      continue;
    }

    if (type === "GENERIC" && entry.source === "MODEL") {
      // Tool execution result following tool calls:
      const runningTools = turns.filter((t): t is ToolTurn => t.kind === "tool" && t.state === "running");
      const lastTool = runningTools[runningTools.length - 1];
      if (lastTool !== undefined) {
        const isError = entry.status === "ERROR";
        lastTool.state = isError ? "error" : "done";
        if (typeof entry.content === "string" && entry.content.trim().length > 0) {
          lastTool.detail = capText(entry.content, TOOL_DETAIL_CAP);
        }
      }
      continue;
    }
  }
  return turns;
}

function agyConversation(
  kind: "agy",
  cwd: string,
  home: string,
  session: AgentSessionRef | null,
): AgentConversation | null {
  // 1. Try explicit session id if provided
  if (session !== null && session.kind === "id") {
    const transcriptFile = join(
      home,
      ".gemini",
      "antigravity-cli",
      "brain",
      session.value,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );
    const turns = agyTurns(transcriptFile);
    if (turns !== null && turns.length > 0) {
      const truncated = turns.length > TURN_BUDGET;
      return {
        surface: "turns",
        kind,
        source: transcriptFile,
        turns: truncated ? turns.slice(-TURN_BUDGET) : turns,
        truncated,
      };
    }
  }

  // 2. Look up conversation_summaries.db by workspace cwd
  const dbPath = join(home, ".gemini", "antigravity-cli", "conversation_summaries.db");
  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true, create: false });
  } catch {
    return null;
  }
  try {
    const rows = db
      .query(
        "SELECT conversation_id, title, status, step_count, preview, workspace_uris, last_modified_time " +
          "FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 400",
      )
      .all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      let workspaces: string[] = [];
      try {
        const parsed = JSON.parse(String(row.workspace_uris ?? "[]")) as string[];
        workspaces = parsed.map((uri) => uri.replace(/^file:\/\//, ""));
      } catch {
        continue;
      }
      if (!workspaces.includes(cwd)) continue;

      // If conversation_id has a transcript file, prefer structured turns
      const convId = String(row.conversation_id ?? "");
      if (convId.length > 0) {
        const transcriptFile = join(
          home,
          ".gemini",
          "antigravity-cli",
          "brain",
          convId,
          ".system_generated",
          "logs",
          "transcript.jsonl",
        );
        const turns = agyTurns(transcriptFile);
        if (turns !== null && turns.length > 0) {
          const truncated = turns.length > TURN_BUDGET;
          return {
            surface: "turns",
            kind,
            source: transcriptFile,
            turns: truncated ? turns.slice(-TURN_BUDGET) : turns,
            truncated,
          };
        }
      }

      // Fall back to documented SQL summary when transcript is absent
      const rawStatus = String(row.status ?? "");
      const status = rawStatus.startsWith("CASCADE_RUN_STATUS_")
        ? rawStatus.slice("CASCADE_RUN_STATUS_".length).toLowerCase()
        : rawStatus.toLowerCase();
      return {
        surface: "summary",
        kind,
        source: dbPath,
        summary: {
          title: String(row.title ?? ""),
          status: status.length > 0 ? status : "unknown",
          stepCount: Number(row.step_count ?? 0),
          preview: capText(String(row.preview ?? ""), TURN_TEXT_CAP),
          modifiedAt: row.last_modified_time == null ? null : String(row.last_modified_time),
        },
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

// ——— resolution ———

/** herdr's agent_session record (the integration-reported session identity:
 * kind "id"|"path", opaque value). When present it keys the session file
 * deterministically; cwd+mtime stays the fallback. */
export type AgentSessionRef = { kind: string; value: string };

/** Resolve the newest structured conversation for a herdr pane. Returns null
 * when the kind has no adapter or no usable source — the caller answers 404
 * and the app keeps its ANSI transcript. */
export function resolveAgentConversation(
  kind: string,
  cwd: string,
  deps?: AgentConversationDeps,
  session?: AgentSessionRef | null,
): AgentConversation | null {
  const home = homeDir(deps);
  if (home === null || cwd.length === 0) return null;
  if (kind === "claude") return claudeConversation(kind, cwd, home, session ?? null);
  if (kind === "codex") return codexConversation(kind, cwd, home, session ?? null);
  if (kind === "agy") return agyConversation("agy", cwd, home, session ?? null);
  return null;
}

/** A readable claude session file for an explicit session id, else null. */
function claudeSessionById(home: string, cwd: string, sessionId: string): string | null {
  const file = join(home, ".claude", "projects", claudeProjectDirName(cwd), `${sessionId}.jsonl`);
  try {
    statSync(file);
    return file;
  } catch {
    return null;
  }
}
