/**
 * Demo gateway for simulator showcase v5 (task `ui-codex-redesign`).
 *
 * A local, fake-data gateway that speaks just enough of the real wire
 * contract (ADR §4 + decision 2026-xx-gui-conversation D2) to drive the app
 * UI for screenshots: runs list, sessions inventory, the three SSE stream
 * families, and the steer endpoint (accepts, mirrors `steer_queued`, then
 * folds it with an in-session `user_message source=steer`).
 *
 * Evidence rules honored here (docs/research/simulator-showcase conventions):
 * - ALL data is fake and clearly named `demo-*`; no model calls, no paid
 *   APIs, no real worker. Captures made against this server must be labeled
 *   "fake demo data".
 * - Bearer token is the constant `demo-token` — not a credential; nothing
 *   is persisted or logged.
 * - Loopback bind only (127.0.0.1); the iOS simulator reaches it directly.
 *
 * Usage: bun apps/loop-mobile/scripts/demo-gateway.ts [port]
 */

import { deflateSync } from "node:zlib";

const TOKEN = "demo-token";
const PORT = Number(process.argv[2] ?? "18499");
// Optional `--max-runs=N`: serve only the first N runs so the chats list's
// SESSIONS section fits the first screenful in captures (default: all —
// prior showcase evidence replays unchanged).
const MAX_RUNS: number | null = (() => {
  const flag = process.argv.find((arg) => arg.startsWith("--max-runs="));
  if (flag === undefined) return null;
  const n = Number(flag.slice("--max-runs=".length));
  return Number.isFinite(n) && n >= 0 ? n : null;
})();

// ── v7 attachment demo (task showcase-v7, decision 2026-xx-gui-conversation
// D5): one session whose user input carries an inline image ref and a file
// card ref. Both bodies are generated locally in this file (a deterministic
// PNG drawn in code — no external asset, no network fetch) and served at
// GET /v1/sessions/{id}/attachments/{id} like the real gateway's M2 route.
const ASSETS_RUN_ID = "run_demo_assets_0004";
const ASSETS_SESSION_ID = "sess_demo_assets_0004";
const IMAGE_ATTACHMENT_ID = "att_demo_capture_0001";
const IMAGE_ATTACHMENT_ID_2 = "att_demo_capture_0002";
const FILE_ATTACHMENT_ID = "att_demo_notes_0002";

// v9 attach demo (task showcase-v9): the live session whose composer the
// scripted attach-send rides (below, plus the POST routes that mirror the
// real gateway's M2 upload + input contract).
const V9_RUN_ID = "run_demo_v9_0008";
const V9_SESSION_ID = "sess_demo_v9_0008";

/** Minimal deterministic PNG encoder (RGB, no interlace) — locally generated
 * demo art with zero external dependencies or fetched bytes. */
function pngChunk(tag: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(Buffer.from(tag, "ascii"), 4);
  out.set(data, 8);
  new DataView(out.buffer).setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Draw the demo image: a Loop-colored deterministic gradient field with
 * three accent bars (no text rendering — fonts are a native concern).
 * `accent`/`flip` vary the art so two attached thumbnails are visually
 * distinct without any external asset. */
function renderDemoPng(opts?: { accent?: [number, number, number]; flip?: boolean }): Uint8Array {
  const [accentR, accentG, accentB] = opts?.accent ?? [88, 166, 255];
  const flip = opts?.flip === true;
  const width = 480;
  const height = 300;
  const raw = Buffer.alloc(height * (1 + width * 3));
  let at = 0;
  for (let y = 0; y < height; y++) {
    raw[at++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const px = flip ? width - 1 - x : x;
      const py = flip ? height - 1 - y : y;
      const bar = Math.floor((px * 3) / width); // three vertical accent bands
      const inBand = py > 40 + bar * 12 && py < 96 + bar * 12 && px % 160 > bar * 24;
      raw[at++] = inBand ? accentR : Math.round(24 + (166 * py) / height); // R
      raw[at++] = inBand ? accentG : Math.round(230 - (130 * px) / width); // G
      raw[at++] = inBand ? accentB : Math.round(245 - (120 * py) / height); // B
    }
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const idat = deflateSync(raw); // local bytes only
  const png = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  return Buffer.concat(png.map((part) => new Uint8Array(part.buffer, part.byteOffset, part.byteLength)));
}

const DEMO_IMAGE_BYTES = renderDemoPng();
const DEMO_FILE_BYTES = Buffer.from(
  ["# Demo attachment notes", "", "- locally generated text body (showcase v7)", "- rendered as a metadata-only file card (decision D5)", ""].join("\n"),
  "utf8",
);
const demoAttachmentBodies = new Map<string, { mimeType: string; bytes: Uint8Array }>([
  [IMAGE_ATTACHMENT_ID, { mimeType: "image/png", bytes: DEMO_IMAGE_BYTES }],
  [IMAGE_ATTACHMENT_ID_2, { mimeType: "image/png", bytes: renderDemoPng({ accent: [255, 159, 88], flip: true }) }],
  [FILE_ATTACHMENT_ID, { mimeType: "text/markdown", bytes: DEMO_FILE_BYTES }],
]);

const now = () => new Date().toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

// v8 detail checklist (task showcase-v8, decision 2026-xx-codex-detail-
// checklist C6/C8): wall-clock stamps relative to the capture day, so the
// multi-day scripts always straddle TODAY's local midnight — the rendered
// date header sits exactly where the checklist needs it regardless of when
// the operator reruns this.
const dayAt = (dayOffset: number, hour: number, minute: number) => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};
const yesterdayAt = (hour: number, minute: number) => dayAt(-1, hour, minute);
const todayAt = (hour: number, minute: number) => dayAt(0, hour, minute);

const RUNNING_RUN_ID = "run_demo_running_0001";
const DONE_RUN_ID = "run_demo_done_0002";
const OLD_RUN_ID = "run_demo_done_0003";
const RUNNING_SESSION_ID = "sess_demo_running_0001";
const DONE_SESSION_ID = "sess_demo_done_0002";
const ORPHAN_SESSION_ID = "sess_demo_orphan_0003";
const EMPTY_SESSION_ID = "sess_demo_empty_0009";

// v8 sessions (task showcase-v8): one short ended markdown/code session
// (C1/C2), one live session that opens with an expanded running tool card
// and starts a fresh turn a few seconds later (C3/C4/C7 typing indicator),
// one long two-day history session for the jump-pill scroll-up (C6/C8/C11).
const DETAILS_RUN_ID = "run_demo_details_0005";
const DETAILS_SESSION_ID = "sess_demo_details_0005";
const LIVE_RUN_ID = "run_demo_live_0006";
const LIVE_SESSION_ID = "sess_demo_live_0006";
const HISTORY_RUN_ID = "run_demo_history_0007";
const HISTORY_SESSION_ID = "sess_demo_history_0007";

type Frame = { id: string; event: string; payload: unknown };

function sseFrame(frame: Frame): string {
  return `id: ${frame.id}\nevent: ${frame.event}\ndata: ${JSON.stringify(frame.payload)}\n\n`;
}

const KEEPALIVE = ": keepalive\n\n";

// ── Recorded conversation: a completed run (tool cards done + error, steer
// delivered) — the same story the unit-test fixtures tell, retold with
// demo ids so screenshots show a rich, honest timeline.
const doneFrames: Frame[] = [
  { id: "d-1", event: "lifecycle", payload: { phase: "sessionStarted", occurredAt: minutesAgo(42) } },
  {
    id: "d-2",
    event: "user_message",
    payload: {
      messageId: "dm-1",
      text: "Fix the flaky gateway test",
      source: "interactive",
      imageCount: 0,
      attachments: [],
      occurredAt: minutesAgo(42),
    },
  },
  { id: "d-3", event: "lifecycle", payload: { phase: "turnStarted", occurredAt: minutesAgo(41) } },
  {
    id: "d-4",
    event: "assistant_delta",
    payload: { messageId: "da-1", delta: "I'll check the test first.", occurredAt: minutesAgo(41) },
  },
  {
    id: "d-5",
    event: "assistant_message",
    payload: {
      messageId: "da-1",
      text: "I'll check the test first, then fix the flake.",
      truncated: false,
      occurredAt: minutesAgo(40),
    },
  },
  {
    id: "d-6",
    event: "tool_call_started",
    payload: {
      toolCallId: "dt-1",
      toolName: "read",
      argsJson: '{"path":"packages/gateway/src/server.ts"}',
      argsTruncated: false,
      occurredAt: minutesAgo(40),
    },
  },
  {
    id: "d-7",
    event: "tool_call_ended",
    payload: {
      toolCallId: "dt-1",
      resultText: "export function handle(…) { … }",
      resultTruncated: false,
      isError: false,
      occurredAt: minutesAgo(39),
    },
  },
  {
    id: "d-8",
    event: "tool_call_started",
    payload: {
      toolCallId: "dt-2",
      toolName: "bash",
      argsJson: '{"cmd":"bun test packages/gateway"}',
      argsTruncated: false,
      occurredAt: minutesAgo(39),
    },
  },
  {
    id: "d-9",
    event: "tool_call_ended",
    payload: {
      toolCallId: "dt-2",
      resultText: "exit code 1 — 1 test failed",
      resultTruncated: false,
      isError: true,
      occurredAt: minutesAgo(38),
    },
  },
  { id: "d-10", event: "lifecycle", payload: { phase: "turnEnded", occurredAt: minutesAgo(38) } },
  {
    id: "d-11",
    event: "steer_queued",
    payload: {
      steerId: "dst-1",
      text: "also check the sse parser",
      runId: DONE_RUN_ID,
      occurredAt: minutesAgo(37),
    },
  },
  { id: "d-12", event: "lifecycle", payload: { phase: "turnStarted", occurredAt: minutesAgo(37) } },
  {
    id: "d-13",
    event: "user_message",
    payload: {
      messageId: "dm-2",
      text: "also check the sse parser",
      source: "steer",
      imageCount: 0,
      attachments: [],
      occurredAt: minutesAgo(37),
    },
  },
  {
    id: "d-14",
    event: "assistant_message",
    payload: {
      messageId: "da-2",
      text: "Steered — the sse parser is covered now.",
      truncated: false,
      occurredAt: minutesAgo(36),
    },
  },
  { id: "d-15", event: "lifecycle", payload: { phase: "turnEnded", occurredAt: minutesAgo(36) } },
  { id: "d-16", event: "lifecycle", payload: { phase: "sessionEnded", occurredAt: minutesAgo(35) } },
];

// ── Live conversation: a running turn whose last tool call is still open —
// the state the v5 screenshots need (running badge, open card, steer path).
const runningFrames: Frame[] = [
  { id: "r-1", event: "lifecycle", payload: { phase: "sessionStarted", occurredAt: minutesAgo(6) } },
  {
    id: "r-2",
    event: "user_message",
    payload: {
      messageId: "rm-1",
      text: "Refactor the SSE backpressure path in the gateway",
      source: "interactive",
      imageCount: 0,
      attachments: [],
      occurredAt: minutesAgo(6),
    },
  },
  { id: "r-3", event: "lifecycle", payload: { phase: "turnStarted", occurredAt: minutesAgo(5) } },
  {
    id: "r-4",
    event: "assistant_delta",
    payload: { messageId: "ra-1", delta: "Reading the pane event log first.", occurredAt: minutesAgo(5) },
  },
  {
    id: "r-5",
    event: "assistant_message",
    payload: {
      messageId: "ra-1",
      text: "Reading the pane event log first, then I'll rework the bounded sender.",
      truncated: false,
      occurredAt: minutesAgo(5),
    },
  },
  {
    id: "r-6",
    event: "tool_call_started",
    payload: {
      toolCallId: "rt-1",
      toolName: "read",
      argsJson: '{"path":"crates/loop-bridge/src/pane.rs"}',
      argsTruncated: false,
      occurredAt: minutesAgo(4),
    },
  },
  {
    id: "r-7",
    event: "tool_call_ended",
    payload: {
      toolCallId: "rt-1",
      resultText: "pub struct PaneEventLog { ring: VecDeque<Frame>, … }",
      resultTruncated: false,
      isError: false,
      occurredAt: minutesAgo(3),
    },
  },
  {
    id: "r-8",
    event: "tool_call_started",
    payload: {
      toolCallId: "rt-2",
      toolName: "bash",
      argsJson: '{"cmd":"cargo test -p loop-bridge"}',
      argsTruncated: false,
      occurredAt: minutesAgo(1),
    },
  },
];

// Steer deliverable: appended to the running stream when the demo steer
// endpoint is hit (accept → steer_queued → in-session steer message).
let steerSeq = 0;
function steerFrames(): Frame[] {
  steerSeq += 1;
  const t = now();
  return [
    {
      id: `r-steer-${steerSeq}-1`,
      event: "steer_queued",
      payload: { steerId: `rst-${steerSeq}`, text: "Focus on the slow-consumer reset path", runId: RUNNING_RUN_ID, occurredAt: t },
    },
    {
      id: `r-steer-${steerSeq}-2`,
      event: "user_message",
      payload: {
        messageId: `rm-steer-${steerSeq}`,
        text: "Focus on the slow-consumer reset path",
        source: "steer",
        imageCount: 0,
        attachments: [],
        occurredAt: t,
      },
    },
  ];
}

// ── v7 attachment session: a completed turn whose user input carries one
// inline image ref + one file-card ref (decision D5). Bodies are served at
// /v1/sessions/{id}/attachments/{id} from the locally generated bytes above.
const assetsFrames: Frame[] = [
  { id: "a-1", event: "lifecycle", payload: { phase: "sessionStarted", occurredAt: minutesAgo(18) } },
  {
    id: "a-2",
    event: "user_message",
    payload: {
      messageId: "am-1",
      text: "이 스크린샷과 노트를 봐줘 — 레이아웃 문제를 정리해줘",
      source: "interactive",
      imageCount: 1,
      attachments: [
        { attachmentId: IMAGE_ATTACHMENT_ID, mimeType: "image/png", byteLen: DEMO_IMAGE_BYTES.byteLength },
        { attachmentId: FILE_ATTACHMENT_ID, mimeType: "text/markdown", byteLen: DEMO_FILE_BYTES.byteLength },
      ],
      occurredAt: minutesAgo(18),
    },
  },
  { id: "a-3", event: "lifecycle", payload: { phase: "turnStarted", occurredAt: minutesAgo(17) } },
  {
    id: "a-4",
    event: "assistant_delta",
    payload: { messageId: "aa-1", delta: "이미지와 노트를 확인했어요.", occurredAt: minutesAgo(17) },
  },
  {
    id: "a-5",
    event: "assistant_message",
    payload: {
      messageId: "aa-1",
      text: "인라인 이미지는 정상 렌더됩니다. 노트는 파일 카드로 표시되고, 안전영역 아래 컴포저 겹침 1건을 발견했습니다.",
      truncated: false,
      occurredAt: minutesAgo(16),
    },
  },
  {
    id: "a-6",
    event: "tool_call_started",
    payload: {
      toolCallId: "at-1",
      toolName: "read",
      argsJson: '{"path":"docs/research/simulator-showcase/v7/evidence.md"}',
      argsTruncated: false,
      occurredAt: minutesAgo(16),
    },
  },
  {
    id: "a-7",
    event: "tool_call_ended",
    payload: {
      toolCallId: "at-1",
      resultText: "# showcase v7 — 토큰 없는 첫 실행, 첨부 렌더, 데스크톱 패리티 …",
      resultTruncated: false,
      isError: false,
      occurredAt: minutesAgo(15),
    },
  },
  { id: "a-8", event: "lifecycle", payload: { phase: "turnEnded", occurredAt: minutesAgo(15) } },
  { id: "a-9", event: "lifecycle", payload: { phase: "sessionEnded", occurredAt: minutesAgo(14) } },
];

// ── v8 details session (showcase-v8): a short ended turn whose assistant
// message is the C1/C2 evidence — header, bullets, emphasis, inline code,
// and one fenced code block the app renders as the copy-affordance card.
// Kept short so the whole exchange fits one unscrolled screen.
const detailsFrames: Frame[] = [
  { id: "dd-1", event: "lifecycle", payload: { phase: "sessionStarted", occurredAt: minutesAgo(31) } },
  {
    id: "dd-2",
    event: "user_message",
    payload: {
      messageId: "dm-5",
      text: "Where does the demo gateway trim the SSE tail? Show code.",
      source: "interactive",
      imageCount: 0,
      attachments: [],
      occurredAt: minutesAgo(31),
    },
  },
  { id: "dd-3", event: "lifecycle", payload: { phase: "turnStarted", occurredAt: minutesAgo(30) } },
  {
    id: "dd-4",
    event: "assistant_message",
    payload: {
      messageId: "da-5",
      text: [
        "The cut lives in **one constant**, enforced at flush time.",
        "",
        "## Where the cut happens",
        "",
        "- `MAX_OUTPUT_BYTES` bounds every tool result",
        "- the flush drops the **oldest** frames first",
        "",
        "```ts",
        "export const MAX_OUTPUT_BYTES = 8 * 1024;",
        "",
        "export function cutToBudget(body: string): string {",
        "  return body.length <= MAX_OUTPUT_BYTES",
        "    ? body",
        '    : body.slice(0, MAX_OUTPUT_BYTES) + "…(truncated)";',
        "}",
        "```",
        "",
        "Anything past the cap never reaches the app (C5).",
      ].join("\n"),
      truncated: false,
      occurredAt: minutesAgo(30),
    },
  },
  { id: "dd-5", event: "lifecycle", payload: { phase: "turnEnded", occurredAt: minutesAgo(29) } },
  { id: "dd-6", event: "lifecycle", payload: { phase: "sessionEnded", occurredAt: minutesAgo(29) } },
];

// ── v8 live session (showcase-v8): opens with a two-day timeline
// (yesterday 23:47 user ask → today's turn: the C8 date boundary plus C6
// clock captions), a done read card, and a STILL-RUNNING bash card
// (auto-expanded with the running… chip — C3/C4). `liveExtrasFrames` is
// pushed to subscribers a few seconds after open: turnStarted with no
// content yet → the busy-row typing indicator (C7) appears under the
// expanded card.
const liveFrames: Frame[] = [
  { id: "lv-1", event: "lifecycle", payload: { phase: "sessionStarted", occurredAt: yesterdayAt(23, 47) } },
  {
    id: "lv-2",
    event: "user_message",
    payload: {
      messageId: "lm-6",
      text: "Audit the backpressure tests before you refactor.",
      source: "interactive",
      imageCount: 0,
      attachments: [],
      occurredAt: yesterdayAt(23, 47),
    },
  },
  { id: "lv-3", event: "lifecycle", payload: { phase: "turnStarted", occurredAt: todayAt(0, 5) } },
  {
    id: "lv-4",
    event: "assistant_message",
    payload: {
      messageId: "la-6",
      text: "On it — checking the current backpressure tests first.",
      truncated: false,
      occurredAt: todayAt(0, 5),
    },
  },
  {
    id: "lv-5",
    event: "tool_call_started",
    payload: {
      toolCallId: "lt-6a",
      toolName: "read",
      argsJson: '{"path":"crates/loop-bridge/src/backpressure.rs"}',
      argsTruncated: false,
      occurredAt: todayAt(0, 6),
    },
  },
  {
    id: "lv-6",
    event: "tool_call_ended",
    payload: {
      toolCallId: "lt-6a",
      resultText: "impl BoundedSender { ring: VecDeque<Frame>, … } · 34 lines",
      resultTruncated: false,
      isError: false,
      occurredAt: todayAt(0, 6),
    },
  },
  {
    id: "lv-7",
    event: "tool_call_started",
    payload: {
      toolCallId: "lt-6b",
      toolName: "bash",
      argsJson: '{"cmd":"cargo test -p loop-bridge backpressure"}',
      argsTruncated: false,
      occurredAt: minutesAgo(1),
    },
  },
];

function liveExtrasFrames(): Frame[] {
  return [
    {
      id: `lv-x-${Date.now()}-a`,
      event: "lifecycle",
      payload: { phase: "turnStarted", occurredAt: now() },
    },
    // Open assistant message with an empty buffer: exactly the state a real
    // stream shows between turn start and the first non-empty merged delta —
    // the projection renders it as the busy-row typing indicator (C7).
    {
      id: `lv-x-${Date.now()}-b`,
      event: "assistant_delta",
      payload: { messageId: "la-6b", delta: "", occurredAt: now() },
    },
  ];
}

// ── v8 history session (showcase-v8): a long two-day script (C6
// timestamps, C8 header, C11 jump pill). Deliberately taller than one
// screen so a scripted scroll-up leaves the tail and the pill appears over
// real content.
const historyFrames: Frame[] = [
  { id: "hs-1", event: "lifecycle", payload: { phase: "sessionStarted", occurredAt: yesterdayAt(21, 2) } },
  {
    id: "hs-2",
    event: "user_message",
    payload: {
      messageId: "hm-7a",
      text: "Map every queue touchpoint in the pane mirror.",
      source: "interactive",
      imageCount: 0,
      attachments: [],
      occurredAt: yesterdayAt(21, 2),
    },
  },
  { id: "hs-3", event: "lifecycle", payload: { phase: "turnStarted", occurredAt: yesterdayAt(21, 2) } },
  {
    id: "hs-4",
    event: "assistant_message",
    payload: {
      messageId: "ha-7a",
      text: "Four touchpoints — walking the mirror path now so the map names real symbols.",
      truncated: false,
      occurredAt: yesterdayAt(21, 4),
    },
  },
  {
    id: "hs-5",
    event: "tool_call_started",
    payload: {
      toolCallId: "ht-7a",
      toolName: "read",
      argsJson: '{"path":"packages/gateway/src/pane-mirror.ts"}',
      argsTruncated: false,
      occurredAt: yesterdayAt(21, 5),
    },
  },
  {
    id: "hs-6",
    event: "tool_call_ended",
    payload: {
      toolCallId: "ht-7a",
      resultText: "pub fn mirror(rx: Receiver<Frame>, sink: Sink) — 96 lines",
      resultTruncated: false,
      isError: false,
      occurredAt: yesterdayAt(21, 5),
    },
  },
  {
    id: "hs-7",
    event: "tool_call_started",
    payload: {
      toolCallId: "ht-7b",
      toolName: "bash",
      argsJson: '{"cmd":"rg BoundedSender packages/gateway"}',
      argsTruncated: false,
      occurredAt: yesterdayAt(21, 6),
    },
  },
  {
    id: "hs-8",
    event: "tool_call_ended",
    payload: {
      toolCallId: "ht-7b",
      resultText: "pane-mirror.ts:12 · pane-mirror.ts:57 · pane-mirror.ts:88",
      resultTruncated: false,
      isError: false,
      occurredAt: yesterdayAt(21, 7),
    },
  },
  {
    id: "hs-9",
    event: "assistant_message",
    payload: {
      messageId: "ha-7b",
      text: "Map: the ring buffer owns backpressure, the mirror thread only observes, the sink flushes on revision, and replay drains from the cursor. Every touchpoint is bounded — nothing on this path can buffer without a cap.",
      truncated: false,
      occurredAt: yesterdayAt(21, 9),
    },
  },
  { id: "hs-10", event: "lifecycle", payload: { phase: "turnEnded", occurredAt: yesterdayAt(21, 9) } },
  {
    id: "hs-11",
    event: "user_message",
    payload: {
      messageId: "hm-7b",
      text: "Now do the same for the SSE reconnect path.",
      source: "interactive",
      imageCount: 0,
      attachments: [],
      occurredAt: todayAt(0, 12),
    },
  },
  { id: "hs-12", event: "lifecycle", payload: { phase: "turnStarted", occurredAt: todayAt(0, 12) } },
  {
    id: "hs-13",
    event: "tool_call_started",
    payload: {
      toolCallId: "ht-7c",
      toolName: "grep",
      argsJson: '{"pattern":"reconnect"}',
      argsTruncated: false,
      occurredAt: todayAt(0, 13),
    },
  },
  {
    id: "hs-14",
    event: "tool_call_ended",
    payload: {
      toolCallId: "ht-7c",
      resultText: "client.ts:41 (retry backoff) · client.ts:88 (cursor replay)",
      resultTruncated: false,
      isError: false,
      occurredAt: todayAt(0, 13),
    },
  },
  {
    id: "hs-15",
    event: "assistant_message",
    payload: {
      messageId: "ha-7c",
      text: "Reconnect is covered: the client backs off, re-opens from the last cursor, and the projection folds replayed frames idempotently — no duplicate rows, no lost tail.",
      truncated: false,
      occurredAt: todayAt(0, 14),
    },
  },
  { id: "hs-16", event: "lifecycle", payload: { phase: "turnEnded", occurredAt: todayAt(0, 14) } },
  { id: "hs-17", event: "lifecycle", payload: { phase: "sessionEnded", occurredAt: todayAt(0, 15) } },
];

// ── v9 attach-demo session (showcase-v9): a LIVE turn mid-flight so the
// scripted composer send has an honest delivery target. History: one prior
// text exchange, then a still-running bash tool card — the scripted attach
// (thumbnails in the composer) and the observed user_message frame from the
// input route below land underneath it, in-stream like the real gateway.
const v9Frames: Frame[] = [
  { id: "v9-1", event: "lifecycle", payload: { phase: "sessionStarted", occurredAt: minutesAgo(4) } },
  {
    id: "v9-2",
    event: "user_message",
    payload: {
      messageId: "v9m-1",
      text: "리스트 카드 간격이 들쭉날쭉해 — 스크린샷 첨부할 테니 원인 찾아줘",
      source: "interactive",
      imageCount: 0,
      attachments: [],
      occurredAt: minutesAgo(4),
    },
  },
  { id: "v9-3", event: "lifecycle", payload: { phase: "turnStarted", occurredAt: minutesAgo(3) } },
  {
    id: "v9-4",
    event: "assistant_message",
    payload: {
      messageId: "v9a-1",
      text: "간격 리듬부터 확인하겠습니다 — 리스트 렌더러와 토큰 정의를 읽는 중입니다.",
      truncated: false,
      occurredAt: minutesAgo(3),
    },
  },
  {
    id: "v9-5",
    event: "tool_call_started",
    payload: {
      toolCallId: "v9t-1",
      toolName: "bash",
      argsJson: '{"cmd":"rg "cardPadding|listGap" apps/loop-mobile/src/ui"}',
      argsTruncated: false,
      occurredAt: minutesAgo(1),
    },
  },
];

// v9 (showcase-v9) upload store + counters — module scope so the demo
// remembers uploaded bodies across requests (upload → input, like the real
// gateway's per-session asset store; per-process only, nothing persists).
const UPLOADABLE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_UPLOAD_BODY_BYTES = 8 * 1024 * 1024;
const uploadedBodies = new Map<string, { mimeType: string; bytes: Uint8Array; byteLen: number }>();
let uploadedSeq = 0;
let inputSeq = 0;

const streams = new Map<string, Frame[]>([
  [RUNNING_SESSION_ID, [...runningFrames]],
  [DONE_SESSION_ID, [...doneFrames]],
  [V9_SESSION_ID, [...v9Frames]],
  [ASSETS_SESSION_ID, [...assetsFrames]],
  [DETAILS_SESSION_ID, [...detailsFrames]],
  [LIVE_SESSION_ID, [...liveFrames]],
  [HISTORY_SESSION_ID, [...historyFrames]],
  // Session-title capture (task session-title-implementation): started but
  // the user has not said anything yet — exercises the naming rule's
  // `새 세션` + start time fallback (header AND subtitle relative time).
  [EMPTY_SESSION_ID, [{ id: "e-1", event: "lifecycle", payload: { phase: "sessionStarted", occurredAt: minutesAgo(2) } }]],
]);

/** v8 (showcase-v8): the live detail session's scripted next beat — pushes
 * to every current subscriber a few seconds after stream open. Fired once
 * per gateway process (see the events route below). */
let liveExtrasFired = false;
function pushLiveExtras(): void {
  pushToStream(LIVE_SESSION_ID, liveExtrasFrames());
}

function pushToStream(sessionId: string, frames: Frame[]): void {
  const stream = streams.get(sessionId);
  if (stream === undefined) return;
  stream.push(...frames);
  for (const waiter of streamWaiters) {
    if (waiter.sessionId === sessionId) waiter.push(frames);
  }
}

type StreamWaiter = { sessionId: string; push: (frames: Frame[]) => void };
const streamWaiters: StreamWaiter[] = [];

function runSummary(runId: string, status: string, createdAt: string, counts: [number, number, number, number, number, number]) {
  const [pending, running, attention, done, failed, cancelled] = counts;
  return {
    runId,
    status,
    terminal: status === "completed" || status === "failed" || status === "cancelled",
    createdAt,
    updatedAt: createdAt,
    lastSequence: "42",
    taskCounts: { pending, running, attention, done, failed, cancelled },
  };
}

function sessionsBody() {
  return {
    sessions: [
      {
        sessionId: RUNNING_SESSION_ID,
        runId: RUNNING_RUN_ID,
        taskId: "task_demo_1",
        workerId: "worker-demo",
        lane: "interactive",
        title: "Refactor the SSE backpressure path",
        state: "live",
      },
      {
        sessionId: DONE_SESSION_ID,
        runId: DONE_RUN_ID,
        taskId: "task_demo_2",
        workerId: "worker-demo",
        lane: "interactive",
        title: "Fix the flaky gateway test",
        state: "ended",
      },
      {
        sessionId: ORPHAN_SESSION_ID,
        runId: null,
        taskId: null,
        workerId: null,
        lane: "interactive",
        title: null,
        state: "ended",
      },
      {
        sessionId: EMPTY_SESSION_ID,
        runId: null,
        taskId: null,
        workerId: null,
        lane: "interactive",
        title: null,
        state: "live",
      },
      {
        sessionId: ASSETS_SESSION_ID,
        runId: ASSETS_RUN_ID,
        taskId: "task_demo_3",
        workerId: "worker-demo",
        lane: "interactive",
        title: "Showcase v7: inline image + file card",
        state: "ended",
      },
      {
        sessionId: DETAILS_SESSION_ID,
        runId: DETAILS_RUN_ID,
        taskId: "task_demo_5",
        workerId: "worker-demo",
        lane: "interactive",
        title: "Showcase v8: markdown + code budget",
        state: "ended",
      },
      {
        sessionId: LIVE_SESSION_ID,
        runId: LIVE_RUN_ID,
        taskId: "task_demo_6",
        workerId: "worker-demo",
        lane: "interactive",
        title: "Showcase v8: live backpressure audit",
        state: "live",
      },
      {
        sessionId: HISTORY_SESSION_ID,
        runId: HISTORY_RUN_ID,
        taskId: "task_demo_7",
        workerId: "worker-demo",
        lane: "interactive",
        title: "Showcase v8: two-day touchpoint map",
        state: "ended",
      },
      {
        sessionId: V9_SESSION_ID,
        runId: V9_RUN_ID,
        taskId: "task_demo_8",
        workerId: "worker-demo",
        lane: "interactive",
        title: "Showcase v9: photo attach on a live turn",
        state: "live",
      },
    ],
  };
}

const paneId = "pane_demo_mirror_1";
const paneText = [
  "loop·interactive  worker-demo",
  "▌ cargo test -p loop-bridge",
  "  running 42 tests …",
  "  42 passed; 0 failed",
].join("\n");

function problem(status: number, code: string, title: string, detail: string) {
  return {
    type: `https://loop.local/problems/${code}`,
    title,
    status,
    code,
    detail,
    requestId: `req_demo_${Math.random().toString(36).slice(2, 8)}`,
    retryable: false,
    fields: null,
  };
}

function sseResponse(initialFrames: Frame[], sessionId: string | null): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of initialFrames) controller.enqueue(encoder.encode(sseFrame(frame)));
      const waiter: StreamWaiter = {
        sessionId: sessionId ?? "",
        push: (frames) => {
          for (const frame of frames) controller.enqueue(encoder.encode(sseFrame(frame)));
        },
      };
      if (sessionId !== null) streamWaiters.push(waiter);
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(KEEPALIVE));
        } catch {
          clearInterval(keepalive);
        }
      }, 10_000);
      // (controller.close() is intentionally never called: the demo stream
      // stays open like the real gateway's SSE endpoints.)
    },
    cancel() {
      const idx = streamWaiters.findIndex((w) => w.sessionId === sessionId);
      if (idx >= 0) streamWaiters.splice(idx, 1);
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

let submittedSeq = 0;

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    const auth = request.headers.get("Authorization");
    // v7 tokenless (decision 2026-xx-tokenless-auth-and-app-layout §D-A1):
    // an absent Authorization header is accepted (tokenless first run);
    // `demo-token` keeps the v5/v6 rerun flows working; anything else 401s.
    const authed = auth === null || auth === `Bearer ${TOKEN}`;
    if (!authed) {
      return Response.json(problem(401, "unauthorized", "Unauthorized", "Bearer missing or invalid."), { status: 401 });
    }

    if (request.method === "GET" && url.pathname === "/v1/runs") {
      const allRuns = [
          runSummary(RUNNING_RUN_ID, "running", minutesAgo(6), [0, 1, 0, 0, 0, 0]),
          runSummary(DONE_RUN_ID, "completed", minutesAgo(42), [0, 0, 0, 4, 0, 0]),
          runSummary(ASSETS_RUN_ID, "completed", minutesAgo(18), [0, 0, 0, 1, 0, 0]),
          runSummary(OLD_RUN_ID, "completed", minutesAgo(120), [0, 0, 0, 2, 0, 0]),
          runSummary(DETAILS_RUN_ID, "completed", minutesAgo(31), [0, 0, 0, 1, 0, 0]),
          runSummary(LIVE_RUN_ID, "running", minutesAgo(8), [0, 1, 0, 0, 0, 0]),
          runSummary(HISTORY_RUN_ID, "completed", minutesAgo(200), [0, 0, 0, 3, 0, 0]),
          runSummary(V9_RUN_ID, "running", minutesAgo(4), [0, 1, 0, 0, 0, 0]),
      ];
      return Response.json({ runs: MAX_RUNS === null ? allRuns : allRuns.slice(0, MAX_RUNS), nextCursor: null });
    }

    if (request.method === "GET" && url.pathname === "/v1/sessions") {
      return Response.json(sessionsBody());
    }

    const sessionEvents = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/events$/);
    if (request.method === "GET" && sessionEvents !== null) {
      const sessionId = decodeURIComponent(sessionEvents[1]);
      const frames = streams.get(sessionId);
      if (frames === undefined) {
        // Unknown demo session: honest empty stream (no reset needed — the
        // client just sees no frames).
        return sseResponse([], sessionId);
      }
      // Showcase-v8: the live session's scripted next beat — one turn-
      // start (the busy-row typing indicator) fires a few seconds after a
      // subscriber attaches, so capture timing is deterministic from app
      // launch. One push per process: a later re-subscription replays the
      // already-applied frames instead of re-firing.
      if (sessionId === LIVE_SESSION_ID && !liveExtrasFired) {
        liveExtrasFired = true;
        setTimeout(() => pushLiveExtras(), 8000);
      }
      return sseResponse([...frames], sessionId);
    }

    // v7 (showcase-v7): serve attachment bodies like the real gateway's M2
    // route — out-of-band bytes with a content-type header, 404 problem when
    // the id is unknown. Bodies are the locally generated bytes above.
    const attachment = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/attachments\/([^/]+)$/);
    if (request.method === "GET" && attachment !== null) {
      // v9: uploaded bodies resolve alongside the static demo attachments —
      // same contract as the real gateway's per-session asset store.
      const uploaded = uploadedBodies.get(decodeURIComponent(attachment[2]));
      const body = uploaded !== undefined
        ? { mimeType: uploaded.mimeType, bytes: uploaded.bytes }
        : demoAttachmentBodies.get(decodeURIComponent(attachment[2]));
      if (body === undefined) {
        return Response.json(
          problem(404, "attachment_not_found", "Attachment not found", "No demo body for this attachment id."),
          { status: 404 },
        );
      }
      return new Response(body.bytes, {
        status: 200,
        headers: { "Content-Type": body.mimeType, "Content-Length": String(body.bytes.byteLength) },
      });
    }

    // v9 (showcase-v9): POST attachment upload — mirrors the real gateway's
    // M2 route (decision D5); the store below is declared at module scope.
    if (request.method === "POST") {
      const upload = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/attachments$/);
      if (upload !== null) {
        const sessionId = decodeURIComponent(upload[1]);
        if (!streams.has(sessionId)) {
          return Response.json(
            problem(404, "session_not_found", "Session not found", "No demo session for this id."),
            { status: 404 },
          );
        }
        const mediaType = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        if (!UPLOADABLE_IMAGE_TYPES.has(mediaType)) {
          return Response.json(
            problem(400, "invalid_media_type", "Invalid media type", "Allowed: image/png, image/jpeg, image/webp, image/gif."),
            { status: 400 },
          );
        }
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BODY_BYTES) {
          return Response.json(
            problem(413, "attachment_too_large", "Attachment too large", `Body must be 1..${MAX_UPLOAD_BODY_BYTES} bytes.`),
            { status: 413 },
          );
        }
        uploadedSeq += 1;
        const attachmentId = `att_demo_upload_${String(uploadedSeq).padStart(4, "0")}`;
        uploadedBodies.set(attachmentId, { mimeType: mediaType, bytes, byteLen: bytes.byteLength });
        return Response.json({ attachmentId, mimeType: mediaType, byteLen: bytes.byteLength }, { status: 201 });
      }
    }

    // v9 (showcase-v9): POST session input — mirrors the real gateway's D5
    // route: refs only, resolved against stored bodies (upload store or the
    // locally generated demo attachments), 202 → the OBSERVED user_message
    // frame is pushed onto the session stream like a real tap feed would.
    if (request.method === "POST") {
      const input = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/input$/);
      if (input !== null) {
        const sessionId = decodeURIComponent(input[1]);
        if (!streams.has(sessionId)) {
          return Response.json(
            problem(404, "session_not_found", "Session not found", "No demo session for this id."),
            { status: 404 },
          );
        }
        const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
        if (!contentType.includes("application/json")) {
          return Response.json(
            problem(400, "invalid_request", "Invalid request", "content-type application/json is required."),
            { status: 400 },
          );
        }
        let parsed: unknown;
        try {
          parsed = await request.json();
        } catch {
          return Response.json(
            problem(400, "invalid_request", "Invalid request", "Body must be valid JSON."),
            { status: 400 },
          );
        }
        const body = (parsed ?? {}) as { text?: unknown; attachments?: unknown };
        if (typeof body.text !== "string") {
          return Response.json(
            problem(400, "invalid_request", "Invalid request", "text must be a string."),
            { status: 400 },
          );
        }
        const refs: { attachmentId: string }[] = Array.isArray(body.attachments)
          ? body.attachments.map((entry) => ({ attachmentId: String((entry as { attachmentId?: unknown })?.attachmentId ?? "") }))
          : [];
        if (body.text.trim().length === 0 && refs.length === 0) {
          return Response.json(
            problem(400, "invalid_request", "Invalid request", "Input must carry text or attachments."),
            { status: 400 },
          );
        }
        const stored = refs.map((ref) => {
          const uploaded = uploadedBodies.get(ref.attachmentId);
          if (uploaded !== undefined) {
            return { attachmentId: ref.attachmentId, mimeType: uploaded.mimeType, byteLen: uploaded.byteLen };
          }
          const demo = demoAttachmentBodies.get(ref.attachmentId);
          if (demo !== undefined) {
            return { attachmentId: ref.attachmentId, mimeType: demo.mimeType, byteLen: demo.bytes.byteLength };
          }
          return null;
        });
        if (stored.some((entry) => entry === null)) {
          return Response.json(
            problem(404, "attachment_not_found", "Attachment not found", "Ref does not resolve to a stored demo body."),
            { status: 404 },
          );
        }
        inputSeq += 1;
        const inputId = `in_demo_${String(inputSeq).padStart(4, "0")}`;
        const imageCount = stored.filter((entry) => entry !== null && entry.mimeType.startsWith("image/")).length;
        const frame: Frame = {
          id: `v9-in-${inputSeq}`,
          event: "user_message",
          payload: {
            messageId: `v9in-${inputSeq}`,
            text: body.text,
            source: "interactive",
            imageCount,
            attachments: stored,
            occurredAt: now(),
          },
        };
        // Small delay so the composer's uploaded badges clear before the
        // observed frame lands — mirrors real tap-feed latency.
        setTimeout(() => pushToStream(sessionId, [frame]), 800);
        return Response.json({ inputId }, { status: 202 });
      }
    }

    const steer = url.pathname.match(/^\/v1\/runs\/([^/]+)\/steer$/);
    if (request.method === "POST" && steer !== null) {
      const runId = decodeURIComponent(steer[1]);
      if (runId !== RUNNING_RUN_ID) {
        return Response.json(
          problem(502, "steer_unavailable", "Steer unavailable", "No mailbox for this run in the demo."),
          { status: 502 },
        );
      }
      const frames = steerFrames();
      setTimeout(() => pushToStream(RUNNING_SESSION_ID, frames), 1200);
      return Response.json({ steerId: frames[0] && (frames[0].payload as { steerId: string }).steerId }, { status: 202 });
    }

    if (request.method === "POST" && url.pathname === "/v1/runs") {
      submittedSeq += 1;
      const runId = `run_demo_submitted_${String(submittedSeq).padStart(4, "0")}`;
      return Response.json(
        { run: runSummary(runId, "accepted", now(), [1, 0, 0, 0, 0, 0]) },
        { status: 202 },
      );
    }

    if (request.method === "GET" && url.pathname === "/v1/panes") {
      return Response.json({
        panes: [{ paneId, label: "pi·worker-demo mirror", taskId: "task_demo_1", workspaceId: "ws_demo", state: "observed" }],
      });
    }

    const paneEvents = url.pathname.match(/^\/v1\/panes\/([^/]+)\/events$/);
    if (request.method === "GET" && paneEvents !== null) {
      const frame: Frame = {
        id: "p-1",
        event: "pane_text",
        payload: { paneId: paneEvents[1], revision: "7", text: paneText, truncated: false, occurredAt: now() },
      };
      return sseResponse([frame], null);
    }

    return Response.json(problem(404, "not_found", "Not found", `No demo route for ${request.method} ${url.pathname}`), {
      status: 404,
    });
  },
});

console.log(
  `demo-gateway: fake-data gateway on http://127.0.0.1:${server.port} (tokenless or Bearer demo-token; fake demo data; locally generated attachments; no model calls)`,
);
