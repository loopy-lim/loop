import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";

import {
  createConnectionConfig,
  ConnectionConfigError,
  type ConnectionConfig,
} from "../auth/connection";
import { colors, press, radius, space, type } from "../ui/tokens";

/**
 * Screen 1 — connection settings (ADR §5.1).
 *
 * The user enters the gateway's Tailscale `host:port` and the bearer token.
 * One-time sign-in (decision 2026-xx-app-credential-persistence.md D2): the
 * parent verifies the connection against the gateway and persists the
 * credential to the OS secure keychain ONLY after success; this screen stays
 * dumb — it validates shape locally and reports async outcome via props
 * (`notice` carries restore/probe failures, never token material).
 * The token is never logged and never rendered beyond the masked field.
 */
// Default gateway address: the gateway service's tailnet MagicDNS name
// (docs/research/app-device-install.md). A hostname is required on iOS 26:
// ATS ignores NSAllowsArbitraryLoads for numeric IP literals, so the
// Info.plist exempts this exact host (see ios/LoopMobile/Info.plist).
const DEFAULT_GATEWAY_HOST = "loopy-macbookpro.tail42f248.ts.net";
const DEFAULT_GATEWAY_PORT = "18477";

export function ConnectScreen(props: {
  /** Async connect: the parent probes the gateway and persists on success.
   * Resolves when the app moves on; rejections mean "stay here". */
  onConnected: (config: ConnectionConfig) => void | Promise<void>;
  /** Showcase/demo + restore/logout prefill: bearer (memory only while
   * typing; persistence happens in the parent after a verified connect). */
  initialBearer?: string;
  /** Prefill host/port (saved credentials, showcase, or last session). */
  initialHost?: string;
  initialPort?: string;
  /** Showcase/demo: fire the same Connect handler once on mount — with or
   * without a bearer (tokenless auto-connect on a Tailscale-bound gateway). */
  autoConnect?: boolean;
  /** Restore/auto-connect failure notice from the parent (no token ever). */
  notice?: string | null;
  /** Open the in-app camera QR scanner (task `mobile-safe-safearea-qr-scan`):
   * optional so tests/showcase renders without it stay as-is. */
  onScanQr?: () => void;
}) {
  const [host, setHost] = useState(props.initialHost ?? DEFAULT_GATEWAY_HOST);
  const [port, setPort] = useState(props.initialPort ?? DEFAULT_GATEWAY_PORT);
  const [bearer, setBearer] = useState(props.initialBearer ?? "");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const autoConnectFired = useRef(false);

  const connect = (token: string) => {
    if (connecting) return;
    let config: ConnectionConfig;
    try {
      config = createConnectionConfig(host, port, token);
    } catch (e) {
      setError(e instanceof ConnectionConfigError ? e.message : "connection failed");
      return;
    }
    setError(null);
    setConnecting(true);
    void Promise.resolve(props.onConnected(config)).finally(() => setConnecting(false));
  };

  useEffect(() => {
    if (autoConnectFired.current || props.autoConnect !== true) return;
    // Tokenless launch (decision 2026-xx-tokenless-auth-and-app-layout §D-A1):
    // no LOOP_SHOWCASE_BEARER env means connect with an empty bearer — the
    // same path a human takes by tapping Connect with the token field empty.
    const token = props.initialBearer ?? "";
    autoConnectFired.current = true;
    connect(token);
    // Run once on mount with the launch-time config; mirrors a human tap on Connect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <KeyboardAvoidingView behavior="padding">
      <Text style={styles.heading}>Connect</Text>
      <Text style={styles.subheading}>
        Loop gateway over Tailscale. Leave the token empty — tailnet membership is the credential;
        a token is the fallback, kept in this device's keychain only.
      </Text>

      <Text style={styles.label}>HOST</Text>
      <TextInput
        style={styles.input}
        value={host}
        onChangeText={setHost}
        placeholder="100.x.y.z"
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.label}>PORT</Text>
      <TextInput
        style={styles.input}
        value={port}
        onChangeText={setPort}
        placeholder="port"
        placeholderTextColor={colors.inkFaint}
        inputMode="numeric"
      />
      <Text style={styles.label}>TOKEN — fallback only</Text>
      <TextInput
        style={styles.input}
        value={bearer}
        onChangeText={setBearer}
        placeholder="empty = tokenless"
        placeholderTextColor={colors.inkFaint}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />

      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      {props.notice !== null && props.notice !== undefined && props.notice.length > 0 ? (
        <Text style={styles.notice}>{props.notice}</Text>
      ) : null}
      <TouchableOpacity
        style={[styles.cta, connecting && styles.ctaDisabled]}
        onPress={() => connect(bearer)}
        disabled={connecting}
        activeOpacity={press.activeOpacity}
      >
        <Text style={[styles.ctaText, connecting && styles.ctaTextDisabled]}>
          {connecting ? "Connecting…" : "Connect"}
        </Text>
      </TouchableOpacity>
      {props.onScanQr !== undefined ? (
        <TouchableOpacity
          style={styles.scanEntry}
          onPress={props.onScanQr}
          activeOpacity={press.activeOpacity}
        >
          <Text style={styles.scanEntryText}>Scan pairing QR code</Text>
        </TouchableOpacity>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  heading: { ...type.display, color: colors.ink },
  subheading: { ...type.body, color: colors.inkMute, marginTop: space.s, marginBottom: space.xl },
  label: {
    ...type.captionStrong,
    color: colors.inkFaint,
    marginTop: space.l,
    marginBottom: space.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    color: colors.ink,
    fontSize: type.body.fontSize,
    paddingVertical: space.m,
    paddingHorizontal: space.m,
  },
  error: { ...type.caption, color: colors.danger, marginTop: space.l },
  notice: { ...type.caption, color: colors.inkMute, marginTop: space.l, maxWidth: 320 },
  cta: {
    // Full-width primary CTA: the viewport's one strong emphasis (§4),
    // stretched so the tap target is unmistakable.
    alignSelf: "stretch",
    alignItems: "center",
    marginTop: space.xl,
    backgroundColor: colors.cta,
    borderRadius: radius.pill,
    paddingVertical: space.l,
    paddingHorizontal: space.xl,
  },
  ctaDisabled: { backgroundColor: colors.ctaDisabled },
  ctaText: { ...type.bodyStrong, color: colors.ctaInk },
  ctaTextDisabled: { color: colors.inkFaint },
  // Quiet secondary entrance (guidance §4): never competes with the Connect
  // CTA — bordered pill, muted ink, same vocabulary as App's QuietButton.
  scanEntry: {
    alignSelf: "stretch",
    alignItems: "center",
    marginTop: space.m,
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.pill,
    paddingVertical: space.m,
  },
  scanEntryText: { ...type.captionStrong, color: colors.inkMute },
});
