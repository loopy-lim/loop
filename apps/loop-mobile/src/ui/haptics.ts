/**
 * Haptics — the app's one haptic vocabulary (native-motion pass). A lazy
 * wrapper over react-native-haptic-feedback: the native module is absent in
 * bun test and on unsupported platforms, so a failed load or trigger is
 * silently swallowed — haptics must never take a surface down.
 */

type HapticsModule = { trigger: (type: string) => void };

let cached: HapticsModule | null | undefined;

function module(): HapticsModule | null {
  if (cached !== undefined) return cached;
  try {
    const imported = require("react-native-haptic-feedback") as
      | HapticsModule
      | { default: HapticsModule };
    cached = "default" in imported ? imported.default : imported;
  } catch {
    cached = null;
  }
  return cached;
}

/** Light impact — tab switches, push/pop commits, send acceptance. */
export function impactLight(): void {
  try {
    module()?.trigger("impactLight");
  } catch {
    // No native module (tests, unsupported platform): stay silent.
  }
}
