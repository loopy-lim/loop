import type { SandboxCapabilityDeclaration, SandboxIsolation } from "@loop/protocol";

import type { AgentProvider } from "./types";

/**
 * Adapter sandbox capability declaration (gap analysis G4a — 샌드박스
 * 사실성, 부분도입).
 *
 * Boundary: Loop does not implement OS isolation. Declared write scopes
 * remain a scheduler collision-avoidance contract, NOT a security boundary.
 * Adapters declare what isolation they CAN apply around worker execution and
 * reporting surfaces (e.g. `loop doctor`) relay the declaration honestly —
 * an absent capability is `none`, never inferred from write scopes.
 */

const DETAIL_LIMIT = 300;

export interface SandboxDeclarationInput {
  adapterId: string;
  isolation: SandboxIsolation;
  filesystemScoped: boolean;
  networkIsolated: boolean;
  /** Bounded human note on the mechanism and its limits; null when the flags say everything. */
  detail?: string | null;
}

export function sandboxDeclaration(input: SandboxDeclarationInput): SandboxCapabilityDeclaration {
  const detail = input.detail?.trim();
  return {
    adapterId: input.adapterId,
    isolation: input.isolation,
    filesystemScoped: input.filesystemScoped,
    networkIsolated: input.networkIsolated,
    detail: detail ? detail.slice(0, DETAIL_LIMIT) : null,
  };
}

/** The honest no-isolation declaration; adapters without sandbox support report this rather than omitting themselves. */
export function noSandboxDeclaration(
  adapterId: string,
  detail?: string,
): SandboxCapabilityDeclaration {
  return sandboxDeclaration({
    adapterId,
    isolation: "none",
    filesystemScoped: false,
    networkIsolated: false,
    detail,
  });
}

/**
 * Collects one declaration per provider (G4a, `loop.sandbox_capabilities`
 * payload shape). A provider that does not implement `sandboxDeclaration`
 * is reported with `isolation: none` — absence is declared, never guessed.
 */
export function collectSandboxCapabilities(
  providers: readonly AgentProvider[],
): SandboxCapabilityDeclaration[] {
  return providers.map(
    (provider) => provider.sandboxDeclaration?.() ?? noSandboxDeclaration(provider.id),
  );
}
