/**
 * Lightweight gateway reachability probe (rebuild brief §4): GET
 * /v1/herdr/state is the cheapest herdr contract endpoint — 200 means the
 * gateway is reachable AND the herdr surface answers. Persistence (decision
 * D2-1) happens only after this resolves.
 *
 * The probe speaks raw fetch on purpose: gateway-client stays a leaf layer,
 * so the probe must not import the herdr client. Non-200 responses are
 * rethrown through the problem contract; failure reasons carry no token
 * material.
 */

import { GatewayError, parseProblem } from "./problem";

export const PROBE_TIMEOUT_MS = 8000;

/** Minimal structural fetch (same shape herdr/client uses). */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Resolve when the gateway accepts the config's bearer; throw otherwise. */
export async function probeGateway(
  config: { baseUrl: string; bearer: string },
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.bearer.length > 0) headers.Authorization = `Bearer ${config.bearer}`;
  try {
    const response = await fetchImpl(`${config.baseUrl}/v1/herdr/state`, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      throw new GatewayError(parseProblem(response.status, body));
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("gateway probe timed out", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
