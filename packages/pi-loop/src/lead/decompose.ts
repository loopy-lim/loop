import type { TaskSpecInput } from "@loop/protocol";

export function validateDecomposition(tasks: TaskSpecInput[]): TaskSpecInput[] {
  if (tasks.length === 0) throw new Error("decomposition must contain tasks");
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!task.id.trim() || ids.has(task.id)) throw new Error(`invalid task id: ${task.id}`);
    ids.add(task.id);
    if (task.completionChecks.length === 0) {
      throw new Error(`task requires a completion contract: ${task.id}`);
    }
    if (
      ["decision", "implementation", "integration"].includes(task.kind)
      && task.writeScope.length === 0
    ) {
      throw new Error(`task requires explicit write ownership: ${task.id}`);
    }
  }
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency)) {
        throw new Error(`task ${task.id} has missing dependency ${dependency}`);
      }
    }
  }
  assertAcyclic(tasks);
  return tasks;
}

function assertAcyclic(tasks: TaskSpecInput[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const complete = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (complete.has(id)) return;
    if (visiting.has(id)) throw new Error(`dependency cycle contains ${id}`);
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) visit(dependency);
    visiting.delete(id);
    complete.add(id);
  };
  for (const task of tasks) visit(task.id);
}
