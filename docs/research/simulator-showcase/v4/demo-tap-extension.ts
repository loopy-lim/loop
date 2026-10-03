/**
 * Demo conversation tap — simulator showcase v4 (task `simulator-showcase-4`).
 *
 * DEMO INFRASTRUCTURE, NOT A REPO PACKAGE: this file lives in the showcase
 * directory (v3 gateway-wrapper precedent) because the production tap
 * (pi-loop adapter + composition env markers, decision
 * 2026-xx-gui-conversation M-GC1) is a follow-up. It observes a REAL pi
 * session through the REAL pi extension API and streams the collector's
 * REAL NDJSON ingress vocabulary (packages/gateway/src/session-collector.ts)
 * over the REAL unix socket. Nothing here is scripted or synthesized — the
 * only non-production part is that a human (the showcase operator) launches
 * pi with `-e <this file>` and injects the correlation env markers that
 * composition will one day inject.
 *
 * Failure posture: fail-observer (D1). Any socket/transport error disables
 * observation for the session and never touches the machine path. The
 * extension only loads when explicitly passed via `-e`, and the socket only
 * exists while the gateway runs, so incidental loads are inert.
 *
 * Source classification honesty: pi's InputEvent source is
 * `interactive | rpc | extension` — pi has no native steer notion, so every
 * observed input maps to `interactive` here. A `source=steer` user message
 * therefore never comes from this tap; the GUI honestly keeps the steer
 * marker "queued" (D4 §4 pending-notation rule). Classification of mailbox
 * injections is composition's production job (documented as a v4 finding).
 */
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Collector socket (session-collector default; LOOP_GATEWAY_SESSION_SOCKET override). */
const SOCKET_ENV = "LOOP_GATEWAY_SESSION_SOCKET";
const collectorSocketPath = (): string =>
  process.env[SOCKET_ENV] ?? path.join(os.tmpdir(), "loop-session-collector.sock");

type Line = Record<string, unknown>;

export default function demoConversationTap(pi: ExtensionAPI) {
  let socket: net.Socket | null = null;
  let sessionId: string | null = null;
  let connected = false;
  let seq = 0;

  const send = (line: Line): void => {
    if (!connected || socket === null) return;
    try {
      socket.write(`${JSON.stringify({ occurredAt: new Date().toISOString(), ...line })}\n`);
    } catch {
      connected = false;
    }
  };

  const assistantText = (message: { content?: unknown }): string => {
    const content = message.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter((b): b is { type: string; text?: string } => {
        const t = (b as { type?: string }).type;
        return t === "text";
      })
      .map((b) => b.text ?? "")
      .join("");
  };

  const resultText = (result: unknown): string => {
    if (typeof result === "string") return result;
    if (typeof result === "object" && result !== null && Array.isArray((result as { content?: unknown }).content)) {
      const blocks = (result as { content: unknown[] }).content;
      return blocks
        .map((b) => {
          if (typeof b === "string") return b;
          const t = (b as { type?: string }).type;
          return t === "text" ? String((b as { text?: string }).text ?? "") : "";
        })
        .join("");
    }
    try {
      return JSON.stringify(result) ?? "";
    } catch {
      return String(result);
    }
  };

  pi.on("session_start", (_event, ctx) => {
    // Real session identity from pi; the fallback keeps the collector's id
    // bounds satisfied should the manager be unavailable at start.
    let piSessionId: string | null = null;
    try {
      piSessionId = ctx.sessionManager.getSessionId();
    } catch {
      piSessionId = null;
    }
    const client = net.connect(collectorSocketPath());
    client.on("connect", () => {
      socket = client;
      connected = true;
      sessionId =
        piSessionId ?? `v4demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      send({
        type: "register",
        sessionId,
        runId: process.env.LOOP_RUN_ID ?? null,
        taskId: process.env.LOOP_TASK_ID ?? null,
        workerId: process.env.HERDR_PANE_ID ?? process.env.LOOP_WORKER_ID ?? null,
        lane: "pi",
        title: process.env.LOOP_SHOWCASE_TITLE ?? "v4 showcase session",
      });
      send({ type: "lifecycle", phase: "sessionStarted" });
    });
    client.on("error", () => {
      // fail-observer: no collector → silent no-op.
      connected = false;
      socket = null;
    });
    client.on("close", () => {
      connected = false;
    });
  });

  pi.on("input", (event) => {
    seq += 1;
    send({
      type: "user_message",
      messageId: `u_${event.timestamp ?? Date.now()}_${seq}`,
      text: event.text,
      // pi has no native steer source (see header note): map honestly.
      source: "interactive",
      imageCount: Array.isArray(event.images) ? event.images.length : 0,
    });
  });

  pi.on("turn_start", () => send({ type: "lifecycle", phase: "turnStarted" }));
  pi.on("turn_end", () => send({ type: "lifecycle", phase: "turnEnded" }));

  pi.on("message_update", (event) => {
    const message = event.message;
    if (message.role !== "assistant") return;
    send({
      type: "assistant_update",
      // Full snapshot so far (collector merges on its own cadence, D4 §2).
      messageId: `a_${message.timestamp}`,
      text: assistantText(message),
    });
  });

  pi.on("message_end", (event) => {
    const message = event.message;
    if (message.role !== "assistant") return;
    send({
      type: "assistant_message",
      messageId: `a_${message.timestamp}`,
      text: assistantText(message),
    });
  });

  pi.on("tool_execution_start", (event) => {
    let argsJson = "";
    try {
      argsJson = JSON.stringify(event.args) ?? "";
    } catch {
      argsJson = "";
    }
    send({
      type: "tool_call_started",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      argsJson,
    });
  });

  pi.on("tool_execution_end", (event) => {
    send({
      type: "tool_call_ended",
      toolCallId: event.toolCallId,
      resultText: resultText(event.result),
      isError: event.isError === true,
    });
  });

  pi.on("session_shutdown", () => {
    send({ type: "lifecycle", phase: "sessionEnded" });
    send({ type: "session_shutdown" });
    if (socket !== null) socket.end();
    socket = null;
    connected = false;
  });
}
