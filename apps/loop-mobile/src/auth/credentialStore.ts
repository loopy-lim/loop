/**
 * Gateway credential persistence — the one sanctioned durable store.
 *
 * Policy (docs/decisions/2026-xx-app-credential-persistence.md, the explicit
 * amendment of AGENTS.md "do not persist credentials" and ADR §D2): the
 * gateway bearer + host:port may live ONLY in the OS secure keychain
 * (iOS Keychain / Android Keystore), device-only (never backed up, never
 * migrated), and must be instantly removable via logout. General files,
 * AsyncStorage, SQLite, Tauri store, logs, and crash reports remain
 * forbidden; tokens are never rendered in UI or logs
 * (`[credential]=[redacted]`).
 *
 * This module is pure: the OS keychain sits behind the `GatewayKeychainPort`
 * interface, so unit tests run deterministically against an in-memory mock
 * (no native module, no network). The real binding lives in `keychain.ts`.
 */

import {
  connectionConfigFromUrl,
  createConnectionConfig,
  parseBaseUrl,
  type ConnectionConfig,
} from "../auth/connection";

/** Minimal keychain surface this app needs (subset of react-native-keychain). */
export type GatewayKeychainPort = {
  /** Store the single service item; `username` carries `host:port`. */
  save(username: string, password: string): Promise<boolean>;
  /** Read the service item; null when absent. */
  load(): Promise<{ username: string; password: string } | null>;
  /** Delete the service item (logout). */
  clear(): Promise<boolean>;
};

export type StoredGatewayCredentials = {
  readonly host: string;
  readonly port: number;
  /** Serve-TLS amendment: the stored location's scheme (see connection.ts). */
  readonly tls: boolean;
  readonly bearer: string;
};

/** Keychain username encoding. Plain-http entries stay the legacy
 * `host:port` (createConnectionConfig forbids ":" and "/" inside the host,
 * so splitting on the LAST colon is lossless). TLS-fronted entries carry
 * their scheme explicitly: `https://host:port` — self-describing, and the
 * legacy shape still decodes as http. */
export function encodeCredentialUsername(host: string, port: number, tls: boolean): string {
  return tls ? `https://${host}:${port}` : `${host}:${port}`;
}

/** The password field of a tokenless connection entry. A tokenless connect
 * has no bearer material to persist (tokenless decision §D-A3), but the QR
 * pairing decision (§3.2) requires the relaunch to restore the saved
 * host:port — so the same single service item stores the connection SETTING
 * (host, port, mode) with this non-secret mode marker instead of a token.
 * A non-empty password that is not this marker stays a fallback bearer.
 * The marker is a constant string, never user or gateway data. */
export const TOKENLESS_PASSWORD_MARKER = "tokenless";

/** Validate + decode a raw keychain item. Returns null for missing or
 * malformed payloads so callers treat corruption as "not signed in"
 * (the stale item is left in place; a successful re-login overwrites it).
 * The tokenless marker decodes to a tokenless entry (bearer "") — the QR
 * pairing decision §3.2 relaunch-restore path for host:port settings. */
export function decodeStoredCredentials(
  username: string,
  password: string,
): StoredGatewayCredentials | null {
  const tlsForm = username.toLowerCase().startsWith("https://");
  const separator = username.lastIndexOf(":");
  if (separator <= 0 || separator === username.length - 1) return null;
  const host = tlsForm
    ? username.slice("https://".length, separator)
    : username.slice(0, separator);
  const rawPort = username.slice(separator + 1);
  const port = Number.parseInt(rawPort, 10);
  if (password === TOKENLESS_PASSWORD_MARKER) {
    // Tokenless stored connection: only host shape and port range validate;
    // there is no bearer material in the item.
    try {
      const parsed = parseBaseUrl(createConnectionConfig(host, port).baseUrl);
      return { host: parsed.host, port: parsed.port, tls: tlsForm, bearer: "" };
    } catch {
      return null;
    }
  }
  try {
    if (password.trim().length === 0) return null; // empty holds no entry (decision §D-A3)
    // Full validation path (host shape, port range, bearer fallback token).
    const config = createConnectionConfig(host, port, password);
    const parsed = parseBaseUrl(config.baseUrl);
    return { host: parsed.host, port: parsed.port, tls: tlsForm, bearer: config.bearer };
  } catch {
    return null;
  }
}

export type GatewayCredentialStore = {
  /** Saved credentials, or null when the device has no stored sign-in. */
  load(): Promise<StoredGatewayCredentials | null>;
  /** Persist after a successful connect (validated config in, never raw).
   * A tokenless config stores the connection setting (host:port + the
   * tokenless marker, no bearer material); a fallback config stores the
   * bearer. Either way one successful connect is what enables the
   * next-launch auto-restore (credential decision D2-2, QR decision §3.2). */
  save(config: ConnectionConfig): Promise<void>;
  /** Logout: delete the stored credential immediately. */
  clear(): Promise<void>;
};

export function createGatewayCredentialStore(
  keychain: GatewayKeychainPort,
): GatewayCredentialStore {
  return {
    async load(): Promise<StoredGatewayCredentials | null> {
      const item = await keychain.load();
      if (item === null) return null;
      return decodeStoredCredentials(item.username, item.password);
    },
    async save(config: ConnectionConfig): Promise<void> {
      const { host, port, tls } = parseBaseUrl(config.baseUrl);
      const bearer = config.bearer.trim();
      await keychain.save(
        encodeCredentialUsername(host, port, tls),
        bearer.length === 0 ? TOKENLESS_PASSWORD_MARKER : bearer,
      );
    },
    async clear(): Promise<void> {
      await keychain.clear();
    },
  };
}

/** Validated stored credentials → in-memory connection config. */
export function storedToConnectionConfig(stored: StoredGatewayCredentials): ConnectionConfig {
  return stored.tls
    ? connectionConfigFromUrl(`https://${stored.host}:${stored.port}`, stored.bearer)
    : createConnectionConfig(stored.host, stored.port, stored.bearer);
}
