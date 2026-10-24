/**
 * Connection settings for the Loop HTTP gateway.
 *
 * Per docs/decisions/2026-xx-remote-app-architecture.md §D2, as amended by
 * docs/decisions/2026-xx-app-credential-persistence.md and the 2026-10-22
 * serve-TLS amendment (same decision): base URL is exactly
 * `http://<host>:<port>` — or `https://<host>[:<port>]` when the gateway is
 * reached through a TLS front (tailscale serve), still tailnet-internal.
 * `/v1` is the route prefix.
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

/** Build a connection config from a full base URL — the manual-entry shape
 * for a TLS-fronted gateway (tailscale serve): `https://gw.tailnet.ts.net`
 * or `https://gw.tailnet.ts.net:8443` (plain `http://host:port` accepted
 * too). Host shape and port range are validated by `createConnectionConfig`
 * (one authority), then re-stamped with the URL's scheme. A path, query, or
 * credentials component is rejected: the base URL carries no route data. */
export function connectionConfigFromUrl(input: string, bearer: string = ""): ConnectionConfig {
  const match = /^(https?):\/\/([^/?#\s]+)$/i.exec(input.trim());
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new ConnectionConfigError("connection must be a full http(s)://host[:port] URL");
  }
  const scheme = match[1].toLowerCase();
  const authority = match[2];
  const colon = authority.lastIndexOf(":");
  const host = colon > -1 ? authority.slice(0, colon) : authority;
  const rawPort = colon > -1 ? authority.slice(colon + 1) : "";
  if (rawPort.length === 0 && colon > -1) {
    throw new ConnectionConfigError("port must not be empty");
  }
  if (rawPort.length > 0 && !/^\d+$/.test(rawPort)) {
    throw new ConnectionConfigError("port must be numeric");
  }
  // createConnectionConfig owns host-shape and port-range validation; the
  // 80 here is only its mandatory argument — the rebuilt authority keeps the
  // user's exact form (no invented default port: `https://gw` stays so, and
  // parseBaseUrl implies 443/80 from the scheme).
  const config = createConnectionConfig(host, rawPort.length > 0 ? rawPort : 80, bearer);
  const canonicalHost = parseBaseUrl(config.baseUrl).host;
  return {
    baseUrl:
      rawPort.length > 0
        ? `${scheme}://${canonicalHost}:${rawPort}`
        : `${scheme}://${canonicalHost}`,
    bearer: config.bearer,
  };
}

/** Recover the location from a base URL built by `createConnectionConfig`
 * or `connectionConfigFromUrl` (host validation above guarantees no slash
 * in the host). Default ports are implied by the scheme when absent. */
export function parseBaseUrl(baseUrl: string): { host: string; port: number; tls: boolean } {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConnectionConfigError("base URL must use http or https");
  }
  const tls = url.protocol === "https:";
  const port = url.port.length > 0 ? Number.parseInt(url.port, 10) : tls ? 443 : 80;
  return { host: url.hostname, port, tls };
}
