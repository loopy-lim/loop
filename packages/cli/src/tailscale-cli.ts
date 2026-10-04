/**
 * Tailscale CLI resolution for the MagicDNS / bind-IP probes (decision:
 * MagicDNS-first amendment). On this machine the `tailscale` binary is not on
 * PATH; the GUI install ships the same CLI inside the app bundle
 * (/Applications/Tailscale.app/Contents/MacOS/Tailscale). Both the `loop
 * pair` MagicDNS lookup and the gateway auto-spawn bind-IP discovery must
 * therefore try PATH first and fall back to the bundle path — the probe
 * surface (`status --json`) is identical, so only the executable differs.
 */

/** Structural twin of gateway.ts's `Probe` — declared here (instead of
 * imported) so this leaf module stays free of cli-module cycles. */
type TailscaleProbe = (
  command: string,
  args: string[],
) => Promise<{ exitCode: number; output: string }>;

/** Executables tried in order: PATH lookup first, then the macOS app bundle
 * CLI. On non-macOS hosts the bundle spawn simply fails and is skipped, so
 * the list is safe to try unconditionally. */
export const TAILSCALE_CLI_CANDIDATES = [
  "tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
] as const;

/** Arg variants for `status --json`, tried in order per executable. The
 * peers-less form comes first: the full status JSON grows with the tailnet
 * and the shared CLI probe path caps captured output, which mangles large
 * payloads mid-JSON. `--peers=false` keeps only Self (all the MagicDNS and
 * bind-IP logic reads); CLI versions that reject the flag fall back to the
 * plain form. */
export const TAILSCALE_STATUS_ARG_VARIANTS = [
  ["status", "--json", "--peers=false"],
  ["status", "--json"],
] as const;

/** Run `tailscale status --json` against the first candidate executable and
 * argument variant that answers successfully. Returns the winning probe
 * result, or null when every combination is absent/unreachable or exits
 * non-zero — callers treat null as "no Tailscale here" and fall through to
 * the next host source. */
export async function probeTailscaleStatus(
  probe: TailscaleProbe,
): Promise<{ exitCode: number; output: string } | null> {
  for (const command of TAILSCALE_CLI_CANDIDATES) {
    for (const args of TAILSCALE_STATUS_ARG_VARIANTS) {
      let result: { exitCode: number; output: string };
      try {
        result = await probe(command, [...args]);
      } catch {
        continue;
      }
      if (result.exitCode === 0) return result;
    }
  }
  return null;
}
