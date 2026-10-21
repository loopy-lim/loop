/**
 * Router — a tiny typed navigation state machine (rebuild brief §5: 형식화된
 * 스택+탭). No navigation library: the app has exactly one push stack per
 * tab; routes are data, transitions are pure functions, and the reducer is
 * unit-testable without react-native.
 *
 * Native-motion pass (2026-10-21): each tab owns its stack and tab switches
 * preserve it — an iOS UITabBarController keeps every tab's navigation state,
 * and resetting on switch was one of the "not native" tells.
 */

export type TabName = "herd" | "panes" | "settings";

export type Route =
  | { name: "agent"; paneId: string }
  | { name: "terminal"; paneId: string };

export type RouterState = {
  tab: TabName;
  stacks: Record<TabName, Route[]>;
};

export type RouterAction =
  | { type: "switchTab"; tab: TabName }
  | { type: "push"; route: Route }
  | { type: "pop" }
  | { type: "popToRoot" };

function emptyStacks(): Record<TabName, Route[]> {
  return { herd: [], panes: [], settings: [] };
}

export function initialRouterState(tab: TabName = "herd"): RouterState {
  const stacks = emptyStacks();
  return { tab, stacks };
}

export function routerReducer(state: RouterState, action: RouterAction): RouterState {
  switch (action.type) {
    case "switchTab":
      if (state.tab === action.tab) return state;
      return { ...state, tab: action.tab };
    case "push":
      return {
        ...state,
        stacks: { ...state.stacks, [state.tab]: [...state.stacks[state.tab], action.route] },
      };
    case "pop": {
      const stack = state.stacks[state.tab];
      if (stack.length === 0) return state;
      return { ...state, stacks: { ...state.stacks, [state.tab]: stack.slice(0, -1) } };
    }
    case "popToRoot": {
      const stack = state.stacks[state.tab];
      if (stack.length === 0) return state;
      return { ...state, stacks: { ...state.stacks, [state.tab]: [] } };
    }
    default:
      return state;
  }
}

/** The active tab's topmost route (or null at the tab root). */
export function topRoute(state: RouterState): Route | null {
  const stack = state.stacks[state.tab];
  return stack[stack.length - 1] ?? null;
}
