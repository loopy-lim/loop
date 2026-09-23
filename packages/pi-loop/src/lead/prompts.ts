// Subpath import: the persona module is a leaf (see extension.ts), keeping the
// prompt prose single-sourced with the orchestrator's persona registry.
import { KIND_DEFAULT_PERSONAS, PERSONA_IDS } from "@loop/orchestrator/persona";
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

/** Persona prose derived from the orchestrator's persona registry so new
 * personas sync into the Lead prompt without editing this file. Order follows
 * PERSONA_IDS / KIND_DEFAULT_PERSONAS insertion order (the canonical
 * presentation order per the persona module contract). */
const PERSONA_LIST_PROSE = PERSONA_IDS.join(" | ");
const KIND_DEFAULTS_PROSE = Object.entries(KIND_DEFAULT_PERSONAS)
  .map(([kind, id]) => `${kind}→${id}`)
  .join(", ");

export function taskSpecInputDescription(): string {
  return [
    "JSON TaskSpecInput[] using the generated protocol fields.",
    "Dependencies must reference task ids; scopes must state exact read and write ownership; completion checks must be machine-verifiable.",
    `Each task may carry an optional "persona" id (${PERSONA_LIST_PROSE}); unknown ids are rejected at submission with the valid id list. Kind defaults: ${KIND_DEFAULTS_PROSE}.`,
    `Typed example: ${JSON.stringify([TASK_SPEC_INPUT_EXAMPLE])}`,
  ].join(" ");
}

export function decompositionPrompt(intent: string): string {
  return [
    "Decompose this engineering intent into a small dependency DAG.",
    "Return typed tasks only. Facts may run in parallel; decisions and integration are serialized.",
    "Every task needs dependencies, exact read and write ownership, compute bounds, and machine-verifiable completion checks.",
    "Describe expected outputs in requirements so each worker returns a concise result summary with evidence; dependent tasks receive dependency result summaries.",
    taskSpecInputDescription(),
    intent.trim(),
  ].join("\n");
}
