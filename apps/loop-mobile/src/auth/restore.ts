/**
 * Launch-time session restore policy (decision D2-2/D2-3,
 * docs/decisions/2026-xx-app-credential-persistence.md).
 *
 * Relaunch: read the keychain; if a credential exists, try the saved token.
 * Auto-connect success → restored. Failure (gateway down, 401, timeout) →
 * fallback to the manual Connect screen WITH the stored entry kept (the
 * user may retry the same gateway; a re-login overwrites it). Keychain read
 * failure (device-locked grade, keychain unavailable) → manual screen, and
 * the stored entry is equally untouched.
 *
 * Pure orchestration: store + connect probe are injected, so tests are
 * deterministic. Reasons never embed the bearer — status/code only.
 */

import { GatewayError } from "../gateway-client/problem";
import {
  storedToConnectionConfig,
  type GatewayCredentialStore,
  type StoredGatewayCredentials,
} from "./credentialStore";
import type { ConnectionConfig } from "../auth/connection";

export type RestoreOutcome =
  | { kind: "none" }
  | { kind: "restored"; config: ConnectionConfig }
  | { kind: "fallback"; config: ConnectionConfig; reason: string };

export type RestoreDeps = {
  store: Pick<GatewayCredentialStore, "load">;
  /** Attempt a connection with the stored credential; throws on failure. */
  connect: (config: ConnectionConfig) => Promise<void>;
};

/**
 * Structural no-delete guarantee: this function never calls the store's
 * clear; the stored entry survives every non-restore outcome.
 */
export async function restoreSession(deps: RestoreDeps): Promise<RestoreOutcome> {
  const stored: StoredGatewayCredentials | null = await deps.store.load();
  if (stored === null) return { kind: "none" };
  const config = storedToConnectionConfig(stored);
  try {
    await deps.connect(config);
    return { kind: "restored", config };
  } catch (error) {
    return { kind: "fallback", config, reason: describeConnectFailure(error) };
  }
}

/** Human-facing auto-connect failure reason. Built from status/code only —
 * never from error.message, which could echo request context. */
export function describeConnectFailure(error: unknown): string {
  if (error instanceof GatewayError) {
    const code = error.problem.code.length > 0 ? error.problem.code : "error";
    return `auto-connect rejected by gateway (status ${error.problem.status}, ${code}) — sign in again`;
  }
  if (error instanceof Error && error.message === "gateway probe timed out") {
    return "auto-connect timed out — gateway unreachable, sign in to retry";
  }
  return "auto-connect failed — gateway unreachable, sign in to retry";
}
