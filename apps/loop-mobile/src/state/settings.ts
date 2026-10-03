/**
 * App settings (split-viewer design §B, minimal settings screen). Pure:
 * validation, clamping, and JSON round-tripping live here; the device
 * store sits behind the `SettingsStorage` string port, so tests pin
 * persistence with an in-memory fake and the RN binding stays a few lines
 * (auth/settingsKeychainStorage.ts — the keychain is this app's one sanctioned
 * durable store; AsyncStorage/SQLite stay forbidden per the credential
 * decision, and these are non-secret preferences, never credentials).
 *
 * Gateway connection is DISPLAYED, not edited here: the connection is
 * owned by sign-in (keychain credential decision D2) and a settings edit
 * that silently re-connects would bypass the probe path. v1 shows the
 * active host:port read-only.
 */

/** Viewer prose base font size, px. The markdown renderer scales headers
 * and code off this base. Clamped for legibility on both ends. */
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 22;
export const FONT_SIZE_DEFAULT = 15;

/** Foreground refresh interval for the run tree's pane inventory (ms).
 * The viewer NEVER polls (§B lazy load); this setting only governs the
 * optional pane-inventory refresh. */
export const REFRESH_MIN_MS = 2_000;
export const REFRESH_MAX_MS = 60_000;
export const REFRESH_DEFAULT_MS = 10_000;

export type AppSettings = {
  /** Display-only gateway connection the settings screen renders. */
  gatewayHost: string | null;
  gatewayPort: number | null;
  viewerFontSize: number;
  refreshIntervalMs: number;
};

export function defaultSettings(): AppSettings {
  return {
    gatewayHost: null,
    gatewayPort: null,
    viewerFontSize: FONT_SIZE_DEFAULT,
    refreshIntervalMs: REFRESH_DEFAULT_MS,
  };
}

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return FONT_SIZE_DEFAULT;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
}

export function clampRefreshInterval(ms: number): number {
  if (!Number.isFinite(ms)) return REFRESH_DEFAULT_MS;
  return Math.min(REFRESH_MAX_MS, Math.max(REFRESH_MIN_MS, Math.round(ms)));
}

/** Settings storage port: one opaque JSON string, absent as null. */
export type SettingsStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
};

export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify({
    gatewayHost: settings.gatewayHost,
    gatewayPort: settings.gatewayPort,
    viewerFontSize: clampFontSize(settings.viewerFontSize),
    refreshIntervalMs: clampRefreshInterval(settings.refreshIntervalMs),
  });
}

/** Decode persisted settings; malformed or out-of-range fields fall back
 * to defaults field-by-field (a corrupt font size must not lose the
 * refresh interval). Never throws. */
export function deserializeSettings(raw: string | null): AppSettings {
  const defaults = defaultSettings();
  if (raw === null || raw.length === 0) return defaults;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (typeof parsed !== "object" || parsed === null) return defaults;
  const record = parsed as Record<string, unknown>;
  const host =
    typeof record.gatewayHost === "string" && record.gatewayHost.length > 0
      ? record.gatewayHost
      : null;
  const port =
    typeof record.gatewayPort === "number" &&
    Number.isInteger(record.gatewayPort) &&
    record.gatewayPort > 0 &&
    record.gatewayPort <= 65535
      ? record.gatewayPort
      : null;
  return {
    gatewayHost: host,
    gatewayPort: port,
    viewerFontSize: clampFontSize(
      typeof record.viewerFontSize === "number" ? record.viewerFontSize : defaults.viewerFontSize,
    ),
    refreshIntervalMs: clampRefreshInterval(
      typeof record.refreshIntervalMs === "number"
        ? record.refreshIntervalMs
        : defaults.refreshIntervalMs,
    ),
  };
}

/** Store facade: typed load/save over the string port. */
export type SettingsStore = {
  load(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
};

export function createSettingsStore(storage: SettingsStorage): SettingsStore {
  return {
    async load(): Promise<AppSettings> {
      try {
        return deserializeSettings(await storage.read());
      } catch {
        return defaultSettings();
      }
    },
    async save(settings: AppSettings): Promise<void> {
      await storage.write(serializeSettings(settings));
    },
  };
}
