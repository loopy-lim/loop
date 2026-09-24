// Subpath import: the persona module is a leaf (see extension.ts), keeping
// the prompt prose single-sourced with the orchestrator's persona derivation.
// The vocabulary arrives as a parameter derived once from configuration at
// extension registration — statically precomputed prose from the module
// constants is a regression this file must not reintroduce.
import type { PersonaVocabulary } from "@loop/orchestrator/persona";
import type { TaskSpecInput } from "@loop/protocol";

export const TASK_SPEC_INPUT_EXAMPLE = {
  id: "implementation",
  title: "Implement the approved change",
  kind: "implementation",
  dependencies: ["decision"],
  readScope: ["packages/example/src/**"],
  writeScope: ["packages/example/src/change.ts"],
  requirements: ["Return a concise result summary with evidence for dependent tasks"],
  completionChecks: [{
    id: "focused-tests",
    command: "bun",
    args: ["test", "packages/example/test"],
    workingDirectory: null,
    timeoutMs: 120_000,
  }],
  preferredCompute: "fast",
  minimumCompute: "tiny",
  maximumCompute: "strong",
  maxAttempts: 3,
} satisfies TaskSpecInput;

/** Persona prose rendered from the caller's vocabulary so config changes
 * (registry additions, kind-default overrides) flow into the Lead prompt
 * without editing this file. Order follows the vocabulary's canonical
 * presentation order (kind-default values first, remainder sorted). */
export function taskSpecInputDescription(vocabulary: PersonaVocabulary): string {
  const personaListProse = vocabulary.ids.join(" | ");
  const kindDefaultsProse = Object.entries(vocabulary.kindDefaults)
    .map(([kind, id]) => `${kind}→${id}`)
    .join(", ");
  return [
    "JSON TaskSpecInput[] using the generated protocol fields.",
    "Dependencies must reference task ids; scopes must state exact read and write ownership; completion checks must be machine-verifiable.",
    `Each task may carry an optional "persona" id (${personaListProse}); unknown ids are rejected at submission with the valid id list. Kind defaults: ${kindDefaultsProse}.`,
    `Typed example: ${JSON.stringify([TASK_SPEC_INPUT_EXAMPLE])}`,
  ].join(" ");
}

export function decompositionPrompt(intent: string, vocabulary: PersonaVocabulary): string {
  return [
    "Decompose this engineering intent into a small dependency DAG.",
    "Put independent fact-finding and non-overlapping implementation tasks in the same parallel frontier.",
    "Keep dependency-ordered work sequential, and serialize decision and integration tasks.",
    "For a small bounded change, delegate directly to an execution task. Do not add ceremonial research or decision tasks.",
    "Map every acceptance criterion in the original intent to implementation and verification tasks; do not treat worker success alone as goal completion.",
    "Every task needs dependencies, exact read and write ownership, compute bounds, and machine-verifiable completion checks.",
    "Describe expected outputs in requirements so each worker returns a concise result summary with evidence; dependent tasks receive dependency result summaries.",
    taskSpecInputDescription(vocabulary),
    intent.trim(),
  ].join("\n");
}
