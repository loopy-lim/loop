/**
 * App entry (rebuild brief §5): boot → restore/connect gate → Shell. The
 * HerdrStore lives here; the connect gate reuses the audited restore +
 * credential-store policy unchanged (one-time sign-in after a verified
 * probe, keychain-only persistence, no-delete fallback).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { createConnectionConfig, type ConnectionConfig } from "./auth/connection";
import { createGatewayCredentialStore } from "./auth/credentialStore";
import { gatewayKeychain } from "./auth/keychain";
import { parsePairUrl } from "./auth/pairing";
import { restoreSession } from "./auth/restore";
import { copy } from "./copy";
import { StoreProvider } from "./app/storeContext";
import { Shell } from "./app/Shell";
import { HerdrStore } from "./herdr/store";
import { probeGateway } from "./gateway-client/probe";
import { ConnectScreen } from "./screens/ConnectScreen";
import { QRScannerScreen } from "./screens/QRScannerScreen";
import { colors } from "./ui/tokens";

const credentials = createGatewayCredentialStore(gatewayKeychain);

type Phase =
  | { kind: "restoring" }
  | { kind: "connect"; notice: string | null }
  | { kind: "connected" };

export default function App() {
  const store = useMemo(() => new HerdrStore(), []);
  const [phase, setPhase] = useState<Phase>({ kind: "restoring" });
  const [scanning, setScanning] = useState(false);
  const restoreFired = useRef(false);

  // Verified connect: probe → observe → persist. One path for manual, QR,
  // and restore (decision D2-1).
  const adoptConfig = async (config: ConnectionConfig): Promise<void> => {
    await probeGateway(config);
    store.connect(config);
    await credentials.save(config);
  };

  const adoptHost = async (host: string, port: number): Promise<void> => {
    try {
      await adoptConfig(createConnectionConfig(host, port));
      setPhase({ kind: "connected" });
    } catch {
      setPhase({ kind: "connect", notice: copy.connectFailed });
    }
  };

  // Restore once per sign-in life: keychain → probe → observe (decision D2-2).
  useEffect(() => {
    if (restoreFired.current) return;
    restoreFired.current = true;
    void restoreSession({
      store: credentials,
      connect: async (config) => {
        await probeGateway(config);
        store.connect(config);
      },
    })
      .then((outcome) => {
        if (outcome.kind === "restored") {
          void credentials.save(outcome.config);
          setPhase({ kind: "connected" });
        } else if (outcome.kind === "fallback") {
          setPhase({ kind: "connect", notice: outcome.reason });
        } else {
          setPhase({ kind: "connect", notice: null });
        }
      })
      .catch(() => {
        setPhase({ kind: "connect", notice: null });
      });
  }, [store]);

  // Pairing deep link (`loop://connect?host=…&port=…`, QR decision §3.2):
  // cold start and warm receives share one handler.
  const pairedOnce = useRef(false);
  const adoptPairUrl = (url: string): void => {
    try {
      const { host, port } = parsePairUrl(url);
      if (pairedOnce.current) return; // one pairing per screen life
      pairedOnce.current = true;
      void adoptHost(host, port);
    } catch {
      // Not a pairing URL (or malformed): the connect form stays honest.
    }
  };
  useEffect(() => {
    const subscription = Linking.addEventListener("url", (event) => adoptPairUrl(event.url));
    void Linking.getInitialURL().then((url) => {
      if (url !== null) adoptPairUrl(url);
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = (): void => {
    store.disconnect();
    void credentials.clear();
    restoreFired.current = false;
    setPhase({ kind: "connect", notice: null });
  };

  const chrome = (children: React.ReactNode): React.ReactNode => (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} hidden={false} />
        {children}
      </View>
    </SafeAreaProvider>
  );

  if (phase.kind === "restoring") {
    return chrome(null);
  }

  if (phase.kind === "connect") {
    if (scanning) {
      return chrome(
        <QRScannerScreen
          onPaired={(host, port) => {
            setScanning(false);
            void adoptHost(host, port);
          }}
          onCancel={() => setScanning(false)}
        />,
      );
    }
    return chrome(
      <ConnectScreen
        notice={phase.notice}
        onScanQr={() => setScanning(true)}
        onConnected={async (config) => {
          await adoptConfig(config);
          setPhase({ kind: "connected" });
        }}
      />,
    );
  }

  return chrome(
    <StoreProvider store={store}>
      <Shell onLogout={logout} />
    </StoreProvider>,
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
