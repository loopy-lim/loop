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

/** kind → default persona id mapping (single source: docs/decisions/2026-09-24-persona-defaults-config.md C2). */
export type PersonaKindDefaults = Record<string, string>;

/**
 * kind → default persona id used when the task specifies no persona.
 *
 * Compile-time fallback: `config/personas/defaults.toml` overrides these
 * values per kind (merged in LoopConfig.personaKindDefaults), so an
 * uninstalled or partial config file never leaves a kind without a floor.
 * Key insertion order doubles as the canonical presentation order for the
 * vocabulary derived below, so adapters never hand-order persona id lists.
 */
export const KIND_DEFAULT_PERSONAS: PersonaKindDefaults = {
  implementation: "implementer",
  verification: "reviewer",
  research: "debugger",
  decision: "architect",
  integration: "architect",
};

/**
 * Persona ids no task kind defaults to; honored only when requested
 * explicitly. Floor for the not-installed case only — once a persona
 * registry or a kind-defaults mapping exists, the explicit-only set is
 * derived (see derivePersonaVocabulary) instead of read from here.
 */
export const EXPLICIT_ONLY_PERSONA_IDS: readonly string[] = ["designer"];

/**
 * Persona ids owned by the Lead, not worker-selectable. `config/personas/`
 * is shared with Lead standing rules ([lead.persona.files] in providers
 * config); the worker registry skips those files so Lead-only instruction
 * layers never grow the worker submission vocabulary.
 */
export const LEAD_PERSONA_IDS: readonly string[] = ["lead-default"];

/**
 * Every persona id accepted at submission when the feature is not installed.
 * Derived from the compile-time floor above; a configured registry derives
 * its own vocabulary (see derivePersonaVocabulary).
 */
export const PERSONA_IDS: readonly string[] = [
  ...new Set([...Object.values(KIND_DEFAULT_PERSONAS), ...EXPLICIT_ONLY_PERSONA_IDS]),
];

/**
 * Submission-facing persona vocabulary derived from the registry and the
 * merged kind defaults (docs/decisions/2026-09-24-persona-defaults-config.md
 * C3/C4). The Lead validates TaskSpecInput.persona against `ids` and renders
 * `kindDefaults`/`explicitOnly` into its prompt prose — always from a derived
 * instance, never from module constants.
 */
export interface PersonaVocabulary {
  /** Every persona id accepted at submission, in canonical presentation order. */
  ids: readonly string[];
  /** Merged kind → default persona id mapping (config overrides over the compile-time floor). */
  kindDefaults: Readonly<PersonaKindDefaults>;
  /** Ids no task kind defaults to; honored only when requested explicitly. */
  explicitOnly: readonly string[];
}

/**
 * Derive the persona vocabulary: valid ids are the registry keys plus the
 * kind-default values (fixing registry drift — a new config/personas/pirate.md
 * is accepted at submission without code changes); explicit-only is the
 * complement of the default values. An empty registry means the feature is
 * not installed — the compile-time floor set (PERSONA_IDS) is used so
 * submission validation and prose never collapse.
 */
export function derivePersonaVocabulary(
  registry: PersonaRegistry,
  kindDefaults: PersonaKindDefaults = KIND_DEFAULT_PERSONAS,
): PersonaVocabulary {
  const defaultIds = Object.values(kindDefaults);
  const base = Object.keys(registry).length > 0 ? Object.keys(registry) : PERSONA_IDS;
  const explicitOnly = [...new Set(base)].filter((id) => !defaultIds.includes(id)).toSorted();
  return { ids: [...new Set(defaultIds), ...explicitOnly], kindDefaults, explicitOnly };
}

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
  /** Merged kind defaults (config overrides over the compile-time floor). */
  defaults?: PersonaKindDefaults;
}

export function resolvePersona({
  requested,
  kind,
  registry,
  defaults = KIND_DEFAULT_PERSONAS,
}: ResolvePersonaInput): PersonaResolution {
  const id = requested?.trim();
  const defaultId = defaults[kind];
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
    return {
      warning: `[persona] default persona '${defaultId}' missing for kind=${kind}; section omitted`,
    };
  }
  return {};
}
