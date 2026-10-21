/**
 * Shell — the connected app chrome (rebuild brief §3): three tab roots, each
 * owning a ScreenStack push layer. Tab roots stay mounted across switches
 * (a tab keeps its scroll, composer, and stack — the native tab-controller
 * contract; the old instant-swap mount was part of the "not native" verdict),
 * hidden roots are opacity-0 and touch-transparent. Transitions and the edge
 * back gesture live in ScreenStack; the tab bar owns haptics.
 */

import { useCallback, useReducer, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { copy } from "../copy";
import { AgentScreen } from "../screens/AgentScreen";
import { HerdScreen } from "../screens/HerdScreen";
import { NewAgentSheet } from "../features/NewAgentSheet";
import { PanesScreen } from "../screens/PanesScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { TerminalScreen } from "../screens/TerminalScreen";
import { Hairline } from "../design/primitives";
import {
  initialRouterState,
  routerReducer,
  topRoute,
  type Route,
  type RouterState,
  type TabName,
} from "./router";
import { useHerdrState, useStore } from "./storeContext";
import { impactLight } from "../ui/haptics";
import { Icon } from "../ui/Icon";
import type { IconRole } from "../ui/glyphs";
import { ScreenStack, type StackEntry } from "../ui/ScreenStack";
import { colors, space, type as typeScale } from "../ui/tokens";

const TABS: { name: TabName; role: IconRole; label: string }[] = [
  { name: "herd", role: "tabChats", label: copy.tabHerd },
  { name: "panes", role: "tabPanes", label: copy.tabPanes },
  { name: "settings", role: "tabSettings", label: copy.tabSettings },
];

function routeKey(route: Route): string {
  return `${route.name}:${route.paneId}`;
}

export function Shell(props: { onLogout: () => void }) {
  const [router, dispatch] = useReducer(
    (state: RouterState, action: Parameters<typeof routerReducer>[1]) =>
      routerReducer(state, action),
    undefined,
    () => initialRouterState("herd"),
  );
  const state = useHerdrState();
  const store = useStore();
  const [newAgentVisible, setNewAgentVisible] = useState(false);
  const top = topRoute(router);

  const pop = useCallback((): void => dispatch({ type: "pop" }), []);
  const openAgent = useCallback((paneId: string): void => {
    impactLight();
    dispatch({ type: "push", route: { name: "agent", paneId } });
  }, []);
  const openTerminal = useCallback((paneId: string): void => {
    impactLight();
    dispatch({ type: "push", route: { name: "terminal", paneId } });
  }, []);
  const switchTab = useCallback((tab: TabName): void => {
    impactLight();
    dispatch({ type: "switchTab", tab });
  }, []);

  const renderTabRoot = (name: TabName): ReactNode => {
    if (name === "herd") {
      return (
        <HerdScreen
          state={state}
          onOpenAgent={openAgent}
          onNewAgent={() => setNewAgentVisible(true)}
        />
      );
    }
    if (name === "panes") {
      return <PanesScreen state={state} onOpenPane={openTerminal} />;
    }
    return <SettingsScreen state={state} onLogout={props.onLogout} />;
  };

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        {TABS.map((tab) => {
          const active = router.tab === tab.name;
          const stack = router.stacks[tab.name];
          return (
            <View
              key={tab.name}
              style={[styles.tabRoot, !active && styles.tabHidden]}
              pointerEvents={active ? "auto" : "none"}
              accessibilityElementsHidden={!active}
              importantForAccessibility={active ? "yes" : "no-hide-descendants"}
            >
              {renderTabRoot(tab.name)}
              <ScreenStack
                entries={stack.map((route) => ({ key: routeKey(route), onBack: pop }))}
                render={(entry) => {
                  const route = stack.find((candidate) => routeKey(candidate) === entry.key);
                  if (route === undefined) return null;
                  return route.name === "agent" ? (
                    <AgentScreen paneId={route.paneId} state={state} onBack={pop} />
                  ) : (
                    <TerminalScreen paneId={route.paneId} state={state} onBack={pop} />
                  );
                }}
              />
            </View>
          );
        })}
      </View>

      {top === null ? (
        <>
          <Hairline />
          <TabBar tab={router.tab} onSwitch={switchTab} />
        </>
      ) : null}

      <NewAgentSheet
        visible={newAgentVisible}
        onClose={() => setNewAgentVisible(false)}
        state={state}
        store={store}
        onStarted={openAgent}
      />
    </View>
  );
}

function TabBar(props: { tab: TabName; onSwitch: (tab: TabName) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, space.s) }]}>
      {TABS.map((tab) => {
        const active = props.tab === tab.name;
        return (
          <Pressable
            key={tab.name}
            onPress={() => props.onSwitch(tab.name)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
          >
            <Icon role={tab.role} size={typeScale.title.fontSize} color={active ? colors.accent : colors.inkFaint} />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  stage: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  tabRoot: {
    ...StyleSheet.absoluteFillObject,
  },
  tabHidden: { opacity: 0 },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.bg,
    paddingTop: space.s,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingVertical: space.xs,
  },
  tabLabel: {
    ...typeScale.caption,
    color: colors.inkFaint,
  },
  tabLabelActive: { color: colors.accent },
});
