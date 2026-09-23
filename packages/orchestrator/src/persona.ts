/**
 * Persona id resolution for worker prompts (D3 of
 * docs/decisions/2026-09-22-worker-persona-contract.md).
 *
 * The registry maps a persona id (file stem under config/personas/) to the
 * instruction text injected into the worker prompt. Resolution is advisory:
 * an unknown id or a missing default never fails a worker — it only produces
 * a one-line warning that the orchestrator prepends to the worker result
 * summary. loop-core and providers never see persona vocabulary; adapters
 * receive the already-resolved text via StartWorkerInput.personaInstructions.
 */

export type PersonaRegistry = Record<string, string>;

/**
 * kind → default persona id used when the task specifies no persona. Key
 * insertion order doubles as the canonical presentation order for PERSONA_IDS
 * derived below, so adapters never hand-order persona id lists.
 */
export const KIND_DEFAULT_PERSONAS: Record<string, string> = {
  implementation: "implementer",
  verification: "reviewer",
  research: "debugger",
  decision: "architect",
  integration: "architect",
};

/** Persona ids no task kind defaults to; honored only when requested explicitly. */
export const EXPLICIT_ONLY_PERSONA_IDS: readonly string[] = ["designer"];

/** Every persona id accepted at submission, derived from the defaults above. */
export const PERSONA_IDS: readonly string[] = [
  ...new Set([...Object.values(KIND_DEFAULT_PERSONAS), ...EXPLICIT_ONLY_PERSONA_IDS]),
];

export interface PersonaResolution {
  /** Id whose registry text was selected; undefined when the section is omitted. */
  id?: string;
  /** Instruction text for the worker prompt; undefined when the section is omitted. */
  instructions?: string;
  /** One-line warning to prepend to the recorded worker result summary. */
  warning?: string;
}

export interface ResolvePersonaInput {
  /** Persona id requested by the Lead; null/absent/blank selects the kind default. */
  requested?: string | null;
  kind: string;
  registry: PersonaRegistry;
}

export function resolvePersona({ requested, kind, registry }: ResolvePersonaInput): PersonaResolution {
  const id = requested?.trim();
  const defaultId = KIND_DEFAULT_PERSONAS[kind];
  const defaultInstructions = defaultId ? registry[defaultId] : undefined;
  if (id) {
    const explicit = registry[id];
    if (explicit) return { id, instructions: explicit };
    if (defaultId && defaultInstructions) {
      return {
        id: defaultId,
        instructions: defaultInstructions,
        warning: `[persona] unknown id '${id}' — fell back to '${defaultId}' (kind=${kind})`,
      };
    }
    return {
      warning: `[persona] unknown id '${id}' — no default persona for kind=${kind}; section omitted`,
    };
  }
  if (defaultId && defaultInstructions) return { id: defaultId, instructions: defaultInstructions };
  // A never-configured registry (no config/personas directory) means the
  // feature is simply not installed — stay silent. A non-empty registry
  // missing this kind's default is a config regression — warn.
  if (Object.keys(registry).length === 0) return {};
  if (defaultId) {
    return { warning: `[persona] default persona '${defaultId}' missing for kind=${kind}; section omitted` };
  }
  return {};
}
