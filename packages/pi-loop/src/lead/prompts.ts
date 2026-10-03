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
  dependencies: [],
  readScope: ["packages/example/src/**"],
  writeScope: ["packages/example/src/change.ts"],
  requirements: ["Return a concise result summary with evidence for dependent tasks"],
  completionChecks: [
    {
      id: "focused-tests",
      command: "bun",
      args: ["test", "packages/example/test"],
      workingDirectory: null,
      timeoutMs: 120_000,
    },
  ],
  preferredCompute: "fast",
  minimumCompute: "tiny",
  maximumCompute: "strong",
  routing: {
    risk: "low",
    required: { coding: 2, reasoning: 1, tools: 1, vision: 0, long_context: 1 },
  },
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
    "JSON object {tasks: TaskSpecInput[], criteria: GoalCriterionInput[]} using the generated protocol fields. Each criterion has id, taskId, description equal to one task requirement, and checkIds naming only the checks that prove it. Cover every requirement explicitly; do not attach all checks to every requirement by default.",
    "Dependencies must reference task ids; scopes must state exact read and write ownership; completion checks must be machine-verifiable.",
    "Every task needs routing.risk and routing.required capability scores (coding, reasoning, tools, vision, long_context; 0 to 5). Use low for bounded edits, high for cross-module decisions and integration, and critical only for genuinely high-consequence work. Request only capabilities the task uses.",
    `Each task may carry an optional "persona" id (${personaListProse}); unknown ids are rejected at submission with the valid id list. Kind defaults: ${kindDefaultsProse}.`,
    `Typed example: ${JSON.stringify({ tasks: [TASK_SPEC_INPUT_EXAMPLE], criteria: [{ id: "implementation:1", taskId: "implementation", description: TASK_SPEC_INPUT_EXAMPLE.requirements[0], checkIds: ["focused-tests"] }] })}`,
  ].join(" ");
}

export function decompositionPrompt(intent: string, vocabulary: PersonaVocabulary): string {
  return [
    "Decompose this engineering intent into a small dependency DAG.",
    "Put independent fact-finding and non-overlapping implementation tasks in the same parallel frontier.",
    "Keep each readScope to files the task actually reads. A sibling task's write path in readScope serializes them even when their write scopes do not overlap.",
    "Keep dependency-ordered work sequential, and serialize decision and integration tasks.",
    "For a small bounded change, delegate directly to one execution task with focused completion checks. Do not add ceremonial research or decision tasks.",
    "Add a separate verification task only for material risk or acceptance criteria that need an independent reviewer; each extra worker has latency and cost.",
    "Map the original intent to executable checks that cover each acceptance criterion; a generic test command is insufficient when its tests omit a stated behavior.",
    "For two or more implementation tasks, add an integration task depending transitively on every implementation task; its checks must run against the combined result.",
    "Rust bridge or generated protocol changes also need a TypeScript typecheck after codegen; focused Rust and generated-runtime tests alone can miss stale TypeScript consumers and fixtures.",
    "Put a check that needs downstream consumer edits on the downstream task. If the producer's completion checks require those edits, its dependent consumer task can never start.",
    "Every task needs dependencies, exact read and write ownership, compute bounds, and machine-verifiable completion checks.",
    "Prefer fast for narrow implementation and strong for high-risk decisions or integration; the Rust router applies the risk floor and chooses the least costly sufficient configured worker.",
    "Describe expected outputs in requirements so each worker returns a concise result summary with evidence; dependent tasks receive dependency result summaries.",
    taskSpecInputDescription(vocabulary),
    intent.trim(),
  ].join("\n");
}
