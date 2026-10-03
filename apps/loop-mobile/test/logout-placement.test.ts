/**
 * Logout placement contract (task `header-statusbar-redesign`, superseding
 * the `logout-relocation-polish` list-footer): logout is a destructive,
 * low-frequency action, so its UI placement is machine-pinned the same way
 * the visibility and design-spec contracts are — by source inspection
 * (react-native does not load under the test runtime, same rule as every
 * other suite here).
 *
 * Operator directive: the bottom row rode the home-indicator corner, where
 * the rounded screen edges clip it, so the control moved to the chats
 * header's right corner (the status-bar-substitute zone).
 *
 * Three gates:
 * 1. No bottom row: run-list renders no logout control at all — the list
 *    is high-frequency surface and carries no destructive control.
 * 2. Header corner: App composes the chats header (ui/AppHeader via the
 *    shared Screen's header slot) and the logout icon is the header's
 *    right-corner action — a small glyph on the 44pt touch floor.
 * 3. Mis-tap safe: the icon only opens the confirmation Alert; the
 *    handler is reachable exclusively through the destructive alert
 *    button, and it stays App-owned (credential decision D2-4: keychain
 *    deletion + disconnect).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  APP_TITLE,
  LOGOUT_CONFIRM_CANCEL,
  LOGOUT_CONFIRM_MESSAGE,
  LOGOUT_CONFIRM_TITLE,
  LOGOUT_LABEL,
} from "../src/ui/copy";

const mobileRoot = join(import.meta.dir, "..");
const appSource = readFileSync(join(mobileRoot, "src/App.tsx"), "utf8");
const runListSource = readFileSync(join(mobileRoot, "src/features/run-list.tsx"), "utf8");
const submitSource = readFileSync(join(mobileRoot, "src/screens/SubmitScreen.tsx"), "utf8");

describe("no bottom row — the list surface carries no destructive control", () => {
  test("run-list renders no logout row, prop, or confirmation plumbing", () => {
    expect(runListSource).not.toContain("LOGOUT_");
    expect(runListSource).not.toContain("onLogout");
    expect(runListSource).not.toContain("confirmLogout");
    expect(runListSource).not.toContain("Alert");
    expect(runListSource).not.toContain("footer");
  });

  test("no screen forwards an onLogout prop into the list", () => {
    expect(submitSource).not.toContain("onLogout");
  });

  test("the handler stays App-owned (keychain deletion + disconnect, D2-4)", () => {
    expect(appSource).toContain("await store.clear()");
    expect(appSource).toContain('setPhase("manual")');
  });
});

describe("header corner — the icon lives in the status-bar-substitute zone", () => {
  test("App composes the chats header (AppHeader) with the logout icon as its action", () => {
    expect(appSource).toContain("<AppHeader");
    expect(appSource).toContain("title={APP_TITLE}");
    expect(appSource).toContain("actions={<LogoutButton onPress={logout} />}");
    // the header rides the shared Screen's header slot (top inset owner)
    expect(appSource).toContain("header={");
  });

  test("the icon is a small quiet glyph on the 44pt touch floor", () => {
    expect(appSource).toContain("{glyph.logout}");
    expect(appSource).toMatch(/logoutButton:\s*\{[^}]*minWidth: 44/);
    expect(appSource).toMatch(/logoutButton:\s*\{[^}]*minHeight: 44/);
    expect(appSource).toMatch(
      /logoutGlyph:\s*\{\s*\.\.\.type\.title,\s*color: colors\.inkMute\s*\}/,
    );
  });

  test("phrases are owned copy constants (ui-ux-guidance §7)", () => {
    expect(APP_TITLE.length).toBeGreaterThan(0);
    expect(LOGOUT_LABEL.length).toBeGreaterThan(0);
    expect(LOGOUT_CONFIRM_TITLE.length).toBeGreaterThan(0);
    expect(LOGOUT_CONFIRM_MESSAGE.length).toBeGreaterThan(0);
    expect(LOGOUT_CONFIRM_CANCEL.length).toBeGreaterThan(0);
  });
});

describe("mis-tap safe — the handler is reachable only through the confirmation", () => {
  test("the icon press opens Alert.alert; no direct pass-through of the handler", () => {
    expect(appSource).toContain("Alert.alert(");
    // the raw handler is handed over exactly once — as LogoutButton's prop;
    // no TouchableOpacity presses it directly
    expect((appSource.match(/onPress=\{logout\}/g) ?? []).length).toBe(1);
    expect(appSource).toContain('style: "destructive"');
    expect(appSource).toContain('style: "cancel"');
  });

  test("the destructive button is the sole onPress path to the handler", () => {
    const alert = appSource.slice(appSource.indexOf("Alert.alert("));
    expect(alert).toContain("onPress: logout");
    // the icon's TouchableOpacity presses confirmLogout, not the handler
    expect(appSource).toContain("onPress={confirmLogout(props.onPress)}");
  });
});
