import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Whether the soft keyboard is currently shown.
 *
 * Used to hand the bottom inset over to KeyboardAvoidingView: iOS pads by
 * the keyboard's full overlap (which already includes the home-indicator
 * area), so the composer's own safe-area bottom padding must yield to 0
 * while the keyboard is up, or the composer floats above the keyboard with
 * an extra dead gap.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showName = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideName = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showName, () => setVisible(true));
    const hide = Keyboard.addListener(hideName, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}
