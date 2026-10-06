/**
 * Connection settings for the Loop HTTP gateway.
 *
 * Per docs/decisions/2026-xx-remote-app-architecture.md §D2, as amended by
 * docs/decisions/2026-xx-app-credential-persistence.md:
 * - base URL is exactly `http://<host>:<port>`; `/v1` is the route prefix.
 * - tokenless is the DEFAULT mode (decision 2026-xx-tokenless-auth-and-app-
 *   layout §D-A1): an empty bearer is normal on a Tailscale-bound gateway —
 *   tailnet membership is the trust boundary, so no Authorization header is
 *   sent at all. A non-empty bearer selects the explicit fallback mode
 *   (§D-A3) and lives in process memory while connected; the ONLY sanctioned
 *   durable store is the OS secure keychain (iOS Keychain / Android
 *   Keystore) via the credential-store module, and only for that fallback
 *   bearer. Files, AsyncStorage, SQLite, logs, and crash reports stay
 *   forbidden; tokens are never logged or rendered.
 */

export class ConnectionConfigError extends Error {
  override readonly name = "ConnectionConfigError";
}

export type ConnectionConfig = {
  readonly baseUrl: string;
  readonly bearer: string;
};

const MIN_PORT = 1;
const MAX_PORT = 65535;

/** Build the in-memory connection config used by every gateway call.
 * An empty `bearer` is the tokenless default (decision §D-A1), not an error. */
export function createConnectionConfig(
  host: string,
  port: number | string,
  bearer: string = "",
): ConnectionConfig {
  const trimmedHost = host.trim();
  if (trimmedHost.length === 0) {
    throw new ConnectionConfigError("host is required");
  }
  if (trimmedHost.includes("/") || trimmedHost.includes(":")) {
    throw new ConnectionConfigError("host must be a bare Tailscale address without scheme or port");
  }

  const parsedPort = typeof port === "string" ? Number.parseInt(port.trim(), 10) : port;
  if (!Number.isInteger(parsedPort) || parsedPort < MIN_PORT || parsedPort > MAX_PORT) {
    throw new ConnectionConfigError(`port must be an integer in ${MIN_PORT}..${MAX_PORT}`);
  }

  const trimmedBearer = bearer.trim();

  return { baseUrl: `http://${trimmedHost}:${parsedPort}`, bearer: trimmedBearer };
}

/** Recover the host/port pair from a base URL built by `createConnectionConfig`
 * (host validation above guarantees no scheme, slash, or colon in the host). */
export function parseBaseUrl(baseUrl: string): { host: string; port: number } {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:") {
    throw new ConnectionConfigError("base URL must use http");
  }
  return { host: url.hostname, port: Number.parseInt(url.port, 10) };
}
