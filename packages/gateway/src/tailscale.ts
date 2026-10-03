/**
 * Tailscale bind validation (ADR §2 D2) — fail closed.
 *
 * The gateway binds only an explicitly configured address that (a) is an IP
 * literal, (b) is not wildcard/loopback/link-local/multicast, (c) falls in
 * the Tailscale CGNAT range 100.64.0.0/10, and (d) is currently assigned to
 * an active (up, non-internal) host interface. Anything else refuses startup.
 */

import { networkInterfaces } from "node:os";
import { isIP } from "node:net";

export type InterfaceSnapshot = {
  name: string;
  addresses: string[];
};

export interface TailscaleInspector {
  /** Throws BindRejectedError when the host must not be bound. */
  assertBindable(host: string): void;
}

export class BindRejectedError extends Error {
  override readonly name = "BindRejectedError";
  constructor(reason: string) {
    super(`tailscale bind rejected: ${reason}`);
  }
}

const CGNAT_SECOND_OCTET_MIN = 64; // 100.64.0.0/10 → 100.64.0.0 .. 100.127.255.255
const CGNAT_SECOND_OCTET_MAX = 127;

/** IPv6 리터럴에서 zone id(`%eth0`)를 떼어낸다. split 은 항상 요소를 하나
 * 이상 돌려주므로 폴백은 도달하지 않지만, 인덱스 접근을 가드로 명시한다. */
export function stripIpv6Zone(host: string): string {
  return host.toLowerCase().split("%")[0] ?? host.toLowerCase();
}

/** Pure decision core over an injected interface snapshot. */
export function validateBindableHost(host: string, interfaces: InterfaceSnapshot[]): void {
  const reject = (reason: string) => {
    throw new BindRejectedError(reason);
  };
  const family = isIP(host);
  if (family === 0) reject("host must be an explicit IP literal");
  if (family === 4) {
    const octets = host.split(".").map((value) => Number.parseInt(value, 10));
    const [a, b] = octets as [number, number];
    if (a === 0) reject("wildcard address");
    if (a === 127) reject("loopback address");
    if (a === 169 && b === 254) reject("link-local address");
    if (a === 100 && b >= CGNAT_SECOND_OCTET_MIN && b <= CGNAT_SECOND_OCTET_MAX) {
      const attached = interfaces.some((entry) => entry.addresses.includes(host));
      if (!attached) reject("address is not on an active interface");
      return;
    }
    reject("address is outside the Tailscale 100.64.0.0/10 range");
  }
  if (family === 6) {
    const lower = stripIpv6Zone(host); // strip zone id
    if (lower === "::" || lower === "0:0:0:0:0:0:0:0") reject("wildcard address");
    if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") reject("loopback address");
    if (
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    ) {
      reject("link-local address");
    }
    reject("Tailscale v1 binds IPv4 CGNAT addresses only");
  }
}

/** OS-backed inspector: reads active interfaces at assert time. */
export class OsTailscaleInspector implements TailscaleInspector {
  assertBindable(host: string): void {
    validateBindableHost(host, activeInterfaces());
  }
}

/** Rejected bearer-fallback bind (decision 2026-xx-tokenless-auth-and-app-layout
 * §D-A3). Distinct from `BindRejectedError` and `LoopbackBindRejectedError` so
 * callers can tell a refused tailnet bind from a refused fallback bind. */
export class FallbackBindRejectedError extends Error {
  override readonly name = "FallbackBindRejectedError";
  constructor(reason: string) {
    super(`bearer-fallback bind rejected: ${reason}`);
  }
}

/** Rejected tailscale-mode loopback bind (decision §D-A4 amendment).
 * Distinct so callers can tell a refused loopback secondary bind from a
 * refused tailnet primary or a refused bearer-fallback bind. */
export class LoopbackBindRejectedError extends Error {
  override readonly name = "LoopbackBindRejectedError";
  constructor(reason: string) {
    super(`loopback bind rejected: ${reason}`);
  }
}

/** Tailscale-mode loopback bind policy (decision §D-A4 amendment): the
 * secondary listener may bind only a loopback IP literal — IPv4 127.0.0.0/8
 * or IPv6 ::1. Loopback traffic never leaves the host, so the listener
 * cannot widen the off-box surface; anything else (wildcard, LAN, CGNAT,
 * hostnames, non-literals) refuses startup fail-closed. No interface
 * membership check: the loopback device is internal by definition and is
 * deliberately excluded from `activeInterfaces`. */
export function validateLoopbackBindHost(host: string): void {
  const reject = (reason: string) => {
    throw new LoopbackBindRejectedError(reason);
  };
  const family = isIP(host);
  if (family === 0) reject("host must be an explicit IP literal");
  if (family === 4) {
    const firstOctet = host.split(".")[0] ?? "0";
    const first = Number.parseInt(firstOctet, 10);
    if (first !== 127) reject("address is not an IPv4 loopback literal (127.0.0.0/8)");
    return;
  }
  const lower = stripIpv6Zone(host); // strip zone id
  if (lower !== "::1" && lower !== "0:0:0:0:0:0:0:1") {
    reject("address is not the IPv6 loopback literal ::1");
  }
}

/** Bearer-fallback bind policy (decision §D-A3): the fallback listener is the
 * explicit non-Tailscale path (pure LAN / loopback operation), so any explicit
 * IP literal is bindable — loopback, link-local, and ordinary LAN included —
 * except wildcard/unspecified, multicast, and reserved addresses. The trust
 * boundary here is the bearer token, never the interface. */
export function validateFallbackBindHost(host: string): void {
  const reject = (reason: string) => {
    throw new FallbackBindRejectedError(reason);
  };
  const family = isIP(host);
  if (family === 0) reject("host must be an explicit IP literal");
  if (family === 4) {
    const octets = host.split(".").map((value) => Number.parseInt(value, 10));
    const [a] = octets as [number, number];
    if (a === 0) reject("wildcard address");
    if (a >= 224 && a <= 239) reject("multicast address"); // 224.0.0.0/4
    if (a === 255) reject("reserved address");
    return;
  }
  if (family === 6) {
    const lower = stripIpv6Zone(host); // strip zone id
    if (lower === "::" || lower === "0:0:0:0:0:0:0:0") reject("wildcard address");
    if (lower.startsWith("ff")) reject("multicast address"); // ff00::/8
  }
}

export function activeInterfaces(): InterfaceSnapshot[] {
  const result: InterfaceSnapshot[] = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    const live = (addresses ?? []).filter((address) => !address.internal);
    if (live.length === 0) continue;
    result.push({ name, addresses: live.map((address) => address.address) });
  }
  return result;
}
