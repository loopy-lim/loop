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

export function taskSpecInputDescription(): string {
  return [
    "JSON TaskSpecInput[] using the generated protocol fields.",
    "Dependencies must reference task ids; scopes must state exact read and write ownership; completion checks must be machine-verifiable.",
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
