/**
 * In-app QR scan model (task `mobile-safearea-qr-scan`): the pure decision
 * layer for the Connect screen's camera scanner. The native camera surface
 * (screens/QRScannerScreen, react-native-vision-camera) stays thin and
 * delegates every decision here so the whole contract — payload parsing,
 * permission mapping, duplicate-scan gating — is testable under bun with no
 * camera, no pods, no device.
 *
 * Payload contract: a scan yields the SAME `loop://connect?host=…&port=…`
 * payload the system-camera deep link carries (decision 2026-xx-qr-pairing),
 * so parsing is delegated to the existing strict parser (auth/pairing.ts) —
 * one grammar, two entrances. Secrets in a payload are refused, never
 * accepted silently; a manual host/port entry remains available for a
 * payload that fails for any reason.
 */
import { PairUrlError, parsePairUrl } from "../auth/pairing";

/** Vision-camera's permission status folded to what the screen can render. */
export type ScannerPermission = "unknown" | "checking" | "ready" | "blocked";

/** One scan evaluation: what the screen should do with the decoded string. */
export type ScanOutcome =
  | { kind: "idle" }
  | { kind: "invalid"; message: string }
  | { kind: "accepted"; host: string; port: number };

/**
 * Fold a native camera permission status into the scanner's UI state.
 * Fail-safe: an unrecognized status is treated as blocked (the screen shows
 * the manual-entry guidance) rather than pretending the camera works.
 */
export function mapCameraPermission(status: string): ScannerPermission {
  switch (status) {
    case "authorized":
    case "granted":
      return "ready";
    case "not-determined":
      return "checking";
    case "denied":
    case "restricted":
      return "blocked";
    default:
      return "blocked";
  }
}

/** Human-readable rejection for an unusable scan (same copy as the deep
 * link path's fallback notice — one wording for one contract). */
export const QR_PAYLOAD_INVALID_MESSAGE =
  "not a valid loop:// pairing payload — check the QR or enter host/port manually";

/**
 * Evaluate one decoded scan string against the pairing grammar. Trims the
 * scanner's surrounding whitespace (frame edges occasionally add some) and
 * delegates to `parsePairUrl`; every parser rejection folds to the same
 * invalid outcome so the screen never renders parser internals.
 */
export function evaluateScan(raw: string): ScanOutcome {
  try {
    const { host, port } = parsePairUrl(raw.trim());
    return { kind: "accepted", host, port };
  } catch (error) {
    if (!(error instanceof PairUrlError)) throw error;
    return { kind: "invalid", message: QR_PAYLOAD_INVALID_MESSAGE };
  }
}

/**
 * Duplicate-scan gate: the code scanner fires a burst of events for one
 * physical frame, so identical payloads inside the cooldown window are
 * collapsed to a single evaluation. A DIFFERENT payload is always evaluated
 * immediately (a user can re-aim at another code at once). Pure — no timers.
 */
export class ScanGate {
  private readonly cooldownMs: number;
  private lastRaw: string | null = null;
  private lastAt = Number.NEGATIVE_INFINITY;

  constructor(cooldownMs: number) {
    if (!(cooldownMs >= 0)) throw new RangeError("ScanGate cooldown must be >= 0");
    this.cooldownMs = cooldownMs;
  }

  /** `now` is monotonic-ish wall time supplied by the caller (Date.now()). */
  offer(raw: string, now: number): ScanOutcome {
    const trimmed = raw.trim();
    if (
      this.lastRaw === trimmed &&
      now - this.lastAt < this.cooldownMs
    ) {
      return { kind: "idle" };
    }
    this.lastRaw = trimmed;
    this.lastAt = now;
    return evaluateScan(trimmed);
  }
}
