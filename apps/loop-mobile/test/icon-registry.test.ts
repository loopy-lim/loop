/**
 * Icon registry gates (task `fab-icons`, canon v3: docs/design/
 * design-system.md §3 탐색과 아이콘): the closed role set stays closed,
 * every text glyph stays pinned to TEXT presentation (the v2 emoji bug —
 * a bare ⚠ rendered as ⚠️ through the emoji font — must never regress),
 * and the iOS SF Symbol path stays wired to the native view.
 *
 * Source-inspection rules match the other suites: react-native does not
 * load under the test runtime, so component wiring is pinned by reading
 * the sources, while the registry itself is a pure module.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { TEXT_PRESENTATION, glyph, icon, type IconRole } from "../src/ui/glyphs";

const mobileRoot = join(import.meta.dir, "..");
const read = (path: string): string => readFileSync(join(mobileRoot, path), "utf8");

function filesUnder(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

describe("icon registry — the closed role set (canon §3, v3)", () => {
  test("every role carries both render paths", () => {
    for (const role of Object.keys(icon) as IconRole[]) {
      const entry = icon[role];
      expect(entry.text.length, role).toBeGreaterThan(1);
      expect(entry.text.endsWith(TEXT_PRESENTATION), `${role} is VS15-pinned`).toBe(true);
      if (entry.sf !== null) {
        expect(entry.sf.length, `${role} has an SF Symbol`).toBeGreaterThan(0);
        expect(entry.sf, `${role}'s SF Symbol name is registry-clean`).toMatch(/^[a-z0-9.]+$/);
      }
    }
  });

  test("the derived text view (glyph) matches the registry 1:1", () => {
    for (const role of Object.keys(icon) as IconRole[]) {
      expect(glyph[role]).toBe(icon[role]?.text);
    }
  });

  test("inline-text-only roles are exactly bullet and cursor (no fake SF names)", () => {
    const inlineOnly = Object.entries(icon)
      .filter(([, entry]) => entry.sf === null)
      .map(([role]) => role);
    expect(inlineOnly.toSorted()).toEqual(["bullet", "cursor"]);
  });

  test("the spawn FAB role is registered with the plus mark", () => {
    expect(icon.spawn.sf).toBe("plus");
    expect(icon.spawn.text.startsWith("+")).toBe(true);
  });

  test("emoji-presentation codepoints are pinned in the registry values", () => {
    // The v2 bug: U+26A0 (⚠) defaults to emoji presentation on iOS. The
    // pinning helper must have caught EVERY value — assert the specific
    // offenders render only as ⚠\u{FE0E}.
    expect(icon.attention.text).toBe(`⚠${TEXT_PRESENTATION}`);
    expect(icon.menu.text).toBe(`☰${TEXT_PRESENTATION}`);
    expect(icon.tabSettings.text).toBe(`⚙${TEXT_PRESENTATION}`);
    expect(icon.logout.text).toBe(`⏻${TEXT_PRESENTATION}`);
  });
});

describe("emoji-presentation leakage — nothing renders through the emoji font", () => {
  test("VS16 (emoji presentation selector) appears nowhere in the app sources", () => {
    for (const [file, source] of filesUnder(join(mobileRoot, "src"), [".ts", ".tsx"]).map(
      (path) => [path, readFileSync(path, "utf8")] as [string, string],
    )) {
      expect(source.includes("\u{FE0F}"), file).toBe(false);
    }
  });
});

describe("iOS SF Symbol render path — the native LoopIcon view stays wired", () => {
  test("ui/Icon.tsx registers the native component and rides the registry", () => {
    const source = read("src/ui/Icon.tsx");
    expect(source).toContain('requireNativeComponent<LoopIconNativeProps>("LoopIcon")');
    expect(source).toContain('import { icon, type IconRole } from "./glyphs"');
    expect(source).toContain("entry.sf");
  });

  test("the native view + bridge exist and are members of the Xcode target", () => {
    expect(existsSync(join(mobileRoot, "ios/LoopMobile/LoopIcon.swift"))).toBe(true);
    expect(existsSync(join(mobileRoot, "ios/LoopMobile/LoopIconBridge.m"))).toBe(true);
    const project = read("ios/LoopMobile.xcodeproj/project.pbxproj");
    expect(project).toContain("LoopIcon.swift in Sources");
    expect(project).toContain("LoopIconBridge.m in Sources");
  });

  test("chrome icons render through Icon — no raw DynText glyph marks remain", () => {
    const chromeFiles = [
      "src/ui/TabBar.tsx",
      "src/ui/DrawerMenu.tsx",
      "src/App.tsx",
      "src/screens/SettingsScreen.tsx",
      "src/screens/RunScreen.tsx",
      "src/features/run-list.tsx",
      "src/features/spawn-fab.tsx",
    ];
    for (const file of chromeFiles) {
      const source = read(file);
      expect(source, file).toContain("<Icon");
      for (const role of [
        "menu",
        "back",
        "logout",
        "attention",
        "attach",
        "send",
        "remove",
        "copy",
        "statusRunning",
        "statusDone",
        "statusError",
        "statusDot",
        "spawn",
        "tabChats",
        "tabFiles",
        "tabSettings",
      ]) {
        expect(source, `${file} renders {glyph.${role}} directly`).not.toContain(`glyph.${role}`);
      }
    }
  });
});

describe("spawn FAB — the card is gone, the floating action stays honest", () => {
  test("the spawn card was replaced by the FAB (no dual surface)", () => {
    expect(existsSync(join(mobileRoot, "src/features/spawn-card.tsx"))).toBe(false);
    const screen = read("src/screens/SubmitScreen.tsx");
    expect(screen).toContain("<SpawnFab");
    expect(screen).not.toContain("SpawnSessionCard");
  });

  test("the FAB keeps the flow's states above the button", () => {
    const fab = read("src/features/spawn-fab.tsx");
    expect(fab).toContain('status.kind === "busy" ? "busy" : "spawn"');
    expect(fab).toContain("accessibilityLabel={SPAWN_TUI_LABEL}");
    expect(fab).toContain("width: 56");
    expect(fab).toContain("height: 56");
    expect(fab).toContain("SPAWN_TUI_SPAWNING");
    expect(fab).toContain("SPAWN_TUI_WAITING");
    expect(fab).toContain("SPAWN_TUI_TIMEOUT_PREFIX");
    expect(fab).toContain("SPAWN_TUI_BLOCKED");
    // secondary tier: surface fill + hairline + float elevation — never a
    // second strong emphasis on the composer's viewport (canon §4)
    expect(fab).toContain("colors.surface");
    expect(fab).toContain("colors.hairline");
    expect(fab).toContain("elevation.float");
  });
});
