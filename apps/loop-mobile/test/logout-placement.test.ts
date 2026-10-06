/**
 * Logout placement contract (task `main-screen-polish`, superseding the
 * chats-header corner): the main list is chrome-free — no LOOP header and
 * no destructive control on the high-frequency surface — and logout lives
 * on the bottom Settings tab as a confirmation-gated row. Machine-pinned
 * by source inspection (react-native does not load under the test runtime,
 * same rule as every other suite here).
 *
 * Gates:
 * 1. No destructive control on the list: run-list and SubmitScreen render
 *    no logout plumbing at all.
 * 2. Chrome-free chats home: App composes the chats Screen WITHOUT an
 *    AppHeader (the LOOP title is gone; the shared Screen clears the top
 *    inset itself, so the list starts under the status zone).
 * 3. Settings path: App passes the confirmation-wrapped handler to
 *    SettingsScreen as `onLogout`, and the settings row is the only
 *    control that fires it (quiet destructive row, danger ink, 44pt floor).
 * 4. Mis-tap safe: the row press only OPENS the confirmation Alert; the
 *    destructive alert button is the sole path to the App-owned handler
 *    (credential decision D2-4: keychain deletion + disconnect).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  LOGOUT_CONFIRM_CANCEL,
  LOGOUT_CONFIRM_MESSAGE,
  LOGOUT_CONFIRM_TITLE,
  LOGOUT_LABEL,
} from "../src/ui/copy";

const mobileRoot = join(import.meta.dir, "..");
const appSource = readFileSync(join(mobileRoot, "src/App.tsx"), "utf8");
const runListSource = readFileSync(join(mobileRoot, "src/features/run-list.tsx"), "utf8");
const submitSource = readFileSync(join(mobileRoot, "src/screens/SubmitScreen.tsx"), "utf8");
const settingsSource = readFileSync(join(mobileRoot, "src/screens/SettingsScreen.tsx"), "utf8");

describe("no destructive control on the list surface", () => {
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

describe("chrome-free chats home — the LOOP header is gone", () => {
  test("the chats Screen composes no AppHeader (the list starts under the status zone)", () => {
    expect(appSource).toContain('<Screen scrollable={false} key="chats">');
    // the header title left the codebase with the header itself
    expect(appSource).not.toContain("APP_TITLE");
    expect(appSource).not.toContain("LogoutButton");
  });
});

describe("settings path — the row is the only control that logs out", () => {
  test("App hands the confirmation-wrapped handler to SettingsScreen", () => {
    expect(appSource).toContain("<SettingsScreen");
    expect(appSource).toContain("onLogout={confirmLogout(logout)}");
    // the raw handler is handed over exactly once — inside the confirm
    // wrapper; no other call site passes it along
    expect((appSource.match(/confirmLogout\(logout\)/g) ?? []).length).toBe(1);
  });

  test("the settings row is a quiet destructive control on the 44pt floor", () => {
    expect(settingsSource).toContain('<Icon role="logout"');
    expect(settingsSource).toContain("onPress={props.onLogout}");
    expect(settingsSource).toContain("accessibilityLabel={LOGOUT_LABEL}");
    expect(settingsSource).toMatch(/logoutRow:\s*\{[^}]*minHeight: 44/);
    expect(settingsSource).toMatch(/logoutText:\s*\{\s*\.\.\.type\.bodyStrong,\s*color:\s*colors\.danger\s*\}/);
  });

  test("phrases are owned copy constants (ui-ux-guidance §7)", () => {
    expect(LOGOUT_LABEL.length).toBeGreaterThan(0);
    expect(LOGOUT_CONFIRM_TITLE.length).toBeGreaterThan(0);
    expect(LOGOUT_CONFIRM_MESSAGE.length).toBeGreaterThan(0);
    expect(LOGOUT_CONFIRM_CANCEL.length).toBeGreaterThan(0);
  });
});

describe("mis-tap safe — the handler is reachable only through the confirmation", () => {
  test("the row press opens Alert.alert; no direct pass-through of the handler", () => {
    expect(appSource).toContain("Alert.alert(");
    expect(appSource).toContain('style: "destructive"');
    expect(appSource).toContain('style: "cancel"');
    // the settings row receives the WRAPPED handler, never the raw one
    expect(settingsSource).not.toMatch(/onPress=\{logout\}/);
  });

  test("the destructive button is the sole onPress path to the handler", () => {
    const alert = appSource.slice(appSource.indexOf("Alert.alert("));
    expect(alert).toContain("onPress: logout");
  });
});
