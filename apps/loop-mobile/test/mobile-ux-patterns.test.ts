/**
 * Mobile UX pattern contracts (task `mobile-ux-patterns`, iOS HIG): the
 * three interaction patterns the task pins, machine-enforced at BOTH
 * layers — the pure gesture decisions (no RN; the components feed raw
 * gesture values in, same contract as bottom-sheet.ts) and the wiring
 * (source inspection; react-native does not load under the test runtime,
 * same rule as every other suite here).
 *
 * Patterns and their screens (inventory: docs/design/audits/
 * mobile-ux-patterns.md):
 * 1. Row swipe actions — chats list (runs + sessions rows), reveal Open.
 *    Pull-to-refresh already rides the same list (C13) and stays pinned.
 * 2. Edge-back swipe — detail surfaces (conversation, raw pane), firing
 *    the SAME onBack the header chevron fires.
 * 3. Side menu (hamburger) — the drawer over every connected surface,
 *    listing exactly the tab bar's three destinations.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ROW_ACTION_WIDTH,
  ROW_FLING_MIN_DISTANCE,
  ROW_FLING_VELOCITY,
  ROW_REVEAL_FRACTION,
  clampRowDrag,
  resolveRowSwipe,
} from "../src/ui/row-swipe";
import {
  BACK_COMMIT_FRACTION,
  BACK_COMMIT_MIN_DISTANCE,
  BACK_EDGE_WIDTH,
  BACK_FLING_MIN_DISTANCE,
  BACK_FLING_VELOCITY,
  backDragTranslate,
  isBackGestureStart,
  resolveBackSwipe,
} from "../src/ui/back-swipe";
import {
  DRAWER_ITEMS,
  DRAWER_WIDTH_FRACTION,
  drawerDragTranslate,
  resolveDrawerDrag,
} from "../src/ui/side-menu";
import { ROW_OPEN_ACTION_LABEL } from "../src/ui/copy";
import { icon } from "../src/ui/glyphs";
import type { TabKey } from "../src/ui/TabBar";

const mobileRoot = join(import.meta.dir, "..");
const read = (path: string): string => readFileSync(join(mobileRoot, path), "utf8");
const appSource = read("src/App.tsx");
const runListSource = read("src/features/run-list.tsx");
const conversationSource = read("src/screens/ConversationScreen.tsx");

const SCREEN_WIDTH = 390;

describe("row swipe — the decision layer (ui/row-swipe.ts)", () => {
  test("the drag rides 1:1 to the action width, then rubber-bands", () => {
    expect(clampRowDrag(0)).toBe(0);
    expect(clampRowDrag(40)).toBe(0); // rightward never reveals
    expect(clampRowDrag(-40)).toBe(-40);
    expect(clampRowDrag(-ROW_ACTION_WIDTH)).toBe(-ROW_ACTION_WIDTH);
    // past the bound: wall, not cliff — the excess shrinks
    const clamped = clampRowDrag(-(ROW_ACTION_WIDTH + 60));
    expect(clamped).toBeLessThan(-ROW_ACTION_WIDTH);
    expect(clamped).toBeGreaterThan(-(ROW_ACTION_WIDTH + 60 * 0.5));
  });

  test("past-half release rests open; shallower snaps closed", () => {
    const line = -ROW_ACTION_WIDTH * ROW_REVEAL_FRACTION;
    expect(resolveRowSwipe({ dx: line, vx: 0 })).toBe("open");
    expect(resolveRowSwipe({ dx: line + 1, vx: 0 })).toBe("closed");
    expect(resolveRowSwipe({ dx: -1, vx: 0 })).toBe("closed");
    expect(resolveRowSwipe({ dx: 0, vx: 0 })).toBe("closed"); // a tap is never a reveal
  });

  test("a decisive leftward fling commits the action outright (quick-open)", () => {
    expect(
      resolveRowSwipe({ dx: -ROW_FLING_MIN_DISTANCE, vx: -ROW_FLING_VELOCITY }),
    ).toBe("commit");
    expect(
      resolveRowSwipe({ dx: -(ROW_FLING_MIN_DISTANCE - 1), vx: -ROW_FLING_VELOCITY * 3 }),
    ).toBe("closed"); // no travel, no commit — a resting tap release
    // below the fling speed the release falls through to the reveal line
    expect(resolveRowSwipe({ dx: -ROW_ACTION_WIDTH * ROW_REVEAL_FRACTION, vx: -ROW_FLING_VELOCITY + 1 })).toBe("open");
    expect(resolveRowSwipe({ dx: -20, vx: -ROW_FLING_VELOCITY + 1 })).toBe("closed");
  });
});

describe("row swipe — the wiring (chats list rows)", () => {
  test("run and session rows render through the ONE SwipeableRow host", () => {
    // task `main-screen-polish`: run rows and session rows share the
    // unified ListRow component — one SwipeableRow host inside it.
    const uses = (runListSource.match(/<SwipeableRow/g) ?? []).length;
    expect(uses).toBe(1);
    expect(runListSource).toContain("onAction={row.onOpen}");
  });

  test("the first actionable row peeks the action open (discoverability)", () => {
    const swipePolicy = read("src/ui/row-swipe.ts");
    expect(swipePolicy).toContain("export const ROW_PEEK_WIDTH");
    expect(swipePolicy).toContain("export const ROW_PEEK_CLOSE_MS");
    const swipeableSource = read("src/ui/SwipeableRow.tsx");
    // the hint mounts partially revealed and settles shut by itself
    expect(swipeableSource).toContain("peek?: boolean");
    expect(swipeableSource).toContain("ROW_PEEK_WIDTH");
    expect(swipeableSource).toContain("ROW_PEEK_CLOSE_MS");
    expect(swipeableSource).toContain("setPeeked(false)");
  });

  test("the revealed action is the owned copy constant — nothing invented", () => {
    expect(ROW_OPEN_ACTION_LABEL.length).toBeGreaterThan(0);
    const swipeableSource = read("src/ui/SwipeableRow.tsx");
    expect(swipeableSource).toContain("ROW_OPEN_ACTION_LABEL");
    // no destructive verb exists in the client contract; the strip must
    // not grow one
    for (const banned of ["Delete", "Cancel", "Remove", "Archive"]) {
      expect(swipeableSource).not.toContain(banned);
    }
  });

  test("the pan never steals the vertical scroll (decisively-horizontal gate)", () => {
    const swipeableSource = read("src/ui/SwipeableRow.tsx");
    expect(swipeableSource).toContain("Math.abs(gesture.dx) > Math.abs(gesture.dy)");
  });

  test("pull-to-refresh stays wired on the chats list (C13)", () => {
    expect(runListSource).toContain("<RefreshControl");
    expect(runListSource).toContain("onRefresh={reload}");
  });
});

describe("edge-back — the decision layer (ui/back-swipe.ts)", () => {
  test("only a left-edge-started touch can ever commit", () => {
    expect(isBackGestureStart(0)).toBe(true);
    expect(isBackGestureStart(BACK_EDGE_WIDTH)).toBe(true);
    expect(isBackGestureStart(BACK_EDGE_WIDTH + 1)).toBe(false);
    expect(isBackGestureStart(-1)).toBe(false);
    // the decision enforces the birthright itself, not by convention
    expect(resolveBackSwipe({ startX: 200, dx: 400, vx: 5000, width: SCREEN_WIDTH })).toBe(
      "cancel",
    );
  });

  test("past ~30% of screen width commits (with the narrow-screen floor)", () => {
    const commitDistance = Math.max(
      SCREEN_WIDTH * BACK_COMMIT_FRACTION,
      BACK_COMMIT_MIN_DISTANCE,
    );
    expect(
      resolveBackSwipe({ startX: 0, dx: commitDistance, vx: 0, width: SCREEN_WIDTH }),
    ).toBe("commit");
    expect(
      resolveBackSwipe({ startX: 0, dx: commitDistance - 1, vx: 0, width: SCREEN_WIDTH }),
    ).toBe("cancel");
  });

  test("a decisive rightward fling commits from closer; everything else cancels", () => {
    expect(
      resolveBackSwipe({
        startX: 0,
        dx: BACK_FLING_MIN_DISTANCE,
        vx: BACK_FLING_VELOCITY,
        width: SCREEN_WIDTH,
      }),
    ).toBe("commit");
    expect(
      resolveBackSwipe({
        startX: 0,
        dx: BACK_FLING_MIN_DISTANCE - 1,
        vx: BACK_FLING_VELOCITY * 5,
        width: SCREEN_WIDTH,
      }),
    ).toBe("cancel"); // no travel, no commit
    expect(
      resolveBackSwipe({ startX: 0, dx: -80, vx: 0, width: SCREEN_WIDTH }),
    ).toBe("cancel"); // leftward is not a back
  });

  test("the drag translation clamps to [0, width] — the screen rides the finger", () => {
    expect(backDragTranslate(-30, SCREEN_WIDTH)).toBe(0);
    expect(backDragTranslate(120, SCREEN_WIDTH)).toBe(120);
    expect(backDragTranslate(SCREEN_WIDTH + 500, SCREEN_WIDTH)).toBe(SCREEN_WIDTH);
  });
});

describe("edge-back — the wiring (detail surfaces)", () => {
  test("the conversation wraps in the back zone and fires the header's onBack", () => {
    expect(conversationSource).toContain("<BackSwipeZone onBack={props.onBack}>");
  });

  test("the raw pane surface rides the zone in App, firing the header's back", () => {
    expect(appSource).toContain("<BackSwipeZone onBack={() => setOpenPaneId(null)}>");
    expect(appSource).toContain("<HeaderBack onPress={() => setOpenPaneId(null)} />");
  });

  test("no back handler, no gesture (the zone renders only with onBack)", () => {
    expect(conversationSource).toContain(
      "props.onBack !== undefined ? (",
    );
  });
});

describe("side menu — the model (ui/side-menu.ts)", () => {
  test("the destination set is exactly the tab bar's three keys, in order", () => {
    const tabKeys: TabKey[] = ["chats", "files", "settings"];
    expect(DRAWER_ITEMS.map((item) => item.key)).toEqual(tabKeys);
  });

  test("every item rides a registered icon role and owned copy", () => {
    const roles = new Set(Object.keys(icon));
    for (const item of DRAWER_ITEMS) {
      expect(roles.has(item.icon), item.key).toBe(true);
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  test("the drawer rows reuse the tab bar's three marks (never a second vocabulary)", () => {
    expect(DRAWER_ITEMS.map((item) => item.icon)).toEqual(["tabChats", "tabFiles", "tabSettings"]);
  });

  test("the panel never covers the full screen", () => {
    expect(DRAWER_WIDTH_FRACTION).toBeLessThan(1);
    expect(DRAWER_WIDTH_FRACTION).toBeGreaterThan(0.5);
  });

  test("drag-left past a quarter width closes; a fling closes; drift stays", () => {
    const closeDistance = SCREEN_WIDTH * 0.25;
    expect(resolveDrawerDrag({ dx: -closeDistance, vx: 0, width: SCREEN_WIDTH })).toBe("close");
    expect(
      resolveDrawerDrag({ dx: -24, vx: -800, width: SCREEN_WIDTH }),
    ).toBe("close");
    expect(resolveDrawerDrag({ dx: -closeDistance + 1, vx: 0, width: SCREEN_WIDTH })).toBe(
      "stay",
    );
    expect(resolveDrawerDrag({ dx: 40, vx: -5000, width: SCREEN_WIDTH })).toBe("stay");
    expect(drawerDragTranslate(40)).toBe(0); // rightward pulls against rest
  });
});

describe("side menu — the wiring (App + headers)", () => {
  test("App renders the drawer over every connected surface", () => {
    expect(appSource).toContain("<DrawerMenu");
    expect((appSource.match(/withDrawer\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test("the drawer's destination rows close the menu and switch the tab", () => {
    expect(appSource).toContain("setMenuOpen(false);");
    expect(appSource).toContain("setTab(key);");
  });

  test("the hamburger rides the registered role on the 44pt touch floor", () => {
    expect(icon.menu.sf).toBe("line.3.horizontal");
    expect(appSource).toContain('<Icon role="menu"');
    expect(appSource).toMatch(/drawerButton:\s*\{[^}]*minWidth: 44/);
    expect(conversationSource).toMatch(/menuButton:\s*\{[^}]*minHeight: 44/);
    expect(conversationSource).toContain('<Icon role="menu"');
  });

  test("App hands the conversation its menu opener", () => {
    expect(appSource).toContain("onOpenMenu={() => setMenuOpen(true)}");
  });

  test("the drawer footer echoes the gateway line — never the bearer", () => {
    expect(appSource).toContain("gatewayLine={gatewayLine(settings)}");
    const line = appSource.slice(appSource.indexOf("function gatewayLine"));
    expect(line).not.toContain("bearer");
    expect(line).toContain("gatewayHost");
  });
});
