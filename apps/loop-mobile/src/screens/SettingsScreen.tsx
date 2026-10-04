/**
 * Minimal settings screen (split-viewer design §B): gateway connection
 * (display-only — the connection is owned by sign-in per the credential
 * decision; editing here would bypass the probe path), viewer font size,
 * and refresh interval. Persisted locally through the settings store
 * (state/settings.ts pure store; keychain-backed storage binding).
 */
import { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  clampFontSize,
  clampRefreshInterval,
  type AppSettings,
} from "../state/settings";
import { DynText } from "../ui/DynText";
import { colors, press, radius, space, type } from "../ui/tokens";

const FONT_STEPS = [FONT_SIZE_MIN, 14, 15, 17, 19, FONT_SIZE_MAX];
const REFRESH_STEPS = [
  { label: "2 s", ms: 2_000 },
  { label: "10 s", ms: 10_000 },
  { label: "30 s", ms: 30_000 },
  { label: "60 s", ms: 60_000 },
];

export const SETTINGS_SAVE_LABEL = "Save settings";
export const SETTINGS_GATEWAY_UNSET = "Not connected";

export function SettingsScreen(props: {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
}) {
  const [draft, setDraft] = useState<AppSettings>(props.settings);
  const gateway =
    draft.gatewayHost !== null && draft.gatewayPort !== null
      ? `${draft.gatewayHost}:${draft.gatewayPort}`
      : SETTINGS_GATEWAY_UNSET;

  return (
    <View>
      <DynText style={styles.heading}>Settings</DynText>

      <DynText style={styles.section}>Gateway connection</DynText>
      <View style={styles.card}>
        <DynText style={styles.value}>{gateway}</DynText>
        <DynText style={styles.note}>Managed at sign-in — log out to change or clear it.</DynText>
      </View>

      <DynText style={styles.section}>Viewer font size</DynText>
      <View style={styles.card}>
        <View style={styles.choiceRow}>
          {FONT_STEPS.map((size) => (
            <TouchableOpacity
              key={size}
              style={[styles.choice, draft.viewerFontSize === size && styles.choiceActive]}
              onPress={() => setDraft({ ...draft, viewerFontSize: clampFontSize(size) })}
              activeOpacity={press.activeOpacity}
            >
              <DynText style={styles.choiceText}>{size}</DynText>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <DynText style={styles.section}>Refresh interval</DynText>
      <View style={styles.card}>
        <View style={styles.choiceRow}>
          {REFRESH_STEPS.map((step) => (
            <TouchableOpacity
              key={step.ms}
              style={[styles.choice, draft.refreshIntervalMs === step.ms && styles.choiceActive]}
              onPress={() =>
                setDraft({ ...draft, refreshIntervalMs: clampRefreshInterval(step.ms) })
              }
              activeOpacity={press.activeOpacity}
            >
              <DynText style={styles.choiceText}>{step.label}</DynText>
            </TouchableOpacity>
          ))}
        </View>
        <DynText style={styles.note}>Foreground refresh for the run pane inventory.</DynText>
      </View>

      <TouchableOpacity
        style={styles.saveButton}
        onPress={() => props.onSave(draft)}
        activeOpacity={press.activeOpacity}
      >
        <DynText style={styles.saveText}>{SETTINGS_SAVE_LABEL}</DynText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { ...type.display, color: colors.ink, marginBottom: space.l },
  section: {
    ...type.captionStrong,
    color: colors.inkFaint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: space.l,
    marginBottom: space.s,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    padding: space.l,
  },
  value: { ...type.body, color: colors.ink },
  note: { ...type.caption, color: colors.inkFaint, marginTop: space.s },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  choice: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space.l,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.pill,
  },
  choiceActive: { borderColor: colors.ink, backgroundColor: colors.surfaceAlt },
  choiceText: { ...type.body, color: colors.ink },
  saveButton: {
    alignSelf: "flex-start",
    marginVertical: space.xl,
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.cta,
    borderRadius: radius.pill,
    paddingVertical: space.s,
    paddingHorizontal: space.xl,
  },
  saveText: { ...type.bodyStrong, color: colors.ctaInk },
});
