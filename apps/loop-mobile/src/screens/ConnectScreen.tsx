/**
 * Connect gate (rebuild brief §3 ④) — the pre-connected screen. Manual
 * host/port or a `loop://` pairing QR; the parent probes the gateway via
 * the herdr state route and persists ONLY after success (decision
 * 2026-xx-app-credential-persistence D2, unchanged). No showcase props.
 */

import { useState } from "react";
import { KeyboardAvoidingView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import {
  connectionConfigFromUrl,
  createConnectionConfig,
  ConnectionConfigError,
  type ConnectionConfig,
} from "../auth/connection";
import { copy } from "../copy";
import { colors, press, radius, space, type as typeScale, COLUMN_GUTTER } from "../ui/tokens";

// The gateway service's tailnet MagicDNS name (docs/research/app-device-
// install.md). iOS ATS requires a DNS name for the default exemption (see
// ios/LoopMobile/Info.plist).
const DEFAULT_GATEWAY_HOST = "loopy-macbookpro.tail42f248.ts.net";
const DEFAULT_GATEWAY_PORT = "18477";

export function ConnectScreen(props: {
  onConnected: (config: ConnectionConfig) => void | Promise<void>;
  initialHost?: string;
  initialPort?: string;
  notice?: string | null;
  onScanQr?: () => void;
}) {
  const [host, setHost] = useState(props.initialHost ?? DEFAULT_GATEWAY_HOST);
  const [port, setPort] = useState(props.initialPort ?? DEFAULT_GATEWAY_PORT);
  const [bearer, setBearer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const connect = (token: string) => {
    if (connecting) return;
    let config: ConnectionConfig;
    try {
      // A full URL in the host field (serve-TLS amendment) wins over the
      // host+port pair: `https://gw.tailnet.ts.net` or `http://h:p`.
      const trimmed = host.trim();
      config = /^https?:\/\//i.test(trimmed)
        ? connectionConfigFromUrl(trimmed, token)
        : createConnectionConfig(trimmed, port, token);
    } catch (e) {
      setError(e instanceof ConnectionConfigError ? e.message : copy.connectFailed);
      return;
    }
    setError(null);
    setConnecting(true);
    void Promise.resolve(props.onConnected(config)).finally(() => setConnecting(false));
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.root}>
      <View style={[styles.column, { paddingTop: 0 }]}>
        <Text style={styles.heading}>{copy.connectTitle}</Text>
        <Text style={styles.subheading}>{copy.connectHint}</Text>

        <Text style={styles.label}>{copy.connectHostLabel}</Text>
        <TextInput
          style={[styles.input, focusedField === "host" && styles.inputFocused]}
          value={host}
          onChangeText={setHost}
          placeholder="100.x.y.z, host.ts.net 또는 https://gw.ts.net"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => setFocusedField("host")}
          onBlur={() => setFocusedField(null)}
        />
        <Text style={styles.label}>{copy.connectPortLabel}</Text>
        <TextInput
          style={[styles.input, focusedField === "port" && styles.inputFocused]}
          value={port}
          onChangeText={setPort}
          placeholder="18477"
          placeholderTextColor={colors.inkFaint}
          inputMode="numeric"
          onFocus={() => setFocusedField("port")}
          onBlur={() => setFocusedField(null)}
        />
        <Text style={styles.label}>토큰 (fallback 전용)</Text>
        <TextInput
          style={[styles.input, focusedField === "bearer" && styles.inputFocused]}
          value={bearer}
          onChangeText={setBearer}
          placeholder="빈 값 = 토큰 없음"
          placeholderTextColor={colors.inkFaint}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => setFocusedField("bearer")}
          onBlur={() => setFocusedField(null)}
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
            {connecting ? copy.connecting : copy.connectCta}
          </Text>
        </TouchableOpacity>
        {props.onScanQr !== undefined ? (
          <TouchableOpacity
            style={styles.scanEntry}
            onPress={props.onScanQr}
            activeOpacity={press.activeOpacity}
          >
            <Text style={styles.scanEntryText}>{copy.connectScan}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  column: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: COLUMN_GUTTER,
    maxWidth: 480,
    alignSelf: "center",
    width: "100%",
  },
  heading: { ...typeScale.display, color: colors.ink },
  subheading: { ...typeScale.body, color: colors.inkMute, marginTop: space.s, marginBottom: space.xl },
  label: {
    ...typeScale.captionStrong,
    color: colors.inkFaint,
    marginTop: space.l,
    marginBottom: space.xs,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    color: colors.ink,
    fontSize: typeScale.body.fontSize,
    paddingVertical: space.m,
    paddingHorizontal: space.m,
  },
  inputFocused: { borderColor: colors.accent },
  error: { ...typeScale.caption, color: colors.danger, marginTop: space.l },
  notice: { ...typeScale.caption, color: colors.inkMute, marginTop: space.l },
  cta: {
    alignSelf: "stretch",
    alignItems: "center",
    marginTop: space.xl,
    backgroundColor: colors.cta,
    borderRadius: radius.m,
    paddingVertical: space.l,
    paddingHorizontal: space.xl,
  },
  ctaDisabled: { backgroundColor: colors.ctaDisabled },
  ctaText: { ...typeScale.bodyStrong, color: colors.ctaInk },
  ctaTextDisabled: { color: colors.inkFaint },
  scanEntry: {
    alignSelf: "stretch",
    alignItems: "center",
    marginTop: space.m,
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    paddingVertical: space.m,
  },
  scanEntryText: { ...typeScale.captionStrong, color: colors.inkMute },
});
