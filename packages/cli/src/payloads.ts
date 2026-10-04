import type { GoalCriterionInput, TaskSpecInput } from "@loop/protocol";

import { UsageError } from "./cli-shared";

export function parseExecutionPayload(value: string): {
  intent?: string;
  runId: string;
  workingDirectory: string;
  tasks: TaskSpecInput[];
  criteria?: GoalCriterionInput[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new UsageError("__execute-plan requires a JSON payload on stdin");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError("invalid execution payload");
  }
  const payload = parsed as Record<string, unknown>;
  if (typeof payload.runId !== "string" || !payload.runId.trim()) {
    throw new UsageError("execution payload requires runId");
  }
  if (typeof payload.workingDirectory !== "string" || !payload.workingDirectory.startsWith("/")) {
    throw new UsageError("execution payload requires an absolute workingDirectory");
  }
  if (!Array.isArray(payload.tasks) || payload.tasks.length === 0) {
    throw new UsageError("execution payload requires tasks");
  }
  if (
    payload.criteria !== undefined &&
    (!Array.isArray(payload.criteria) || payload.criteria.length === 0)
  ) {
    throw new UsageError("execution payload criteria must be a non-empty array");
  }
  return {
    intent: typeof payload.intent === "string" ? payload.intent : undefined,
    runId: payload.runId,
    workingDirectory: payload.workingDirectory,
    tasks: payload.tasks as TaskSpecInput[],
    ...(payload.criteria ? { criteria: payload.criteria as GoalCriterionInput[] } : {}),
  };
}

export function parseAgentComparisonManifest(value: string): {
  name: string;
  intent: string;
  sourceDirectory?: string;
  configDirectory?: string;
  tasks: TaskSpecInput[];
  criteria: GoalCriterionInput[];
  candidateIds: string[];
  iterations: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new UsageError("agent comparison manifest must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new UsageError("agent comparison manifest must be an object");
  const item = parsed as Record<string, unknown>;
  if (
    typeof item.name !== "string" ||
    !item.name.trim() ||
    typeof item.intent !== "string" ||
    !item.intent.trim() ||
    !Array.isArray(item.tasks) ||
    !Array.isArray(item.criteria) ||
    !Array.isArray(item.candidateIds) ||
    item.candidateIds.some((id) => typeof id !== "string" || !id.trim()) ||
    (item.sourceDirectory !== undefined &&
      (typeof item.sourceDirectory !== "string" || !item.sourceDirectory.startsWith("/"))) ||
    (item.configDirectory !== undefined &&
      (typeof item.configDirectory !== "string" || !item.configDirectory.trim()))
  ) {
    throw new UsageError(
      "agent comparison needs name, intent, tasks, criteria, candidateIds, and an optional absolute sourceDirectory",
    );
  }
  return {
    name: item.name,
    intent: item.intent,
    tasks: item.tasks as TaskSpecInput[],
    criteria: item.criteria as GoalCriterionInput[],
    candidateIds: item.candidateIds as string[],
    iterations: item.iterations === undefined ? 1 : Number(item.iterations),
    ...(item.sourceDirectory ? { sourceDirectory: item.sourceDirectory as string } : {}),
    ...(item.configDirectory ? { configDirectory: item.configDirectory as string } : {}),
  };
}

export function parseTaskPayload(value: string): TaskSpecInput {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as TaskSpecInput;
  } catch {
    /* stable usage error below */
  }
  throw new UsageError("add-task requires a TaskSpecInput JSON object on stdin");
}

export function parseGoalTaskPayload(value: string): {
  task: TaskSpecInput;
  criteria: GoalCriterionInput[];
} {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const payload = parsed as Record<string, unknown>;
      if (
        payload.task &&
        typeof payload.task === "object" &&
        Array.isArray(payload.criteria) &&
        payload.criteria.length > 0
      ) {
        return {
          task: payload.task as TaskSpecInput,
          criteria: payload.criteria as GoalCriterionInput[],
        };
      }
    }
  } catch {
    /* stable usage error below */
  }
  throw new UsageError("add-goal-task requires task and non-empty criteria JSON");
}

export function parsePromoteSteerPayload(value: string): {
  message: string;
  task: TaskSpecInput;
  criteria: GoalCriterionInput[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new UsageError("promote-steer requires a JSON payload on stdin");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError("promote-steer payload must be a JSON object");
  }
  const payload = parsed as Record<string, unknown>;
  if (typeof payload.message !== "string" || !payload.message.trim()) {
    throw new UsageError("promote-steer payload requires a non-empty user message");
  }
  if (!payload.task || typeof payload.task !== "object" || Array.isArray(payload.task)) {
    throw new UsageError("promote-steer payload requires a dependent task object");
  }
  const task = payload.task as Record<string, unknown>;
  if (typeof task.id !== "string" || !task.id.trim()) {
    throw new UsageError("promote-steer dependent task requires a non-empty id");
  }
  if (!Array.isArray(payload.criteria) || payload.criteria.length === 0) {
    throw new UsageError("promote-steer payload requires non-empty criteria");
  }
  for (const criterion of payload.criteria) {
    if (!criterion || typeof criterion !== "object" || Array.isArray(criterion)) {
      throw new UsageError("promote-steer criteria must be GoalCriterionInput objects");
    }
  }
  return {
    message: payload.message,
    task: payload.task as TaskSpecInput,
    criteria: payload.criteria as GoalCriterionInput[],
  };
}
