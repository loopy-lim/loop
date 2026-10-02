import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { NodeProcessRunner, type ProcessResult, type ProcessRunner } from "./process";
import { redactProviderText } from "./redact";

/**
 * Workspace git snapshot safety net (gap analysis G6 — 파일 checkpoint,
 * 부분도입) under the cleanup-and-retention ADR.
 *
 * Safety contract (ADR cleanup-and-retention 준수):
 * - Manual and explicit triggers ONLY. Nothing in this module runs on a
 *   timer or on run-state transitions; creation happens when a caller
 *   (operator surface, orchestrator command) explicitly asks for it.
 * - Snapshots are LOOP-OWNED git refs under `refs/loop/snapshots/**`.
 *   Creation and pruning never touch `refs/heads`, tags, remotes, the
 *   working tree, or the real index; external session stores are out of
 *   scope entirely (ADR: external_session is never deleted).
 * - Snapshot COMMITS are created with git plumbing (temp index +
 *   write-tree/commit-tree), so the working tree and the real index are
 *   untouched by snapshotting.
 * - Restore refuses a dirty worktree (`worktree_dirty`): reverting over
 *   uncommitted work is the data-loss path the ADR protects. Restore is a
 *   content restore (`git checkout <commit> -- .`): files created after the
 *   snapshot are kept, so it is a safety net, not an automatic rewind.
 * - Path guards: the workspace must resolve inside the configured
 *   projectRoot; non-git directories are refused (`not_a_git_worktree`).
 * - Automatic tool-level rewind stays deferred (gap analysis §2, G6 변형):
 *   the ADR keeps deletion/recovery responsibility explicit and manual.
 */

export const SNAPSHOT_REF_PREFIX = "refs/loop/snapshots/";
/** Default retention for snapshot refs per run (ADR-style bounded keep). */
export const DEFAULT_SNAPSHOT_KEEP = 3;

export type SnapshotRefusal =
  | "not_a_git_worktree"
  | "path_outside_project"
  | "worktree_dirty"
  | "ref_outside_snapshot_namespace"
  | "snapshot_ref_missing";

export class SnapshotRefusalError extends Error {
  constructor(readonly refusal: SnapshotRefusal, message: string) {
    super(message);
    this.name = "SnapshotRefusalError";
  }
}

export interface WorkspaceSnapshotRecord {
  /** Full loop-owned ref name, e.g. `refs/loop/snapshots/run-1/0001`. */
  ref: string;
  commit: string;
  createdAt: string;
  runId: string;
  label?: string;
}

export interface WorkspaceSnapshotStoreOptions {
  /** Absolute project root; every workspace must resolve inside it. */
  projectRoot: string;
  runner?: ProcessRunner;
  /**
   * Extra env for every git invocation (identity override for tests). Each
   * entry is merged over `process.env` by the runner; credentials must not
   * be passed here (ADR D3.6: 정리 경로는 비밀값을 읽거나 로그에 싣지 않는다).
   */
  env?: Record<string, string | undefined>;
  keep?: number;
}

export interface SnapshotRequest {
  runId: string;
  label?: string;
}

export class WorkspaceSnapshotStore {
  readonly #projectRoot: string;
  readonly #runner: ProcessRunner;
  readonly #env: Record<string, string | undefined>;
  readonly #keep: number;

  constructor(options: WorkspaceSnapshotStoreOptions) {
    this.#projectRoot = resolve(options.projectRoot);
    this.#runner = options.runner ?? new NodeGitRunner();
    this.#env = options.env ?? {};
    this.#keep = options.keep ?? DEFAULT_SNAPSHOT_KEEP;
  }

  /** Creates one snapshot commit + loop ref for the workspace. Explicit trigger only. */
  async create(workspaceDir: string, request: SnapshotRequest): Promise<WorkspaceSnapshotRecord> {
    const cwd = this.#guardedWorkspace(workspaceDir);
    const toplevel = await this.#toplevel(cwd);
    const head = await this.#headCommit(cwd);
    const indexDir = mkdtempSync(join(tmpdir(), "loop-snapshot-"));
    const indexFile = join(indexDir, "index");
    try {
      await this.#git(cwd, ["read-tree", ...(head ? [head] : ["--empty"])], { indexFile });
      await this.#git(cwd, ["add", "-A"], { indexFile });
      const tree = (await this.#git(cwd, ["write-tree"], { indexFile })).stdout.trim();
      const message = snapshotMessage(request);
      const commit = (
        await this.#git(cwd, ["commit-tree", tree, ...(head ? ["-p", head] : []), "-m", message], { indexFile })
      ).stdout.trim();
      const existing = await this.#listRefs(cwd, `${SNAPSHOT_REF_PREFIX}${request.runId}/`);
      // Number by the highest existing sequence, not the count: pruning keeps
      // older names alive, and count-based numbering would reuse (overwrite) them.
      const nextSequence = existing.reduce((max, entry) => {
        const sequence = Number.parseInt(entry.ref.split("/").pop() ?? "0", 10);
        return Number.isInteger(sequence) && sequence > max ? sequence : max;
      }, 0) + 1;
      const ref = `${SNAPSHOT_REF_PREFIX}${sanitizeRefComponent(request.runId)}/${String(nextSequence).padStart(4, "0")}`;
      await this.#git(cwd, ["update-ref", ref, commit]);
      const record: WorkspaceSnapshotRecord = {
        ref,
        commit,
        createdAt: new Date().toISOString(),
        runId: request.runId,
        ...(request.label ? { label: request.label } : {}),
      };
      await this.prune(workspaceDir, request.runId);
      return record;
    } finally {
      rmSync(indexDir, { recursive: true, force: true });
    }
  }

  /** Lists loop snapshot refs for one run, or every run when `runId` is omitted. */
  async list(workspaceDir: string, runId?: string): Promise<WorkspaceSnapshotRecord[]> {
    const cwd = this.#guardedWorkspace(workspaceDir);
    await this.#toplevel(cwd);
    const pattern = runId ? `${SNAPSHOT_REF_PREFIX}${sanitizeRefComponent(runId)}/` : SNAPSHOT_REF_PREFIX;
    const refs = await this.#listRefs(cwd, pattern);
    return refs.map(({ ref, commit, createdAt }) => {
      const runIdPart = ref.slice(SNAPSHOT_REF_PREFIX.length).split("/")[0] ?? "";
      return { ref, commit, createdAt, runId: runIdPart };
    });
  }

  /** Restores tracked files from one loop snapshot. Refuses dirty worktrees (ADR safety contract). */
  async restore(workspaceDir: string, ref: string): Promise<{ ref: string; commit: string }> {
    const cwd = this.#guardedWorkspace(workspaceDir);
    await this.#toplevel(cwd);
    if (!ref.startsWith(SNAPSHOT_REF_PREFIX) || ref.includes("..")) {
      throw new SnapshotRefusalError("ref_outside_snapshot_namespace", `ref ${ref} is outside ${SNAPSHOT_REF_PREFIX}`);
    }
    const commit = (await this.#git(cwd, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]).catch(() => null))?.stdout.trim();
    if (!commit) throw new SnapshotRefusalError("snapshot_ref_missing", `snapshot ref ${ref} does not resolve`);
    const status = await this.#git(cwd, ["status", "--porcelain"]);
    if (status.stdout.trim().length > 0) {
      throw new SnapshotRefusalError("worktree_dirty", "refusing restore over uncommitted changes; commit, stash, or clean first");
    }
    await this.#git(cwd, ["checkout", commit, "--", "."]);
    return { ref, commit };
  }

  /** Keeps only the newest `keep` snapshot refs of the run (oldest loop refs pruned first). */
  async prune(workspaceDir: string, runId: string, keep?: number): Promise<string[]> {
    const cwd = this.#guardedWorkspace(workspaceDir);
    await this.#toplevel(cwd);
    const bound = keep ?? this.#keep;
    const refs = await this.#listRefs(cwd, `${SNAPSHOT_REF_PREFIX}${sanitizeRefComponent(runId)}/`);
    if (refs.length <= bound) return [];
    const removed: string[] = [];
    for (const { ref } of refs.slice(0, refs.length - bound)) {
      if (!ref.startsWith(SNAPSHOT_REF_PREFIX)) {
        throw new SnapshotRefusalError("ref_outside_snapshot_namespace", `ref ${ref} is outside ${SNAPSHOT_REF_PREFIX}`);
      }
      await this.#git(cwd, ["update-ref", "-d", ref]);
      removed.push(ref);
    }
    return removed;
  }

  #guardedWorkspace(workspaceDir: string): string {
    if (!isAbsolute(workspaceDir)) {
      throw new SnapshotRefusalError("path_outside_project", "workspace must be an absolute path");
    }
    let resolved: string;
    try {
      resolved = realpathSync(resolve(workspaceDir));
    } catch {
      throw new SnapshotRefusalError("path_outside_project", `workspace ${workspaceDir} does not exist inside the project`);
    }
    if (!insideRoot(realpathSync(this.#projectRoot), resolved)) {
      throw new SnapshotRefusalError("path_outside_project", `workspace ${resolved} is outside project root ${this.#projectRoot}`);
    }
    return resolved;
  }

  async #toplevel(cwd: string): Promise<string> {
    const result = await this.#git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => null);
    if (!result || result.exitCode !== 0) {
      throw new SnapshotRefusalError("not_a_git_worktree", redactProviderText(result?.stderr || "git rev-parse failed", 400));
    }
    const toplevel = realpathSync(result.stdout.trim());
    if (!insideRoot(realpathSync(this.#projectRoot), toplevel)) {
      throw new SnapshotRefusalError("path_outside_project", `worktree root ${toplevel} is outside project root`);
    }
    return toplevel;
  }

  async #headCommit(cwd: string): Promise<string | undefined> {
    const result = await this.#git(cwd, ["rev-parse", "--verify", "-q", "HEAD"]).catch(() => null);
    const sha = result?.stdout.trim();
    return sha && sha.length === 40 ? sha : undefined;
  }

  async #listRefs(cwd: string, pattern: string): Promise<SnapshotRefEntry[]> {
    const result = await this.#git(cwd, ["for-each-ref", "--format=%(refname)%09%(objectname)%09%(creatordate:iso8601-strict)", pattern]);
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [ref, commit, createdAt] = line.split("\t");
        return { ref: ref ?? "", commit: commit ?? "", createdAt: createdAt ?? "" };
      })
      .sort((a, b) => a.ref.localeCompare(b.ref));
  }

  async #git(cwd: string, args: string[], options: { indexFile?: string } = {}) {
    const env = { ...this.#env };
    if (options.indexFile) env.GIT_INDEX_FILE = options.indexFile;
    const running = this.#runner.start("git", args, { cwd, env });
    const result = await running.result;
    if (result.exitCode !== 0) {
      throw new Error(`git ${args[0]} failed (${result.exitCode}): ${redactProviderText(result.stderr, 400)}`);
    }
    return result;
  }
}

class NodeGitRunner implements ProcessRunner {
  readonly #runner = new NodeProcessRunner({ cancelGraceMs: 1_000 });

  probe(command: string, args: string[]): Promise<ProcessResult> {
    return this.#runner.probe(command, args);
  }

  start(...args: Parameters<ProcessRunner["start"]>): ReturnType<ProcessRunner["start"]> {
    return this.#runner.start(...args);
  }
}

function insideRoot(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rel = relative(root, candidate);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

interface SnapshotRefEntry {
  ref: string;
  commit: string;
  createdAt: string;
}

function sanitizeRefComponent(component: string): string {
  const sanitized = component
    .replace(/[\s~^:?*[\\\x00-\x1f\x7f]/g, "-")
    .replace(/\.\.+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.lock$/i, "-lock")
    .replace(/-+/g, "-");
  if (!sanitized || sanitized === "-") throw new SnapshotRefusalError("path_outside_project", `run id ${component} cannot form a safe ref component`);
  return sanitized.slice(0, 96);
}

function snapshotMessage(request: SnapshotRequest): string {
  return `loop snapshot: run=${request.runId}${request.label ? ` label=${request.label}` : ""}`;
}
