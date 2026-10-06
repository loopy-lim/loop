/**
 * Side menu (drawer) policy + model (task `mobile-ux-patterns`) — the
 * hamburger menu's closed vocabulary and its drag-to-close decision
 * math. No react-native import: ui/DrawerMenu.tsx renders it; tests pin
 * it without a device.
 *
 * Why a drawer at all (brief §4 corollary): detail surfaces hide the tab
 * bar, so from a conversation or raw pane the Settings destination costs
 * back → tab. The drawer is the ONE auxiliary surface reachable from
 * every chrome screen — each header's hamburger opens it. It is a second
 * access path to the SAME three destinations, never a third destination
 * (canon §3: the navigation vocabulary stays one).
 */
import { CHATS_HEADING, FILES_REPORTS_LABEL, SETTINGS_TITLE } from "../ui/copy";
import { type IconRole } from "../ui/glyphs";

export type DrawerKey = "chats" | "files" | "settings";

export interface DrawerItem {
  readonly key: DrawerKey;
  /** Registered icon role (ui/glyphs.ts) — the SAME marks as the tab
   * bar, never a second vocabulary (canon §3). */
  readonly icon: IconRole;
  readonly label: string;
}

/** The closed destination set — EXACTLY the tab bar's three keys, same
 * order, same icon roles (canon §3 아이콘 어휘). */
export const DRAWER_ITEMS: readonly DrawerItem[] = [
  { key: "chats", icon: "tabChats", label: CHATS_HEADING },
  { key: "files", icon: "tabFiles", label: FILES_REPORTS_LABEL },
  { key: "settings", icon: "tabSettings", label: SETTINGS_TITLE },
];

/** Drawer panel width as a fraction of the screen width: a left sheet
 * that never covers the full screen — the remaining right strip keeps
 * the covered screen visible, which is what makes the drawer read as a
 * layer and not a page. */
export const DRAWER_WIDTH_FRACTION = 0.78;

/** Leftward drag distance (fraction of screen width) past which a
 * release closes the drawer. */
export const DRAWER_CLOSE_FRACTION = 0.25;

/** Leftward fling speed (pt/s) that closes regardless of distance. */
export const DRAWER_FLING_VELOCITY = 800;

/** Minimum travel for a fling to count (pt). */
export const DRAWER_FLING_MIN_DISTANCE = 24;

export type DrawerDragDecision = "close" | "stay";

/** Resolve the drag when the finger lifts. Inputs are raw gesture values:
 * the drag delta (px, negative = leftward), the per-second velocity
 * (negative = leftward), and the screen width. A decisive leftward fling
 * closes; a slow drag past a quarter width closes; everything else stays
 * open and springs back. */
export function resolveDrawerDrag(args: {
  dx: number;
  vx: number;
  width: number;
}): DrawerDragDecision {
  const { dx, vx, width } = args;
  if (dx <= -width * DRAWER_CLOSE_FRACTION) return "close";
  if (vx <= -DRAWER_FLING_VELOCITY && dx <= -DRAWER_FLING_MIN_DISTANCE) return "close";
  return "stay";
}

/** The panel's translation during an active drag: only leftward (the
 * close direction) moves the panel; rightward pulls against rest. */
export function drawerDragTranslate(dx: number): number {
  return Math.min(0, dx);
}
