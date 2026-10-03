import type { GoalCriterionInput, TaskSpecInput } from "@loop/protocol";

export interface GoalPlan {
  tasks: TaskSpecInput[];
  criteria: GoalCriterionInput[];
}

/** Submission gate for the Lead's explicit requirement-to-check mapping. */
export function validateGoalPlan(plan: GoalPlan): GoalPlan {
  const tasks = validateDecomposition(plan.tasks);
  if (!Array.isArray(plan.criteria) || plan.criteria.length === 0)
    throw new Error("goal plan requires explicit criteria");
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const criterionIds = new Set<string>();
  const covered = new Set<string>();
  for (const item of plan.criteria) {
    const task = byId.get(item.taskId);
    if (!task) throw new Error(`criterion ${item.id} names missing task ${item.taskId}`);
    if (!item.id?.trim() || criterionIds.has(item.id))
      throw new Error(`duplicate or empty criterion id: ${item.id}`);
    criterionIds.add(item.id);
    if (!task.requirements.includes(item.description))
      throw new Error(`criterion ${item.id} does not match a requirement of ${task.id}`);
    const key = `${task.id}\0${item.description}`;
    if (covered.has(key))
      throw new Error(`duplicate criterion for ${task.id}: ${item.description}`);
    covered.add(key);
    const checkIds = new Set(task.completionChecks.map((check) => check.id));
    if (
      !Array.isArray(item.checkIds) ||
      item.checkIds.length === 0 ||
      new Set(item.checkIds).size !== item.checkIds.length
    ) {
      throw new Error(`criterion ${item.id} needs distinct check IDs`);
    }
    for (const checkId of item.checkIds)
      if (!checkIds.has(checkId))
        throw new Error(`criterion ${item.id} names missing check ${checkId}`);
  }
  for (const task of tasks) {
    for (const requirement of task.requirements) {
      if (!covered.has(`${task.id}\0${requirement}`))
        throw new Error(`requirement of ${task.id} has no explicit criterion: ${requirement}`);
    }
  }
  const implementations = tasks.filter((task) => task.kind === "implementation");
  if (implementations.length > 1) {
    const ancestors = (id: string): Set<string> => {
      const result = new Set<string>();
      const visit = (current: string) => {
        for (const dependency of byId.get(current)?.dependencies ?? []) {
          if (result.has(dependency)) continue;
          result.add(dependency);
          visit(dependency);
        }
      };
      visit(id);
      return result;
    };
    const gate = tasks.find(
      (task) =>
        task.kind === "integration" &&
        implementations.every((implementation) => ancestors(task.id).has(implementation.id)),
    );
    if (!gate)
      throw new Error(
        `multi-implementation plan needs a downstream integration task depending on ${implementations.map((task) => task.id).join(", ")}`,
      );
  }
  return plan;
}

export function validateDecomposition(tasks: TaskSpecInput[]): TaskSpecInput[] {
  if (tasks.length === 0) throw new Error("decomposition must contain tasks");
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!task.id.trim() || ids.has(task.id)) throw new Error(`invalid task id: ${task.id}`);
    ids.add(task.id);
    if (task.completionChecks.length === 0) {
      throw new Error(`task requires a completion contract: ${task.id}`);
    }
    if (task.requirements.length === 0 || task.requirements.some((item) => !item.trim())) {
      throw new Error(`task requires explicit goal requirements: ${task.id}`);
    }
    if (
      !task.routing ||
      !task.routing.required ||
      !["low", "medium", "high", "critical"].includes(task.routing.risk)
    ) {
      throw new Error(`task requires explicit routing risk and capabilities: ${task.id}`);
    }
    if (
      ["decision", "implementation", "integration"].includes(task.kind) &&
      task.writeScope.length === 0
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
