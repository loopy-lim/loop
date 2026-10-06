/**
 * Lightweight gateway reachability/auth probe.
 *
 * Connect is no longer a purely local validation: fallback credentials are
 * persisted only after the gateway answers a real request (decision D2-1:
 * "첫 Connect 성공 시 저장"), and a tokenless connect succeeds only against a
 * listener that accepts unauthenticated requests (decision
 * 2026-xx-tokenless-auth-and-app-layout §D-A1). `GET /v1/runs?limit=1` is
 * the cheapest contract endpoint; 200 means reachable + accepted config.
 *
 * The probe result decides persistence; it is never logged and the failure
 * reasons built from it carry no token material.
 */

import { GatewayClient, type FetchLike } from "./client";

export const PROBE_TIMEOUT_MS = 8000;

/** Resolve when the gateway accepts the config's bearer; throw otherwise. */
export async function probeGateway(
  config: { baseUrl: string; bearer: string },
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const probingFetch: FetchLike = (input, init) =>
    fetchImpl(input, { ...init, signal: controller.signal });
  try {
    // listRuns throws GatewayError (problem contract) on non-200.
    await new GatewayClient(config, probingFetch).listRuns(1);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("gateway probe timed out", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
