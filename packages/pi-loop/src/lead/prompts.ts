export function decompositionPrompt(intent: string): string {
  return [
    "Decompose this engineering intent into a small dependency DAG.",
    "Return typed tasks only. Facts may run in parallel; decisions and integration are serialized.",
    "Every task needs dependencies, read/write scopes, compute bounds, and completion checks.",
    intent.trim(),
  ].join("\n");
}
