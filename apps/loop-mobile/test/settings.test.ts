/**
 * App settings tests (split-viewer design §B): pure persistence —
 * defaults, clamping, JSON round-trip, corrupt-payload recovery — over an
 * in-memory storage fake. No keychain, no RN.
 */

import { describe, expect, test } from "bun:test";

import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  REFRESH_DEFAULT_MS,
  REFRESH_MAX_MS,
  REFRESH_MIN_MS,
  clampFontSize,
  clampRefreshInterval,
  createSettingsStore,
  deserializeSettings,
  serializeSettings,
  type AppSettings,
  type SettingsStorage,
} from "../src/state/settings";

function memoryStorage(
  initial: string | null = null,
): SettingsStorage & { value: () => string | null; writes: number } {
  let value: string | null = initial;
  return {
    async read() {
      return value;
    },
    async write(next: string) {
      value = next;
    },
    value: () => value,
    writes: 0,
  };
}

describe("defaults + clamping", () => {
  test("defaults carry no gateway and the §B middles", () => {
    const settings = deserializeSettings(null);
    expect(settings.gatewayHost).toBeNull();
    expect(settings.gatewayPort).toBeNull();
    expect(settings.viewerFontSize).toBe(FONT_SIZE_DEFAULT);
    expect(settings.refreshIntervalMs).toBe(REFRESH_DEFAULT_MS);
  });

  test("font size clamps into the registered range", () => {
    expect(clampFontSize(8)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(99)).toBe(FONT_SIZE_MAX);
    expect(clampFontSize(15.4)).toBe(15); // rounded, not truncated
    expect(clampFontSize(Number.NaN)).toBe(FONT_SIZE_DEFAULT);
  });

  test("refresh interval clamps into the registered range", () => {
    expect(clampRefreshInterval(10)).toBe(REFRESH_MIN_MS);
    expect(clampRefreshInterval(999_999)).toBe(REFRESH_MAX_MS);
    expect(clampRefreshInterval(Number.NaN)).toBe(REFRESH_DEFAULT_MS);
  });
});

describe("persistence round-trip", () => {
  test("save then load restores the exact settings", async () => {
    const storage = memoryStorage();
    const store = createSettingsStore(storage);
    const settings: AppSettings = {
      gatewayHost: "100.64.0.1",
      gatewayPort: 8787,
      viewerFontSize: 19,
      refreshIntervalMs: 30_000,
    };
    await store.save(settings);
    expect(await store.load()).toEqual(settings);
  });

  test("an empty store loads to defaults (first launch)", async () => {
    const store = createSettingsStore(memoryStorage(null));
    expect(await store.load()).toEqual(deserializeSettings(null));
  });
});

describe("corrupt payload recovery", () => {
  test("invalid JSON falls back to defaults, never throws", () => {
    expect(deserializeSettings("{not json")).toEqual(deserializeSettings(null));
    expect(deserializeSettings("42")).toEqual(deserializeSettings(null));
  });

  test("corruption is field-local: a bad font size keeps a good interval", () => {
    const raw = JSON.stringify({
      viewerFontSize: "huge",
      refreshIntervalMs: 30_000,
      gatewayHost: "gw.local",
      gatewayPort: 8787,
    });
    const settings = deserializeSettings(raw);
    expect(settings.viewerFontSize).toBe(FONT_SIZE_DEFAULT);
    expect(settings.refreshIntervalMs).toBe(30_000);
    expect(settings.gatewayHost).toBe("gw.local");
    expect(settings.gatewayPort).toBe(8787);
  });

  test("an out-of-range persisted value re-clamps on load", () => {
    const settings = deserializeSettings(
      JSON.stringify({ viewerFontSize: 100, refreshIntervalMs: 1 }),
    );
    expect(settings.viewerFontSize).toBe(FONT_SIZE_MAX);
    expect(settings.refreshIntervalMs).toBe(REFRESH_MIN_MS);
  });

  test("serialization clamps before writing (store never persists junk)", () => {
    const parsed = JSON.parse(
      serializeSettings({
        gatewayHost: null,
        gatewayPort: null,
        viewerFontSize: 0,
        refreshIntervalMs: -5,
      }),
    ) as Record<string, number>;
    expect(parsed.viewerFontSize).toBe(FONT_SIZE_MIN);
    expect(parsed.refreshIntervalMs).toBe(REFRESH_MIN_MS);
  });

  test("a throwing storage read still loads defaults", async () => {
    const store = createSettingsStore({
      read: () => Promise.reject(new Error("keychain locked")),
      write: () => Promise.reject(new Error("keychain locked")),
    });
    expect(await store.load()).toEqual(deserializeSettings(null));
  });
});
