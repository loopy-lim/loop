/**
 * Icon (task `fab-icons`): the ONE render surface for registry roles —
 * call sites pick a role, never a glyph rendering (design-system.md §3
 * 아이콘, v3). Two paths behind one component:
 *
 * - iOS: the LoopIcon native view draws the role's SF Symbol as a
 *   template image tinted with the passed token color — SF Symbols are
 *   the platform's icon vocabulary and cannot fall into the emoji font.
 * - elsewhere / inline-text-only roles (sf: null): the VS15-pinned
 *   unicode fallback from ui/glyphs.ts, rendered through DynText.
 *
 * Colors and sizes arrive from tokens (roles own meaning, values are the
 * theme's); the component never invents either.
 */
import { Platform, requireNativeComponent, type StyleProp, type TextStyle } from "react-native";

import { DynText } from "./DynText";
import { icon, type IconRole } from "./glyphs";
import { type as typeScale } from "./tokens";

/** Props of the native LoopIcon view (ios/LoopMobile/LoopIcon.swift). */
type LoopIconNativeProps = {
  symbolName: string;
  color?: string;
  pointSize: number;
  weight?: string;
  style?: StyleProp<TextStyle>;
};

// Registered only on the iOS build; other platforms use the text fallback.
const LoopIcon =
  Platform.OS === "ios" ? requireNativeComponent<LoopIconNativeProps>("LoopIcon") : null;

/** Registered icon weights (native SymbolConfiguration mapping). */
export type IconWeight = "regular" | "medium" | "semibold" | "bold";

/** Default icon size: the body step — icons sit on the type scale, never
 * on ad-hoc point sizes (canon §3 폐쇄 스케일). */
const DEFAULT_SIZE = typeScale.body.fontSize;

export function Icon(props: {
  role: IconRole;
  color?: string;
  /** Point size — pass the token step the surrounding chrome uses
   * (e.g. type.title.fontSize). Icons ride the closed type scale. */
  size?: number;
  weight?: IconWeight;
  /** Extra chrome styles (opacity, margins) — the DynText path receives
   * them too, so both paths anchor identically in layout. */
  style?: StyleProp<TextStyle>;
}) {
  const entry = icon[props.role];
  if (LoopIcon !== null && entry.sf !== null) {
    // The native view gets NO intrinsic size through yoga: without an
    // explicit width/height it lays out at 0×0 and draws nothing, so the
    // point size doubles as the layout box (the DynText path gets its
    // intrinsic size from fontSize instead).
    const box = props.size ?? DEFAULT_SIZE;
    return (
      <LoopIcon
        symbolName={entry.sf}
        color={props.color}
        pointSize={box}
        weight={props.weight}
        style={[props.style, { width: box, height: box }]}
      />
    );
  }
  return (
    <DynText
      style={[
        props.style,
        { fontSize: props.size ?? DEFAULT_SIZE },
        props.color !== undefined && { color: props.color },
      ]}
    >
      {entry.text}
    </DynText>
  );
}
