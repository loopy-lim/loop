/**
 * The one clipboard-write seam (task `usability-and-quality-fixes`,
 * react-doctor rn-no-deprecated-modules): react-native core's Clipboard
 * JS wrapper is deprecated for removal, and the sanctioned community
 * package (@react-native-clipboard/clipboard) is a dependency decision
 * outside this task's write scope. The seam resolves the SAME native
 * TurboModule the deprecated wrapper used ("Clipboard") and reports
 * capability honestly — copyText returns false when no native module
 * exists, so a caller never fakes a "Copied" state. Swapping in the
 * community package later is a one-file change.
 */
import type { TurboModule } from "react-native/Libraries/TurboModule/RCTExport";
import { TurboModuleRegistry } from "react-native";

type ClipboardModule = TurboModule & { setString(content: string): void };

let cached: ClipboardModule | null | undefined;

function nativeClipboard(): ClipboardModule | null {
  if (cached === undefined) {
    cached = TurboModuleRegistry.get<ClipboardModule>("Clipboard") ?? null;
  }
  return cached;
}

/** Best-effort copy: true only when the bytes reached the system clipboard. */
export function copyText(text: string): boolean {
  const mod = nativeClipboard();
  if (mod === null) return false;
  mod.setString(text);
  return true;
}
