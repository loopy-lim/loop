/**
 * Dynamic Type cap, step 1 of decision 2026-xx-codex-detail-checklist C15:
 * one shared ceiling so larger accessibility text scales up without
 * clipping the fixed-height controls. Applied at the conversation surface's
 * text roots via DynText; the tokens' lineHeight derivation stays a
 * documented follow-up (C15 후속).
 */
import { Text as RNText, type TextProps } from "react-native";

/** Font-scale ceiling (1.3x) — the decided first-step value. */
export const MAX_FONT_SCALE = 1.3;

/** The conversation surface's base text component: identical to RN Text,
 * with the decided maxFontSizeMultiplier ceiling by default. */
export function DynText(props: TextProps) {
  const { maxFontSizeMultiplier, ...rest } = props;
  return <RNText {...rest} maxFontSizeMultiplier={maxFontSizeMultiplier ?? MAX_FONT_SCALE} />;
}
