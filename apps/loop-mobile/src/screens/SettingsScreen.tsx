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
import { LOGOUT_LABEL, READOUT_STYLE } from "../ui/copy";
import { Icon } from "../ui/Icon";
import { colors, press, radius, space, type } from "../ui/tokens";

const FONT_STEPS = [FONT_SIZE_MIN, 15, 17, FONT_SIZE_MAX, 26];
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
  /** Logout (task `main-screen-polish`): the bottom Settings path — App
   * hands over the handler ALREADY wrapped in its confirmation alert;
   * this row is a quiet destructive control at the list's end (the HIG
   * home for account-level actions), never inside the settings card
   * cluster it cannot undo. */
  onLogout?: () => void;
}) {
  const [draft, setDraft] = useState<AppSettings>(props.settings);
  const gateway =
    draft.gatewayHost !== null && draft.gatewayPort !== null
      ? `${draft.gatewayHost}:${draft.gatewayPort}`
      : SETTINGS_GATEWAY_UNSET;

  return (
    <View>
      {/* Screen title lives in the header chrome (task `redesign-implement`):
       * tab destinations keep one title, not a chrome + content pair. */}

      <DynText style={styles.section}>Gateway connection</DynText>
      <View style={styles.card}>
        <DynText style={styles.value}>{gateway}</DynText>
        <DynText style={styles.note}>Managed at sign-in — log out to change or clear it.</DynText>
      </View>

      <DynText style={styles.section}>Viewer font size</DynText>
      <View style={styles.card}>
        <View style={styles.choiceRow}>
          {FONT_STEPS.map((size) => {
            const active = draft.viewerFontSize === size;
            return (
              <TouchableOpacity
                key={size}
                style={[styles.choice, active && styles.choiceActive]}
                onPress={() => setDraft({ ...draft, viewerFontSize: clampFontSize(size) })}
                activeOpacity={press.activeOpacity}
              >
                <DynText style={[styles.choiceText, active && styles.choiceTextActive]}>
                  {size}
                </DynText>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <DynText style={styles.section}>Refresh interval</DynText>
      <View style={styles.card}>
        <View style={styles.choiceRow}>
          {REFRESH_STEPS.map((step) => {
            const active = draft.refreshIntervalMs === step.ms;
            return (
              <TouchableOpacity
                key={step.ms}
                style={[styles.choice, active && styles.choiceActive]}
                onPress={() =>
                  setDraft({ ...draft, refreshIntervalMs: clampRefreshInterval(step.ms) })
                }
                activeOpacity={press.activeOpacity}
              >
                <DynText style={[styles.choiceText, active && styles.choiceTextActive]}>
                  {step.label}
                </DynText>
              </TouchableOpacity>
            );
          })}
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

      {/* Logout (task `main-screen-polish`): the destructive account
       * action rides alone at the bottom, visually separated from the
       * save cluster; the confirmation lives in App, not here. */}
      {props.onLogout !== undefined ? (
        <TouchableOpacity
          style={styles.logoutRow}
          onPress={props.onLogout}
          activeOpacity={press.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={LOGOUT_LABEL}
        >
          <Icon role="logout" size={type.title.fontSize} color={colors.danger} />
          <DynText style={styles.logoutText}>{LOGOUT_LABEL}</DynText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    ...type.captionStrong,
    color: colors.inkFaint,
    textTransform: "uppercase",
    ...READOUT_STYLE,
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
  // Choice chips: the secondary button tier (surface fill + hairline,
  // radius.m — the pill radius is retired for buttons, canon §3).
  choice: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space.l,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
  },
  // Selected state = the accent's job (canon §4): accentSoft wash + accent
  // border and text — a state, not an emphasis.
  choiceActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  choiceText: { ...type.body, color: colors.ink },
  choiceTextActive: { ...type.bodyStrong, color: colors.accent },
  saveButton: {
    alignSelf: "stretch",
    alignItems: "center",
    marginVertical: space.xl,
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.cta,
    borderRadius: radius.m,
    paddingVertical: space.m,
    paddingHorizontal: space.xl,
  },
  saveText: { ...type.bodyStrong, color: colors.ctaInk },
  // Logout row (task `main-screen-polish`): quiet destructive control —
  // hairline card like the settings cards, danger ink on the label, 44pt
  // touch floor. No fill of its own; the danger word is the warning.
  logoutRow: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    paddingVertical: space.m,
    paddingHorizontal: space.l,
  },
  logoutText: { ...type.bodyStrong, color: colors.danger },
});
