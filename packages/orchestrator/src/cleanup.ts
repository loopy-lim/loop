import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { promisify } from "node:util";

import type { HerdrCaller, HerdrWorkerRuntime } from "@loop/herdr";
import type { SkippedArtifactOutput } from "@loop/protocol";

import type { OrchestrationControl } from "./control";

const execFileAsync = promisify(execFile);

export interface CleanupRunRequest {
  databasePath: string;
  runId: string;
  keepRecent?: number;
  dryRun?: boolean;
  projectRoot?: string;
  worktrees?: string[];
  worktree?: string;
  caller?: HerdrCaller;
  isLeadPane?: boolean;
  isMerged?: boolean;
  isClean?: boolean;
  herdr?: HerdrWorkerRuntime;
}

export interface CleanupRunReport {
  removedArtifacts: string[];
  skippedArtifacts: SkippedArtifactOutput[];
  reasons: Record<string, string>;
}

interface RegisteredWorktree {
  path: string;
  head?: string;
  fingerprint: string;
}

interface WorktreePlan {
  requestedPath: string;
  canonicalPath: string;
  projectRoot: string;
  candidateHead: string;
  mainHead: string;
  candidateRegistration: string;
  mainRegistration: string;
}

export async function cleanupRun(
  control: OrchestrationControl,
  request: CleanupRunRequest,
): Promise<CleanupRunReport> {
  const dryRun = request.dryRun ?? true;
  const keepRecent = request.keepRecent ?? 8;
  const reasons: Record<string, string> = {};

  // The bridge owns run-state and retention policy. Always plan first so no
  // external effect can precede a run refusal or race with a retained run.
  const storePlan = await control.cleanupRun({
    databasePath: request.databasePath,
    runId: request.runId,
    keepRecent,
    dryRun: true,
  });
  if (storePlan.skippedArtifacts.length > 0) {
    return report([], storePlan.skippedArtifacts, reasons);
  }
  if (!storePlan.removedArtifacts.includes(request.runId)) {
    // The record is already gone. Without it, Loop cannot establish ownership
    // or terminal state for any associated external artifact.
    return report([], [], reasons);
  }

  const skippedArtifacts: SkippedArtifactOutput[] = [];
  const surfaceId = cleanupSurfaceId(request);
  const hasSurface = Boolean(request.herdr || request.caller || request.isLeadPane);

  if (hasSurface) {
    const surfaceEvaluation = await control.evaluateSurfaceRemoval({
      surfaceId,
      isOwnedByLoop: !request.caller && !request.isLeadPane,
    });
    if (!surfaceEvaluation.allowed) {
      skippedArtifacts.push({
        artifact: surfaceId,
        reason: surfaceEvaluation.reason ?? "surface removal refused",
      });
    }
  }

  const requestedWorktrees = [
    ...new Set([...(request.worktrees ?? []), ...(request.worktree ? [request.worktree] : [])]),
  ];
  const worktreePlans: WorktreePlan[] = [];
  if (requestedWorktrees.length > 0) {
    const projectRoot = request.projectRoot ?? process.cwd();
    for (const worktreePath of requestedWorktrees) {
      const planned = await inspectWorktree(control, projectRoot, worktreePath);
      if ("reason" in planned) {
        skippedArtifacts.push({ artifact: worktreePath, reason: planned.reason });
      } else {
        worktreePlans.push(planned);
      }
    }
  }

  // A refusal for one artifact blocks all teardown for the run. This prevents
  // partial cleanup from destroying the evidence needed to resolve it.
  if (skippedArtifacts.length > 0) {
    return report([], skippedArtifacts, reasons);
  }

  if (dryRun) {
    const plannedArtifacts = [
      ...storePlan.removedArtifacts,
      ...(hasSurface ? [surfaceId] : []),
      ...worktreePlans.map((plan) => plan.requestedPath),
    ];
    for (const artifact of plannedArtifacts) reasons[artifact] = "dry_run";
    return report(plannedArtifacts, [], reasons);
  }

  const removedArtifacts: string[] = [];
  if (request.herdr) {
    try {
      const result = await request.herdr.closeWorkspace(request.runId);
      if (!result.closed) {
        return report(
          removedArtifacts,
          [
            {
              artifact: surfaceId,
              reason: result.reason ?? "surface teardown did not confirm closure",
            },
          ],
          reasons,
        );
      }
      removedArtifacts.push(surfaceId);
      if (result.reason) reasons[surfaceId] = result.reason;
    } catch (error) {
      return report(
        removedArtifacts,
        [
          {
            artifact: surfaceId,
            reason: `failed to close surface: ${errorMessage(error)}`,
          },
        ],
        reasons,
      );
    }
  }

  for (const plan of worktreePlans) {
    const current = await inspectWorktree(control, plan.projectRoot, plan.requestedPath);
    if ("reason" in current) {
      return report(
        removedArtifacts,
        [
          {
            artifact: plan.requestedPath,
            reason: `worktree changed after cleanup preflight: ${current.reason}`,
          },
        ],
        reasons,
      );
    }
    if (!sameWorktreePlan(plan, current)) {
      return report(
        removedArtifacts,
        [
          {
            artifact: plan.requestedPath,
            reason: "worktree changed after cleanup preflight; removal refused",
          },
        ],
        reasons,
      );
    }
    try {
      await git(plan.projectRoot, ["worktree", "remove", "--", plan.canonicalPath]);
      removedArtifacts.push(plan.requestedPath);
    } catch (error) {
      return report(
        removedArtifacts,
        [
          {
            artifact: plan.requestedPath,
            reason: `failed to remove Git worktree: ${errorMessage(error)}`,
          },
        ],
        reasons,
      );
    }
  }

  // External cleanup is complete. The second bridge call is the only mutating
  // store operation in this module.
  const storeResult = await control.cleanupRun({
    databasePath: request.databasePath,
    runId: request.runId,
    keepRecent,
    dryRun: false,
  });
  removedArtifacts.push(...storeResult.removedArtifacts);
  return report(removedArtifacts, storeResult.skippedArtifacts, reasons);
}

async function inspectWorktree(
  control: OrchestrationControl,
  projectRoot: string,
  worktreePath: string,
): Promise<WorktreePlan | { reason: string }> {
  if (!isAbsolute(projectRoot) || !isAbsolute(worktreePath)) {
    return { reason: "project root and worktree path must be absolute" };
  }
  if (!existsSync(projectRoot)) {
    return { reason: "project root does not exist; Git ownership is unknown" };
  }
  if (!existsSync(worktreePath)) {
    return { reason: "worktree path does not exist; Git ownership and cleanliness are unknown" };
  }

  let canonicalRoot: string;
  let canonicalWorktree: string;
  try {
    canonicalRoot = realpathSync.native(projectRoot);
    canonicalWorktree = realpathSync.native(worktreePath);
  } catch (error) {
    return { reason: `cannot resolve canonical worktree path: ${errorMessage(error)}` };
  }

  const relativePath = relative(canonicalRoot, canonicalWorktree);
  if (relativePath === "") {
    return { reason: "worktree path cannot be identical to project root" };
  }
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return { reason: "canonical worktree path is outside the project root" };
  }

  let registered: RegisteredWorktree[];
  try {
    registered = parseWorktreeList(
      (await git(canonicalRoot, ["worktree", "list", "--porcelain"])).stdout,
    );
  } catch (error) {
    return { reason: `cannot inspect Git worktree registration: ${errorMessage(error)}` };
  }
  const main = registered[0];
  if (!main) return { reason: "Git reported no registered main worktree" };

  let canonicalMain: string;
  try {
    canonicalMain = realpathSync.native(main.path);
  } catch (error) {
    return { reason: `cannot resolve registered main worktree: ${errorMessage(error)}` };
  }
  if (canonicalMain !== canonicalRoot) {
    return { reason: "project root is not the registered main Git worktree" };
  }

  const registeredCandidate = registered.find((candidate) => {
    try {
      return realpathSync.native(candidate.path) === canonicalWorktree;
    } catch {
      return false;
    }
  });
  if (!registeredCandidate) {
    return { reason: "path is not a registered Git worktree" };
  }

  let status: string;
  let head: string;
  let mainHead: string;
  try {
    status = (await git(canonicalWorktree, ["status", "--porcelain=v1", "--untracked-files=all"]))
      .stdout;
    head = (await git(canonicalWorktree, ["rev-parse", "HEAD"])).stdout.trim();
    mainHead = (await git(canonicalRoot, ["rev-parse", "HEAD"])).stdout.trim();
  } catch (error) {
    return { reason: `cannot inspect worktree state: ${errorMessage(error)}` };
  }
  if (!registeredCandidate.head || !main.head) {
    return { reason: "Git worktree registration did not report commit identities" };
  }
  if (registeredCandidate.head !== head || main.head !== mainHead) {
    return { reason: "Git worktree commit identities changed during inspection" };
  }
  const isClean = status.length === 0;
  const isMerged = await isAncestor(canonicalRoot, head);
  if (isMerged === undefined) {
    return { reason: "cannot determine whether worktree commits are reachable from main HEAD" };
  }

  const evaluation = await control.evaluateWorktreeRemoval({
    projectRoot: canonicalRoot,
    worktreePath: canonicalWorktree,
    isClean,
    isMerged,
  });
  if (!evaluation.allowed) {
    return { reason: evaluation.reason ?? "worktree removal refused" };
  }
  return {
    requestedPath: worktreePath,
    canonicalPath: canonicalWorktree,
    projectRoot: canonicalRoot,
    candidateHead: head,
    mainHead,
    candidateRegistration: registeredCandidate.fingerprint,
    mainRegistration: main.fingerprint,
  };
}

async function isAncestor(projectRoot: string, commit: string): Promise<boolean | undefined> {
  try {
    await git(projectRoot, ["merge-base", "--is-ancestor", commit, "HEAD"]);
    return true;
  } catch (error) {
    if (exitCode(error) === 1) return false;
    return undefined;
  }
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
}

function parseWorktreeList(output: string): RegisteredWorktree[] {
  const worktrees: RegisteredWorktree[] = [];
  for (const block of output.trimEnd().split("\n\n")) {
    const lines = block.split("\n");
    const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (!path) continue;
    const head = lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length);
    worktrees.push({ path, head, fingerprint: lines.join("\n") });
  }
  return worktrees;
}

function sameWorktreePlan(left: WorktreePlan, right: WorktreePlan): boolean {
  return (
    left.canonicalPath === right.canonicalPath &&
    left.projectRoot === right.projectRoot &&
    left.candidateHead === right.candidateHead &&
    left.mainHead === right.mainHead &&
    left.candidateRegistration === right.candidateRegistration &&
    left.mainRegistration === right.mainRegistration
  );
}

function cleanupSurfaceId(request: CleanupRunRequest): string {
  if (request.caller) return request.caller.paneId;
  if (request.isLeadPane) return "lead-pane";
  return `loop-${request.runId}`;
}

function report(
  removedArtifacts: string[],
  skippedArtifacts: SkippedArtifactOutput[],
  reasons: Record<string, string>,
): CleanupRunReport {
  return { removedArtifacts, skippedArtifacts, reasons };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function exitCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "number" ? error.code : undefined;
}
