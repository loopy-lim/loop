/**
 * Worker pane steer relay (docs/decisions/2026-09-23-watch-to-steer.md): a thin
 * adapter-side component hosted inside a worker's Herdr pane. Typed lines land
 * on the relay's stdin; every line is delivered as a steer message through the
 * same orchestrator steer backend as `loop steer` (the steerRun control), and a
 * short redacted confirmation is echoed back to the pane. The relay never
 * injects raw stdin into provider processes, and its lifetime is the pane
 * lifetime (v1 contract): closing the pane ends the process, and a stdin EOF
 * ends the session cleanly as well.
 *
 * The worker-visibility mirror writes into the same pane via
 * `herdr pane send-text`, which arrives on the relay's stdin too. Display lines
 * are therefore framed as single-line JSON while a relay is live; anything that
 * is not a display frame is treated as user steer input.
 */

/** Command that hosts the relay inside a pane (executed via `herdr pane run`). */
export interface PaneRelaySpec {
  command: string;
  args: string[];
}

const DISPLAY_FRAME_KEY = "loopDisplay";

/** Frames a mirror line so the relay displays it instead of steering on it. JSON escapes newlines, so frames stay single-line. */
export function encodeDisplayFrame(line: string): string {
  return JSON.stringify({ [DISPLAY_FRAME_KEY]: line });
}

export type ParsedPaneLine = { kind: "display"; text: string } | { kind: "steer"; text: string };

/** Classifies one pane input line: a strict display frame is mirror traffic; everything else is user steer input. */
export function parsePaneLine(line: string): ParsedPaneLine {
  const text = line.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return { kind: "steer", text };
  try {
    const value: unknown = JSON.parse(text);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 1 && entries[0]![0] === DISPLAY_FRAME_KEY && typeof entries[0]![1] === "string") {
        return { kind: "display", text: entries[0]![1] };
      }
    }
  } catch {
    // Not a frame: fall through to steer input.
  }
  return { kind: "steer", text };
}

/** Delivery target resolved by the host process (the orchestrator steerRun input minus storage binding). */
export interface SteerRelayDelivery {
  runId: string;
  taskId: string;
  message: string;
}

export interface SteerRelayOptions {
  runId: string;
  taskId: string;
  /** Steer backend: the orchestrator steerRun path, the same code `loop steer` drives. */
  deliver(input: SteerRelayDelivery): Promise<unknown>;
  /** Pane-facing line writer (the relay process's stdout). */
  echo(line: string): void;
  /**
   * Surface redaction for echoed text (production wires the providers'
   * redactProviderText), injected so this package stays free of provider
   * imports. Only redacted text ever reaches the pane.
   */
  redact(line: string, limit: number): string;
  /** Echo clamp; defaults to the 160-character house line limit. */
  lineTextLimit?: number;
}

export class SteerRelaySession {
  readonly #options: SteerRelayOptions;
  readonly #lineTextLimit: number;

  constructor(options: SteerRelayOptions) {
    this.#options = options;
    this.#lineTextLimit = options.lineTextLimit ?? 160;
  }

  /** Handles one pane input line: display frames are echoed verbatim, other lines are steered. */
  async handleLine(line: string): Promise<void> {
    const parsed = parsePaneLine(line);
    if (parsed.kind === "display") {
      if (parsed.text) this.#options.echo(parsed.text);
      return;
    }
    if (!parsed.text) return;
    const shown = this.#options.redact(parsed.text, this.#lineTextLimit);
    if (!shown) return;
    try {
      await this.#options.deliver({ runId: this.#options.runId, taskId: this.#options.taskId, message: parsed.text });
      this.#options.echo(`→ steer: ${shown}`);
    } catch (error) {
      const brief = error instanceof Error ? error.message : String(error);
      this.#options.echo(`! steer not delivered: ${this.#options.redact(brief, this.#lineTextLimit)}`);
    }
  }
}

/**
 * Drives a relay over an async line source and returns when the source ends
 * (pane close → stdin EOF), so the process exits with the worker's pane.
 */
export async function runSteerRelaySession(lines: AsyncIterable<string>, options: SteerRelayOptions): Promise<void> {
  const session = new SteerRelaySession(options);
  for await (const line of lines) {
    await session.handleLine(line);
  }
}
