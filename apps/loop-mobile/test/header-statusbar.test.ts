/**
 * Top chrome header contract (task `header-statusbar-redesign`, revised by
 * task `conversation-safearea-fix`): the status-bar zone is cleared first
 * and the chrome row renders BELOW it — no app content ever sits inside
 * the status-bar/Dynamic-Island band. Machine-pinned by source inspection
 * (react-native does not load under the test runtime, same rule as every
 * other suite here).
 *
 * Gates:
 * 1. Inset-driven zone: ui/AppHeader consumes useSafeAreaInsets and clears
 *    the status zone with paddingTop = top inset (horizontal insets ride
 *    the zone) — no hardcoded status-bar clearance anywhere, and the old
 *    chrome-inside-the-zone layout (height = insets.top) cannot return.
 * 2. Chrome row: a registered bar height below the cleared zone; the
 *    leading slot is flexible with minWidth 0 and the title truncates
 *    (numberOfLines 1 + shrink); the action slot never shrinks.
 * 3. Every header screen uses it: the Files/Settings tabs and the raw pane
 *    ride the shared Screen's header slot and the conversation renders
 *    AppHeader directly; no bespoke header row remains. The chats home is
 *    chrome-free (task `main-screen-polish`) and clears the inset itself.
 * 4. One quiet separation rule: the zone's single hairline separates
 *    chrome from content (minimal-design-spec S5).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mobileRoot = join(import.meta.dir, "..");
const headerSource = readFileSync(join(mobileRoot, "src/ui/AppHeader.tsx"), "utf8");
const screenSource = readFileSync(join(mobileRoot, "src/ui/Screen.tsx"), "utf8");
const appSource = readFileSync(join(mobileRoot, "src/App.tsx"), "utf8");
const conversationSource = readFileSync(
  join(mobileRoot, "src/screens/ConversationScreen.tsx"),
  "utf8",
);

describe("inset-driven zone — the chrome clears the status zone, it never rides inside it", () => {
  test("AppHeader consumes useSafeAreaInsets: the status zone is cleared with paddingTop, horizontal insets ride the zone", () => {
    expect(headerSource).toContain("useSafeAreaInsets()");
    expect(headerSource).toContain("paddingTop: insets.top");
    expect(headerSource).toContain("paddingLeft: insets.left");
    expect(headerSource).toContain("paddingRight: insets.right");
  });

  test("the chrome row renders below the cleared zone at a registered height — not inside the status band", () => {
    // the old layout (zone height = top inset put the title inside the
    // status-bar/island band) cannot return
    expect(headerSource).not.toContain("height: insets.top");
    expect(headerSource).toContain("export const HEADER_BAR_HEIGHT");
    expect(headerSource).toContain("height: HEADER_BAR_HEIGHT");
    expect(headerSource).toMatch(/HEADER_BAR_HEIGHT = \d+;\n/);
  });

  test("no hardcoded status-bar clearance survives on header screens", () => {
    // conversation content no longer pads below the status bar by hand
    expect(conversationSource).not.toContain("paddingTop: insets.top");
    // the shared Screen drops its own top padding when a header owns it
    expect(screenSource).toContain("props.header !== undefined ? 0 : insets.top");
  });
});

describe("chrome row — title truncates before the actions are ever squeezed", () => {
  test("the leading slot precedes the action slot (title left, actions right)", () => {
    const leadingAt = headerSource.indexOf("styles.leading");
    const actionsAt = headerSource.indexOf("styles.actions");
    expect(leadingAt).toBeGreaterThan(-1);
    expect(actionsAt).toBeGreaterThan(leadingAt);
  });

  test("the leading flank shrinks before the actions are ever reached", () => {
    expect(headerSource).toMatch(/leading:\s*\{[^}]*flex: 1[^}]*minWidth: 0/);
    expect(headerSource).toMatch(/actions:\s*\{[^}]*flexShrink: 0/);
    // the title truncates inside its flank — it cannot push content out
    expect(headerSource).toContain("numberOfLines={1}");
    expect(headerSource).toMatch(/title:\s*\{\s*\.\.\.type\.title,[^}]*flexShrink: 1/);
  });
});

describe("every header screen uses the one header", () => {
  test("chats home is chrome-free (task `main-screen-polish`): no AppHeader — the shared Screen clears the inset itself; the remaining header screens keep the slot", () => {
    expect(appSource).toContain("<AppHeader");
    expect(appSource).not.toContain('title={APP_TITLE}');
    expect(screenSource).toContain("header?: ReactNode");
    expect(screenSource).toContain("{props.header}");
  });

  test("conversation: the screen renders AppHeader directly above its column", () => {
    expect(conversationSource).toContain("<AppHeader");
    const headerAt = conversationSource.indexOf("<AppHeader");
    const columnAt = conversationSource.indexOf("styles.column");
    expect(headerAt).toBeGreaterThan(-1);
    expect(columnAt).toBeGreaterThan(headerAt);
  });

  test("no bespoke header row remains in the conversation screen", () => {
    expect(conversationSource).not.toContain("styles.headerRow");
    expect(conversationSource).not.toContain("headerRow:");
    expect(conversationSource).not.toContain("headerTitles");
  });
});

describe("one quiet separation rule under the chrome (minimal-design-spec S5)", () => {
  test("the zone carries a single hairline bottom border", () => {
    expect(headerSource).toContain("borderBottomWidth: StyleSheet.hairlineWidth");
    expect(headerSource).toContain("borderBottomColor: colors.hairline");
  });

  test("the bar rides the centered column geometry (title aligns with content)", () => {
    expect(headerSource).toContain("maxWidth: COLUMN_MAX_WIDTH");
    expect(headerSource).toContain("paddingHorizontal: COLUMN_GUTTER");
  });
});
