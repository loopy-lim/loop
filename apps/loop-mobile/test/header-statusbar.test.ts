/**
 * Status-bar-substitute header contract (task `header-statusbar-redesign`,
 * operator directive): the top chrome lives IN the status-bar zone instead
 * of below it — the system Dynamic Island stays the only centered element,
 * the title anchors left, action icons anchor right, and no app content
 * ever flows under the island. Machine-pinned by source inspection
 * (react-native does not load under the test runtime, same rule as every
 * other suite here).
 *
 * Gates:
 * 1. Inset-driven zone: ui/AppHeader consumes useSafeAreaInsets and sizes
 *    itself to the status zone (height = top inset, horizontal insets on
 *    the zone) — no hardcoded status-bar clearance anywhere.
 * 2. Island flanks: the reserved middle (ISLAND_RESERVE) sits between the
 *    leading and action slots in JSX order; the leading slot is flexible
 *    with minWidth 0 and the title truncates (numberOfLines 1 + shrink);
 *    the action slot never shrinks — content flows AROUND the island.
 * 3. Every header screen uses it: the chats home rides the shared Screen's
 *    header slot (the header then owns the top inset) and the conversation
 *    renders AppHeader directly; no bespoke header row remains.
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

describe("inset-driven zone — the header replaces the status bar, it clears nothing", () => {
  test("AppHeader consumes useSafeAreaInsets: top inset is the zone height, horizontal insets ride the zone", () => {
    expect(headerSource).toContain("useSafeAreaInsets()");
    expect(headerSource).toContain("height: insets.top");
    expect(headerSource).toContain("paddingLeft: insets.left");
    expect(headerSource).toContain("paddingRight: insets.right");
  });

  test("no hardcoded status-bar clearance survives on header screens", () => {
    // conversation content no longer pads below the status bar by hand
    expect(conversationSource).not.toContain("paddingTop: insets.top");
    // the shared Screen drops its own top padding when a header owns it
    expect(screenSource).toContain("props.header !== undefined ? 0 : insets.top");
  });
});

describe("island flanks — content flows left/right around the reserved middle", () => {
  test("the reserved middle sits between the leading and action slots", () => {
    const leadingAt = headerSource.indexOf("styles.leading");
    const islandAt = headerSource.indexOf("styles.island");
    const actionsAt = headerSource.indexOf("styles.actions");
    expect(leadingAt).toBeGreaterThan(-1);
    expect(islandAt).toBeGreaterThan(leadingAt);
    expect(actionsAt).toBeGreaterThan(islandAt);
  });

  test("the reserve is a registered constant, not an inline literal", () => {
    expect(headerSource).toContain("export const ISLAND_RESERVE");
    expect(headerSource).toContain("width: ISLAND_RESERVE");
    expect(headerSource).toMatch(/ISLAND_RESERVE = \d+;\n/);
  });

  test("the leading flank shrinks before the island is ever reached", () => {
    expect(headerSource).toMatch(/leading:\s*\{[^}]*flex: 1[^}]*minWidth: 0/);
    expect(headerSource).toMatch(/island:\s*\{[^}]*flexShrink: 0/);
    expect(headerSource).toMatch(/actions:\s*\{[^}]*flexShrink: 0/);
    // the title truncates inside its flank — it cannot push content under
    // the island
    expect(headerSource).toContain("numberOfLines={1}");
    expect(headerSource).toMatch(/title:\s*\{\s*\.\.\.type\.title,[^}]*flexShrink: 1/);
  });
});

describe("every header screen uses the one header", () => {
  test("chats home: App hands the AppHeader to the shared Screen's header slot", () => {
    expect(appSource).toContain("<AppHeader");
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
