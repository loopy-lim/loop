/**
 * react-native-keychain binding for the credential store (adapter side).
 *
 * Accessibility: the item is readable only while the device is unlocked and
 * is excluded from device backups and migrations
 * (docs/decisions/2026-xx-app-credential-persistence.md D1). Keychain events
 * are never logged; only the UI flow observes the results.
 */

import * as Keychain from "react-native-keychain";

import type { GatewayKeychainPort } from "./credentialStore";

/** One keychain item for this app's gateway credential (arbitrary service id). */
export const GATEWAY_KEYCHAIN_SERVICE = "net.loop.gateway.credentials";

export const gatewayKeychain: GatewayKeychainPort = {
  async save(username: string, password: string): Promise<boolean> {
    const result = await Keychain.setGenericPassword(username, password, {
      service: GATEWAY_KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return result !== false;
  },
  async load(): Promise<{ username: string; password: string } | null> {
    const item = await Keychain.getGenericPassword({ service: GATEWAY_KEYCHAIN_SERVICE });
    return item === false ? null : { username: item.username, password: item.password };
  },
  async clear(): Promise<boolean> {
    return Keychain.resetGenericPassword({ service: GATEWAY_KEYCHAIN_SERVICE });
  },
};
