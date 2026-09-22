import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  HerdrWorkerRuntime,
  type CloseWorkspaceResult,
  type HerdrRunner,
} from "@loop/herdr";
import * as protocol from "@loop/protocol";

import { cleanupRun } from "../src/cleanup";
import type { OrchestrationControl } from "../src/control";

class FakeHerdr {
  closedRuns: string[] = [];
  beforeClose?: (runId: string) => Promise<void> | void;
  failure?: Error;
  result: CloseWorkspaceResult = { closed: true, reason: "workspace_closed" };

  async closeWorkspace(runId: string): Promise<CloseWorkspaceResult> {
    this.closedRuns.push(runId);
    await this.beforeClose?.(runId);
    if (this.failure) throw this.failure;
    return this.result;
  }
}

const temporaryDirectories: string[] = [];

beforeAll(async () => {
  await protocol.rustra.ready();
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function repository(prefix = "loop-cleanup-repo-"): {
  container: string;
  projectRoot: string;
} {
  const container = temporaryDirectory(prefix);
  const projectRoot = join(container, "project");
  mkdirSync(projectRoot);
  git(projectRoot, "init", "-b", "main");
  git(projectRoot, "config", "user.email", "loop-cleanup@example.invalid");
  git(projectRoot, "config", "user.name", "Loop Cleanup Test");
  writeFileSync(join(projectRoot, "README.md"), "fixture\n");
  git(projectRoot, "add", "README.md");
  git(projectRoot, "commit", "-m", "fixture");
  return { container, projectRoot };
}

function registeredWorktree(projectRoot: string, name = "candidate"): string {
  const worktree = join(projectRoot, ".worktrees", name);
  mkdirSync(join(projectRoot, ".worktrees"), { recursive: true });
  git(projectRoot, "worktree", "add", "-b", `cleanup-${name}`, worktree);
  return worktree;
}

async function createRun(databasePath: string, runId: string, terminal = true): Promise<void> {
  await protocol.createRun({ databasePath, runId });
  if (terminal) await protocol.cancelRun({ databasePath, runId });
}

function requestHerdr(fake: FakeHerdr): HerdrWorkerRuntime {
  return fake as unknown as HerdrWorkerRuntime;
}

describe("cleanupRun", () => {
  test("dry-run plans first and changes no external or persisted state", async () => {
    const { projectRoot } = repository();
    const worktree = registeredWorktree(projectRoot);
    const databasePath = join(projectRoot, "loop.sqlite");
    const runId = "dry-run";
    await createRun(databasePath, runId);
    const herdr = new FakeHerdr();

    const report = await cleanupRun(protocol, {
      databasePath,
      runId,
      projectRoot,
      worktree,
      keepRecent: 0,
      herdr: requestHerdr(herdr),
    });

    expect(report.skippedArtifacts).toBeEmpty();
    expect(report.reasons[runId]).toBe("dry_run");
    expect(report.reasons[`loop-${runId}`]).toBe("dry_run");
    expect(report.reasons[worktree]).toBe("dry_run");
    expect(herdr.closedRuns).toBeEmpty();
    expect(existsSync(worktree)).toBe(true);
    expect((await protocol.getSnapshot({ databasePath, runId })).state).toBe("cancelled");
  });

  test("active run refusal prevents every external cleanup effect", async () => {
    const { projectRoot } = repository();
    const worktree = registeredWorktree(projectRoot);
    const databasePath = join(projectRoot, "loop.sqlite");
    const runId = "active-run";
    await createRun(databasePath, runId, false);
    const herdr = new FakeHerdr();

    const report = await cleanupRun(protocol, {
      databasePath,
      runId,
      projectRoot,
      worktree,
      keepRecent: 0,
      dryRun: false,
      herdr: requestHerdr(herdr),
    });

    expect(report.skippedArtifacts).toContainEqual({
      artifact: runId,
      reason: expect.stringContaining("non-terminal"),
    });
    expect(herdr.closedRuns).toBeEmpty();
    expect(existsSync(worktree)).toBe(true);
    expect((await protocol.getSnapshot({ databasePath, runId })).state).toBe("active");
  });

  test("default retention keeps eight recent runs and prevents external cleanup", async () => {
    const { projectRoot } = repository();
    const databasePath = join(projectRoot, "loop.sqlite");
    const runId = "retained-run";
    await createRun(databasePath, runId);
    const herdr = new FakeHerdr();

    const report = await cleanupRun(protocol, {
      databasePath,
      runId,
      projectRoot,
      dryRun: false,
      herdr: requestHerdr(herdr),
    });

    expect(report.skippedArtifacts).toContainEqual({
      artifact: runId,
      reason: expect.stringContaining("keep_recent = 8"),
    });
    expect(herdr.closedRuns).toBeEmpty();
    expect((await protocol.getSnapshot({ databasePath, runId })).state).toBe("cancelled");
  });

  test("ordinary directories are not accepted as Git-owned worktrees", async () => {
    const { projectRoot } = repository();
    const ordinaryDirectory = join(projectRoot, "ordinary-directory");
    mkdirSync(ordinaryDirectory);
    const databasePath = join(projectRoot, "loop.sqlite");
    const runId = "ordinary-directory";
    await createRun(databasePath, runId);
    const herdr = new FakeHerdr();

    const report = await cleanupRun(protocol, {
      databasePath,
      runId,
      projectRoot,
      worktree: ordinaryDirectory,
      keepRecent: 0,
      dryRun: false,
      herdr: requestHerdr(herdr),
    });

    expect(report.skippedArtifacts).toContainEqual({
      artifact: ordinaryDirectory,
      reason: expect.stringContaining("registered Git worktree"),
    });
    expect(existsSync(ordinaryDirectory)).toBe(true);
    expect(herdr.closedRuns).toBeEmpty();
    expect((await protocol.getSnapshot({ databasePath, runId })).state).toBe("cancelled");
  });

  test("dirty worktrees, including untracked files, are preserved", async () => {
    const { projectRoot } = repository();
    const worktree = registeredWorktree(projectRoot, "dirty");
    writeFileSync(join(worktree, "untracked.txt"), "do not remove\n");
    const databasePath = join(projectRoot, "loop.sqlite");
    const runId = "dirty-worktree";
    await createRun(databasePath, runId);
    const herdr = new FakeHerdr();

    const report = await cleanupRun(protocol, {
      databasePath,
      runId,
      projectRoot,
      worktree,
      keepRecent: 0,
      dryRun: false,
      isClean: true,
      isMerged: true,
      herdr: requestHerdr(herdr),
    });

    expect(report.skippedArtifacts).toContainEqual({
      artifact: worktree,
      reason: expect.stringContaining("uncommitted"),
    });
    expect(existsSync(join(worktree, "untracked.txt"))).toBe(true);
    expect(herdr.closedRuns).toBeEmpty();
    expect((await protocol.getSnapshot({ databasePath, runId })).state).toBe("cancelled");
  });

  test("worktrees with commits not reachable from main HEAD are preserved", async () => {
    const { projectRoot } = repository();
    const worktree = registeredWorktree(projectRoot, "unmerged");
    writeFileSync(join(worktree, "feature.txt"), "unmerged\n");
    git(worktree, "add", "feature.txt");
    git(worktree, "commit", "-m", "unmerged fixture");
    const databasePath = join(projectRoot, "loop.sqlite");
    const runId = "unmerged-worktree";
    await createRun(databasePath, runId);
    const herdr = new FakeHerdr();

    const report = await cleanupRun(protocol, {
      databasePath,
      runId,
      projectRoot,
      worktree,
      keepRecent: 0,
      dryRun: false,
      isClean: true,
      isMerged: true,
      herdr: requestHerdr(herdr),
    });

    expect(report.skippedArtifacts).toContainEqual({
      artifact: worktree,
      reason: expect.stringContaining("unmerged"),
    });
    expect(existsSync(worktree)).toBe(true);
    expect(herdr.closedRuns).toBeEmpty();
    expect((await protocol.getSnapshot({ databasePath, runId })).state).toBe("cancelled");
  });

  test("canonical path checks reject an in-project symlink that escapes the project", async () => {
    const { container, projectRoot } = repository();
    const externalWorktree = join(container, "external-worktree");
    git(projectRoot, "worktree", "add", "-b", "cleanup-external", externalWorktree);
    const symlink = join(projectRoot, "linked-outside");
    symlinkSync(externalWorktree, symlink, "dir");
    const databasePath = join(projectRoot, "loop.sqlite");
    const runId = "symlink-escape";
    await createRun(databasePath, runId);
    const herdr = new FakeHerdr();

    const report = await cleanupRun(protocol, {
      databasePath,
      runId,
      projectRoot,
      worktree: symlink,
      keepRecent: 0,
      dryRun: false,
      herdr: requestHerdr(herdr),
    });

    expect(report.skippedArtifacts).toContainEqual({
      artifact: symlink,
      reason: expect.stringContaining("outside"),
    });
    expect(existsSync(externalWorktree)).toBe(true);
    expect(herdr.closedRuns).toBeEmpty();
    expect((await protocol.getSnapshot({ databasePath, runId })).state).toBe("cancelled");
  });

  test("a registered child whose name starts with two dots remains eligible", async () => {
    const { projectRoot } = repository();
    const worktree = join(projectRoot, "..safe");
    git(projectRoot, "worktree", "add", "-b", "cleanup-dotdot-safe", worktree);
    const databasePath = join(projectRoot, "loop.sqlite");
    const runId = "dotdot-safe";
    await createRun(databasePath, runId);

    const report = await cleanupRun(protocol, {
      databasePath,
      runId,
      projectRoot,
      worktree,
      keepRecent: 0,
    });

    expect(report.skippedArtifacts).toBeEmpty();
    expect(report.reasons[worktree]).toBe("dry_run");
    expect(existsSync(worktree)).toBe(true);
    expect((await protocol.getSnapshot({ databasePath, runId })).state).toBe("cancelled");
  });

  test("caller-owned and lead surfaces are refused without touching other artifacts", async () => {
    for (const ownership of [
      { caller: { workspaceId: "caller-workspace", paneId: "caller-pane" } },
      { isLeadPane: true },
    ]) {
      const { projectRoot } = repository("loop-cleanup-owned-surface-");
      const worktree = registeredWorktree(projectRoot);
      const databasePath = join(projectRoot, "loop.sqlite");
      const runId = ownership.caller ? "caller-owned" : "lead-owned";
      await createRun(databasePath, runId);
      const herdr = new FakeHerdr();

      const report = await cleanupRun(protocol, {
        databasePath,
        runId,
        projectRoot,
        worktree,
        keepRecent: 0,
        dryRun: false,
        herdr: requestHerdr(herdr),
        ...ownership,
      });

      expect(report.skippedArtifacts[0]?.reason).toContain("caller-owned surface");
      expect(herdr.closedRuns).toBeEmpty();
      expect(existsSync(worktree)).toBe(true);
      expect((await protocol.getSnapshot({ databasePath, runId })).state).toBe("cancelled");
    }
  });

  test("failed external teardown preserves the run record", async () => {
    const { projectRoot } = repository();
    const databasePath = join(projectRoot, "loop.sqlite");
    const runId = "teardown-failure";
    await createRun(databasePath, runId);
    const herdr = new FakeHerdr();
    herdr.failure = new Error("simulated teardown failure");

    const report = await cleanupRun(protocol, {
      databasePath,
      runId,
      projectRoot,
      keepRecent: 0,
      dryRun: false,
      herdr: requestHerdr(herdr),
    });

    expect(report.skippedArtifacts).toContainEqual({
      artifact: `loop-${runId}`,
      reason: expect.stringContaining("simulated teardown failure"),
    });
    expect((await protocol.getSnapshot({ databasePath, runId })).state).toBe("cancelled");
  });

  test("a real Herdr lookup failure is unknown and preserves the run record", async () => {
    const { projectRoot } = repository();
    const databasePath = join(projectRoot, "loop.sqlite");
    const runId = "lookup-failure";
    await createRun(databasePath, runId);
    const runner: HerdrRunner = {
      async run(_command, args) {
        expect(args).toEqual(["workspace", "list"]);
        return {
          exitCode: 1,
          stdout: "",
          stderr: JSON.stringify({
            error: { code: "permission_denied", message: "workspace listing denied" },
          }),
        };
      },
    };
    const herdr = new HerdrWorkerRuntime({ runner });

    const report = await cleanupRun(protocol, {
      databasePath,
      runId,
      projectRoot,
      keepRecent: 0,
      dryRun: false,
      herdr,
    });

    expect(report.skippedArtifacts).toContainEqual({
      artifact: `loop-${runId}`,
      reason: expect.stringContaining("permission_denied"),
    });
    expect((await protocol.getSnapshot({ databasePath, runId })).state).toBe("cancelled");
  });

  test("worktree facts are revalidated after surface teardown before removal", async () => {
    const { projectRoot } = repository();
    const worktree = registeredWorktree(projectRoot, "stale");
    const databasePath = join(projectRoot, "loop.sqlite");
    const runId = "stale-worktree";
    await createRun(databasePath, runId);
    const herdr = new FakeHerdr();
    herdr.beforeClose = () => {
      writeFileSync(join(worktree, "late-commit.txt"), "created during teardown\n");
      git(worktree, "add", "late-commit.txt");
      git(worktree, "commit", "-m", "advance after cleanup preflight");
    };

    const report = await cleanupRun(protocol, {
      databasePath,
      runId,
      projectRoot,
      worktree,
      keepRecent: 0,
      dryRun: false,
      herdr: requestHerdr(herdr),
    });

    expect(report.skippedArtifacts).toContainEqual({
      artifact: worktree,
      reason: expect.stringContaining("changed after cleanup preflight"),
    });
    expect(existsSync(worktree)).toBe(true);
    expect((await protocol.getSnapshot({ databasePath, runId })).state).toBe("cancelled");
  });

  test("successful external cleanup precedes the store purge and uses Git worktree removal", async () => {
    const { projectRoot } = repository();
    const worktree = registeredWorktree(projectRoot, "success");
    const databasePath = join(projectRoot, "loop.sqlite");
    const runId = "successful-cleanup";
    await createRun(databasePath, runId);
    const herdr = new FakeHerdr();
    let externalStateAtPurge: { surfaceClosed: boolean; worktreeGone: boolean } | undefined;
    const observedCleanup = Object.assign(
      async (input: Parameters<typeof protocol.cleanupRun>[0]) => {
        if (!input.dryRun) {
          externalStateAtPurge = {
            surfaceClosed: herdr.closedRuns.includes(runId),
            worktreeGone: !existsSync(worktree),
          };
        }
        return await protocol.cleanupRun(input);
      },
      { commandId: protocol.cleanupRun.commandId },
    );
    const control: OrchestrationControl = {
      ...protocol,
      cleanupRun: observedCleanup,
    };

    const report = await cleanupRun(control, {
      databasePath,
      runId,
      projectRoot,
      worktree,
      keepRecent: 0,
      dryRun: false,
      herdr: requestHerdr(herdr),
    });

    expect(report.skippedArtifacts).toBeEmpty();
    expect(externalStateAtPurge).toEqual({ surfaceClosed: true, worktreeGone: true });
    expect(existsSync(worktree)).toBe(false);
    expect(git(projectRoot, "worktree", "list", "--porcelain")).not.toContain(worktree);
    await expect(protocol.getSnapshot({ databasePath, runId })).rejects.toThrow();
  });

  test("an already-gone Loop-owned surface is idempotent and still permits purge", async () => {
    const { projectRoot } = repository();
    const databasePath = join(projectRoot, "loop.sqlite");
    const runId = "already-gone";
    await createRun(databasePath, runId);
    const herdr = new FakeHerdr();
    herdr.result = { closed: true, reason: "already_gone" };

    const report = await cleanupRun(protocol, {
      databasePath,
      runId,
      projectRoot,
      keepRecent: 0,
      dryRun: false,
      herdr: requestHerdr(herdr),
    });

    expect(report.skippedArtifacts).toBeEmpty();
    expect(report.reasons[`loop-${runId}`]).toBe("already_gone");
    await expect(protocol.getSnapshot({ databasePath, runId })).rejects.toThrow();
  });
});
