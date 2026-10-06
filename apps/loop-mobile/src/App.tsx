import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Alert, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { createGatewayCredentialStore } from "./auth/credentialStore";
import { gatewayKeychain } from "./auth/keychain";
import { parsePairUrl } from "./auth/pairing";
import { describeConnectFailure, restoreSession } from "./auth/restore";
import { createConnectionConfig, parseBaseUrl, type ConnectionConfig } from "./auth/connection";
import { GatewayClient } from "./gateway-client/client";
import { probeGateway } from "./gateway-client/probe";
import { SessionNamingIndex } from "./state/sessionsView";
import { createSettingsStore, defaultSettings, type AppSettings } from "./state/settings";
import { settingsKeychainStorage } from "./auth/settingsKeychainStorage";
import { ConnectScreen } from "./screens/ConnectScreen";
import { ConversationScreen } from "./screens/ConversationScreen";
import { PaneScreen } from "./screens/PaneScreen";
import { QRScannerScreen } from "./screens/QRScannerScreen";
import { RunSplitScreen } from "./screens/RunSplitScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SubmitScreen } from "./screens/SubmitScreen";
import { Screen } from "./ui/Screen";
import { AppHeader } from "./ui/AppHeader";
import { BackSwipeZone } from "./ui/BackSwipeZone";
import { DrawerMenu, type DrawerKey } from "./ui/DrawerMenu";
import { TabBar, type TabKey } from "./ui/TabBar";
import { Icon } from "./ui/Icon";
import {
  LOGOUT_CONFIRM_CANCEL,
  LOGOUT_CONFIRM_MESSAGE,
  LOGOUT_CONFIRM_TITLE,
  LOGOUT_LABEL,
  FILES_REPORTS_LABEL,
  SETTINGS_TITLE,
  TERMINAL_TITLE,
} from "./ui/copy";
import { colors, press, type } from "./ui/tokens";
import { showcaseFromProps, type ShowcaseConfig } from "./showcase";

/**
 * Screen wiring (GUI conversation v1, decision 2026-xx-gui-conversation D6:
 * the conversation view is the primary run surface; the pane terminal view
 * is the secondary "raw" toggle). Connection -> chats (submit + runs/sessions
 * list) -> conversation (timeline + composer with mid-run steer); the raw
 * toggle opens the existing PaneScreen and returns.
 *
 * One-time sign-in (decision 2026-xx-app-credential-persistence.md D2):
 * launch restores the stored keychain credential and auto-connects; a failed
 * auto-connect falls back to the manual Connect screen WITHOUT deleting the
 * stored entry; a successful connect (manual or restored) is what persists
 * the credential; "Log out" deletes it immediately and returns to the manual
 * screen — it lives on the bottom Settings tab as a confirmation-gated row
 * (task `main-screen-polish`; the chats home is chrome-free, and the header
 * corner it briefly occupied went away with the LOOP header). The bearer and
 * base URL exist only inside GatewayClient's in-memory config between
 * connects; the token is never logged or rendered.
 *
 * Safe area (task `ui-codex-redesign`): the root is a SafeAreaProvider; the
 * shared Screen wrapper and ConversationScreen consume the insets (status
 * bar top, home indicator bottom, landscape notch sides). The root paints
 * the dark background edge-to-edge and pins a light status bar to match.
 */
export function App(props: { showcase?: ShowcaseConfig } | undefined) {
  const showcase = showcaseFromProps(props);
  const [client, setClient] = useState<GatewayClient | null>(null);
  /** Open chat: by correlated run id, or directly by session id. */
  const [chat, setChat] = useState<{ runId?: string; sessionId?: string } | null>(null);
  const [openPaneId, setOpenPaneId] = useState<string | null>(null);
  // Session naming evidence (operator-approved title rule): one app-local
  // fold per connection lifetime. The conversation view feeds it; the chats
  // list and the timeline header read it. Pure state — no network, no model.
  const naming = useMemo(() => new SessionNamingIndex(), []);
  const store = useMemo(() => createGatewayCredentialStore(gatewayKeychain), []);
  const [phase, setPhase] = useState<"restoring" | "manual" | "connected">("restoring");
  // App settings (split-viewer design §B): loaded once at launch, edited on
  // the settings screen, persisted through the keychain-backed store.
  const settingsStore = useMemo(() => createSettingsStore(settingsKeychainStorage), []);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  // Tab navigation (task `redesign-implement`, direction A): the three
  // destinations live in one bottom tab bar; detail surfaces (conversation,
  // raw pane, scanner) hide it and carry the header back chevron instead
  // (brief §4 재판정 — 하단은 옳고, pill은 틀렸다).
  const [tab, setTab] = useState<TabKey>("chats");
  // Side menu (task `mobile-ux-patterns`): the drawer is the one
  // auxiliary surface reachable from every chrome screen — headers open
  // it, and its destination rows jump the tab bar's SAME three keys
  // (a second access path, never a third destination).
  const [menuOpen, setMenuOpen] = useState(false);
  /** Most recently opened run — the split viewer's left tree survives a
   * trip back to the chats list (the chat itself is closed there). */
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  /** Connect-screen prefill from saved credentials or a dropped session. */
  const [prefill, setPrefill] = useState<{ host?: string; port?: string } | undefined>(undefined);
  /** In-app camera QR scanner (task `mobile-safearea-qr-scan`): open from
   * the Connect screen; an accepted scan funnels through the SAME adopted
   * connection path as the deep link (probe → connect → persist). */
  const [scanOpen, setScanOpen] = useState(false);
  /** Non-blocking notice for auto-connect/restore failures (no token ever). */
  const [notice, setNotice] = useState<string | null>(null);
  /** Remote spawn learned gate (decision 2026-xx-session-spawn §D-D): the
   * contract has no capability discovery, so "spawn gated off" is learned
   * from the gateway's `spawn_disabled`/`not_found` problem — once learned
   * it holds for the CONNECTION lifetime (reset on logout/connect), not per
   * screen mount. App owns it because App owns the connection. */
  const [spawnBlocked, setSpawnBlocked] = useState(false);

  /** Record the gateway connection into settings (§B display row) after a
   * successful connect; a failed write only costs the persisted display. */
  const rememberGatewayInSettings = useCallback(
    (config: ConnectionConfig) => {
      const { host, port } = parseBaseUrl(config.baseUrl);
      setSettings((current) => {
        const next = { ...current, gatewayHost: host, gatewayPort: port };
        settingsStore.save(next).catch(() => undefined);
        return next;
      });
    },
    [settingsStore],
  );

  /** The single connection path: verify against the gateway, persist only
   * after success, then hand the client to the UI. Manual sign-in, showcase
   * auto-connect, and relaunch restore all funnel through here. Never
   * throws: failures land back on the manual screen with a notice. */
  const connectDriven = useRef(false);
  const adoptConfig = useCallback(
    async (config: ConnectionConfig): Promise<void> => {
      void (async () => {
        try {
          await probeGateway(config);
        } catch (error) {
          setNotice(describeConnectFailure(error));
          setPrefill(prefillOf(config));
          return;
        }
        // Persist the verified connection in BOTH modes (credential decision
        // D1 puts host:port in the same keychain item as the bearer; QR
        // pairing decision §3.2 requires the tokenless relaunch to restore
        // the saved host:port). The store writes the bearer for fallback and
        // the tokenless mode marker otherwise — never secret material for a
        // tokenless connect (tokenless decision §D-A3: there is none). A
        // failed write stays connected memory-only; the next launch falls
        // back to the manual screen with this host prefilled.
        try {
          await store.save(config);
        } catch {
          // Stay connected memory-only, retry on next sign-in.
        }
        // Tokenless connect (decision 2026-xx-tokenless-auth-and-app-layout
        // §D-A3): there is no secret to persist — the keychain is the
        // bearer-fallback store only.
        setNotice(null);
        setPrefill(prefillOf(config));
        setClient(new GatewayClient(config));
        setSpawnBlocked(false); // a fresh connection re-asks the spawn gate
        setPhase("connected");
        rememberGatewayInSettings(config);
        // One successful connection exhausts the showcase auto-connect: after
        // a later logout the manual screen must STAY manual (no re-login).
        connectDriven.current = true;
      })();
    },
    [store, rememberGatewayInSettings],
  );

  // Relaunch restore (D2-2/D2-3): fire once; showcase auto-connect drives its
  // own path instead. Keychain read failure lands on the manual screen too.
  const restoreFired = useRef(false);
  useEffect(() => {
    if (restoreFired.current) return;
    restoreFired.current = true;
    if (showcase?.autoConnect === true) {
      setPhase("manual");
      return;
    }
    restoreSession({ store, connect: (config) => probeGateway(config) })
      .then((outcome) => {
        if (outcome.kind === "restored") {
          setClient(new GatewayClient(outcome.config));
          setSpawnBlocked(false);
          setPhase("connected");
        } else if (outcome.kind === "fallback") {
          setNotice(outcome.reason);
          setPrefill(prefillOf(outcome.config));
          setPhase("manual");
        } else {
          setPhase("manual");
        }
      })
      .catch(() => setPhase("manual"));
    // Run once on mount; the showcase config is launch-time immutable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // QR pairing deep link (decision 2026-xx-qr-pairing D-B): the OS delivers
  // the scanned payload as a launch URL (AppDelegate → initialProps). Parse
  // it, prefill the connect form, and drive the ONE connection path (probe →
  // connect → persist). A rejected payload or failed probe lands on the
  // manual screen WITH the scanned host/port prefilled — never silently
  // connected, never cleared. Runs once, after the restore attempt settles
  // (phase leaves "restoring") so a fresh keychain and a deep link compose.
  const pairingUrl = showcase?.pairingUrl;
  const deeplinkFired = useRef(false);
  useEffect(() => {
    if (phase === "restoring" || client !== null || deeplinkFired.current) return;
    deeplinkFired.current = true;
    if (pairingUrl === undefined) return;
    try {
      const { host, port } = parsePairUrl(pairingUrl);
      setPrefill({ host, port: String(port) });
      adoptConfig(createConnectionConfig(host, port));
    } catch {
      setNotice("pairing link is not a valid loop:// payload — sign in manually");
      setPhase("manual");
    }
    // adoptConfig is stable (useCallback over the memoized store); pairingUrl
    // is launch-time immutable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, pairingUrl, phase]);

  /** Logout (D2-4): delete the stored credential NOW, drop the in-memory
   * connection, and return to the manual Connect screen (prefilled with the
   * host we were on). Server-side revocation is out of v1 scope — the
   * guarantee is deletion on this device. */
  const logout = useCallback(() => {
    void (async () => {
      try {
        await store.clear();
      } catch {
        // Still drop the in-memory connection; next launch re-surfaces the item.
      }
      setClient(null);
      setChat(null);
      setOpenPaneId(null);
      setSpawnBlocked(false); // the gate belonged to the dropped connection
      setPhase("manual");
      setNotice(null);
    })();
  }, [store]);

  const openRunChat = (runId: string) => {
    setLastRunId(runId);
    setChat({ runId });
  };
  const openSessionChat = (sessionId: string) => setChat({ sessionId });

  // Settings load (§B): once per connection-lifetime mount, best-effort —
  // a failed read leaves the defaults in place.
  const settingsLoadFired = useRef(false);
  useEffect(() => {
    if (settingsLoadFired.current) return;
    settingsLoadFired.current = true;
    settingsStore
      .load()
      .then((loaded) => setSettings(loaded))
      .catch(() => undefined);
  }, [settingsStore]);

  /** Settings save: persist through the store, then adopt in memory. */
  const saveSettings = useCallback(
    (next: AppSettings) => {
      setSettings(next);
      settingsStore.save(next).catch(() => undefined);
    },
    [settingsStore],
  );

  // Showcase/demo (v4): open a specific run's chat right after connect —
  // the same navigation a tap on its chats row performs. Fire-once.
  const autoOpenFired = useRef(false);
  const autoOpenRunId = showcase?.autoOpenRunId;
  useEffect(() => {
    if (client === null || autoOpenRunId === undefined || autoOpenFired.current) return;
    autoOpenFired.current = true;
    openRunChat(autoOpenRunId);
  }, [client, autoOpenRunId]);

  // Showcase/demo (v8): open a session directly right after connect — the
  // same navigation a tap on an uncorrelated sessions row performs (empty-
  // state demo). Fire-once.
  const autoOpenSessionFired = useRef(false);
  const autoOpenSessionId = showcase?.autoOpenSessionId;
  useEffect(() => {
    if (client === null || autoOpenSessionId === undefined || autoOpenSessionFired.current) return;
    autoOpenSessionFired.current = true;
    openSessionChat(autoOpenSessionId);
  }, [client, autoOpenSessionId]);

  // Showcase/demo (one-time login): exercise the exact logout handler the
  // confirmation dialog's destructive button invokes, after a delay, so the
  // full connect→persist→logout→manual cycle is drivable headlessly — the
  // alert itself is presentation and is bypassed by design (no human tap).
  // Fire-once.
  const autoLogoutFired = useRef(false);
  const autoLogout = showcase?.autoLogout === true;
  const autoLogoutDelayMs = showcase?.autoLogoutDelayMs ?? 6000;
  useEffect(() => {
    if (client === null || !autoLogout || autoLogoutFired.current) return;
    autoLogoutFired.current = true;
    const timer = setTimeout(logout, autoLogoutDelayMs);
    return () => clearTimeout(timer);
  }, [client, autoLogout, autoLogoutDelayMs, logout]);

  function renderScreen(): ReactElement {
    // Every CONNECTED surface rides the drawer overlay (task
    // `mobile-ux-patterns`): the menu must open from detail screens too,
    // where the tab bar is hidden — that is its reason to exist.
    const withDrawer = (screen: ReactElement): ReactElement => (
      <>
        {screen}
        <DrawerMenu
          open={menuOpen}
          active={tab}
          gatewayLine={gatewayLine(settings)}
          onSelect={(key: DrawerKey) => {
            setMenuOpen(false);
            setTab(key);
          }}
          onClose={() => setMenuOpen(false)}
        />
      </>
    );
    if (client === null) {
      if (scanOpen) {
        // Full-bleed camera: applies its own safe-area insets to the chrome
        // (cancel pill, hint) so the frame covers the notch zone cleanly.
        return (
          <QRScannerScreen
            onPaired={(host, port) => {
              setScanOpen(false);
              setPrefill({ host, port: String(port) });
              try {
                adoptConfig(createConnectionConfig(host, port));
              } catch (error) {
                setNotice(
                  error instanceof Error ? error.message : "pairing payload is not usable",
                );
              }
            }}
            onCancel={() => setScanOpen(false)}
          />
        );
      }
      if (phase === "restoring") {
        return (
          <Screen>
            <Text style={styles.restoring}>Restoring connection…</Text>
          </Screen>
        );
      }
      return (
        <Screen>
          <ConnectScreen
            onConnected={adoptConfig}
            initialHost={prefill?.host ?? showcase?.host}
            initialPort={prefill?.port ?? showcase?.port}
            initialBearer={connectDriven.current ? undefined : showcase?.bearer}
            autoConnect={showcase?.autoConnect === true && !connectDriven.current}
            notice={notice}
            onScanQr={() => setScanOpen(true)}
          />
        </Screen>
      );
    }
    if (openPaneId !== null) {
      // Detail surface: the tab bar hides; the header owns the back chevron
      // (brief §4: 액션 알약은 헤더 back과 제스처로 흡수한다) — and the
      // left-edge swipe fires the SAME back (mobile-ux-patterns).
      return withDrawer(
        <Screen
          scrollable={false}
          header={
            <AppHeader
              title={TERMINAL_TITLE}
              leading={<HeaderBack onPress={() => setOpenPaneId(null)} />}
              actions={<DrawerButton onPress={() => setMenuOpen(true)} />}
            />
          }
        >
          <BackSwipeZone onBack={() => setOpenPaneId(null)}>
            <PaneScreen client={client} paneId={openPaneId} />
          </BackSwipeZone>
        </Screen>,
      );
    }
    if (chat !== null) {
      return withDrawer(
        <ConversationScreen
          client={client}
          runId={chat.runId}
          sessionId={chat.sessionId}
          onOpenPane={setOpenPaneId}
          onOpenRun={openRunChat}
          onBack={() => setChat(null)}
          onOpenMenu={() => setMenuOpen(true)}
          naming={naming}
          autoSteerText={showcase?.autoSteerText}
          autoSteerDelayMs={showcase?.autoSteerDelayMs}
          autoScrollUpDelayMs={showcase?.autoScrollUpDelayMs}
          composerDraft={showcase?.composerDraft}
          autoAttachAssetIds={showcase?.attachAssetIds}
          autoAttachDelayMs={showcase?.attachDelayMs}
          autoAttachSendDelayMs={showcase?.attachSendDelayMs}
          autoBackDelayMs={showcase?.autoBackDelayMs}
        />,
      );
    }
    // Tab shell (direction A): the three destinations over one tab bar —
    // icon + label + accent active state. Files keeps the split-viewer §B
    // responsive container; the tab bar replaces the old footer pills.
    const content =
      tab === "files" ? (
        <Screen
          scrollable={false}
          key="files"
          header={<AppHeader title={FILES_REPORTS_LABEL} />}
        >
          {/* Split-viewer design §B: the container is responsive — wide =
           * persistent two-pane, narrow = tree + viewer bottom sheet. */}
          <RunSplitScreen
            client={client}
            runId={lastRunId}
            viewerFontSize={settings.viewerFontSize}
            refreshIntervalMs={settings.refreshIntervalMs}
          />
        </Screen>
      ) : tab === "settings" ? (
        <Screen key="settings" header={<AppHeader title={SETTINGS_TITLE} />}>
          {/* Logout rides the bottom Settings path (task `main-screen-polish`):
           * the handler is handed over ALREADY wrapped in the confirmation
           * alert — the settings row is the only control that fires it. */}
          <SettingsScreen
            settings={settings}
            onSave={saveSettings}
            onLogout={confirmLogout(logout)}
          />
        </Screen>
      ) : (
        // Chrome-free chats home (task `main-screen-polish`): no AppHeader —
        // the list starts directly under the status zone (the shared Screen
        // clears the inset when no header is present). No destructive
        // control lives on this high-frequency surface; logout moved to the
        // Settings tab, and the drawer stays reachable from detail screens.
        <Screen scrollable={false} key="chats">
          <SubmitScreen
            client={client}
            onAccepted={(accepted) => openRunChat(accepted.run.runId)}
            initialPrompt={showcase?.prompt}
            autoSubmit={showcase?.autoSubmit}
            submitDelayMs={showcase?.submitDelayMs}
            onOpenRun={openRunChat}
            onOpenSession={openSessionChat}
            naming={naming}
            spawnBlocked={spawnBlocked}
            onSpawnBlocked={() => setSpawnBlocked(true)}
          />
        </Screen>
      );
    return withDrawer(
      <View style={styles.shell}>
        {content}
        <TabBar active={tab} onSelect={setTab} />
      </View>,
    );
  }

  return (
    <SafeAreaProvider>
      {/* The header is the status-bar substitute (task
       * `header-statusbar-redesign`): the system bar is hidden app-wide so
       * the Loop chrome owns the status zone — the Dynamic Island stays as
       * the hardware centerpiece and no system time/battery collides with
       * the flanking title/actions. */}
      <StatusBar hidden />
      <View style={styles.root}>{renderScreen()}</View>
    </SafeAreaProvider>
  );
}

/** Host/port prefill for the manual screen; never carries the bearer. */
function prefillOf(config: ConnectionConfig): { host: string; port: string } {
  const { host, port } = parseBaseUrl(config.baseUrl);
  return { host, port: String(port) };
}

/** The drawer footer's gateway display line (§B display row): a read-only
 * echo of the recorded settings — never the bearer, which lives only in
 * the in-memory client config between connects. */
function gatewayLine(settings: AppSettings): string | null {
  if (settings.gatewayHost === null) return null;
  return settings.gatewayPort === null
    ? settings.gatewayHost
    : `${settings.gatewayHost}:${settings.gatewayPort}`;
}

/** Logout confirmation (mis-tap guard): the Settings row only OPENS the
 * alert; the destructive button is the sole path to the App-owned
 * handler — an accidental tap deletes nothing. */
function confirmLogout(logout: () => void): () => void {
  return () => {
    Alert.alert(LOGOUT_CONFIRM_TITLE, LOGOUT_CONFIRM_MESSAGE, [
      { text: LOGOUT_CONFIRM_CANCEL, style: "cancel" },
      { text: LOGOUT_LABEL, style: "destructive", onPress: logout },
    ]);
  };
}

/** Header back chevron (brief §4): the action-pill replacement — detail
 * screens navigate back through the header, never through a bottom pill.
 * The 44pt touch floor keeps the chevron honest. */
function HeaderBack(props: { onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={props.onPress}
      hitSlop={12}
      style={styles.headerBack}
      activeOpacity={press.activeOpacity}
    >
      <Icon role="back" size={type.title.fontSize} color={colors.inkMute} />
    </TouchableOpacity>
  );
}

/** Header hamburger (task `mobile-ux-patterns`): opens the side menu —
 * the auxiliary surface for reaching Settings/Files from screens whose
 * tab bar is hidden. Same header-corner grammar as the logout icon:
 * quiet glyph on the 44pt touch floor. */
function DrawerButton(props: { onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.drawerButton}
      onPress={props.onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      activeOpacity={press.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel="Menu"
    >
      <Icon role="menu" size={type.title.fontSize} color={colors.inkMute} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // Tab shell: the tab surface fills the space above the tab bar.
  shell: { flex: 1 },
  restoring: { ...type.body, color: colors.inkMute },
  headerBack: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  // Side-menu hamburger (mobile-ux-patterns): opens the drawer from
  // detail screens (the chats home is chrome-free and rides the tab bar).
  drawerButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
});

export default App;
