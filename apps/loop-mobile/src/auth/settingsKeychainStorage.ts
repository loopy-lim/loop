/**
 * react-native-keychain binding for the app settings store (split-viewer
 * design §B). A second, separate service item from the gateway credential:
 * settings are non-secret preferences (viewer font size, refresh
 * interval), but the keychain is this app's ONE sanctioned durable store —
 * AsyncStorage/SQLite/plain files stay forbidden (credential decision D1
 * rationale), so preferences ride the same device-only, non-backed-up
 * item family under their own service id.
 *
 * All keychain bindings live under auth/ (architecture boundary: the
 * secure-store adapter is owned by the auth layer, same as the credential
 * binding in keychain.ts).
 */

import * as Keychain from "react-native-keychain";

/** Structural twin of state/settings.ts's `SettingsStorage` port. The
 * decided layer directions (D-B) let auth import only gateway-client, so
 * the shape is restated here instead of imported; App.tsx (entry) wires
 * this binding into the pure settings store by structure. */
export type SettingsKeychainPort = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
};

export const SETTINGS_KEYCHAIN_SERVICE = "net.loop.app.settings";

export const settingsKeychainStorage: SettingsKeychainPort = {
  async read(): Promise<string | null> {
    const item = await Keychain.getGenericPassword({ service: SETTINGS_KEYCHAIN_SERVICE });
    if (item === false) return null;
    // The settings payload is stored in the password field; the username
    // carries the fixed schema marker so a stray item cannot masquerade.
    return item.username === "loop.settings.v1" ? item.password : null;
  },
  async write(value: string): Promise<void> {
    await Keychain.setGenericPassword("loop.settings.v1", value, {
      service: SETTINGS_KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
};
