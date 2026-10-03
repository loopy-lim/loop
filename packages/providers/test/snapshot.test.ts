import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  DEFAULT_SNAPSHOT_KEEP,
  SNAPSHOT_REF_PREFIX,
  SnapshotRefusalError,
  WorkspaceSnapshotStore,
  type WorkspaceSnapshotRecord,
} from "../src/snapshot";

/** noUncheckedIndexedAccess 아래에서 테스트 배열의 첫/n번째 요소를 좁힌다. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected item ${index} to be defined`);
  return item;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "loop-test",
  GIT_AUTHOR_EMAIL: "loop@example.com",
  GIT_COMMITTER_NAME: "loop-test",
  GIT_COMMITTER_EMAIL: "loop@example.com",
};

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "loop-snapshot-test-"));
  roots.push(root);
  return root;
}

function makeRepo(root: string): string {
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  const git = (args: string[]) =>
    spawnSync("git", args, { cwd: workspace, env: { ...process.env, ...GIT_IDENTITY } });
  git(["init", "-q", "--initial-branch=main"]);
  writeFileSync(join(workspace, "README.md"), "# repo\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  return workspace;
}

function gitOutput(workspace: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: workspace,
    env: { ...process.env, ...GIT_IDENTITY },
  });
  expect(result.status).toBe(0);
  return result.stdout.toString().trim();
}

test("workspace git snapshot creates a loop-owned commit without touching the working tree (G6)", async () => {
  const workspace = makeRepo(makeProject());
  const store = new WorkspaceSnapshotStore({
    projectRoot: join(workspace, ".."),
    env: GIT_IDENTITY,
  });

  writeFileSync(join(workspace, "README.md"), "# changed\n");
  writeFileSync(join(workspace, "untracked.txt"), "new file\n");

  const beforeStatus = gitOutput(workspace, ["status", "--porcelain"]);
  const record = await store.create(workspace, { runId: "run-1", label: "before-cleanup" });
  expect(record.ref).toBe(`${SNAPSHOT_REF_PREFIX}run-1/0001`);
  expect(record.runId).toBe("run-1");
  expect(record.label).toBe("before-cleanup");
  expect(gitOutput(workspace, ["status", "--porcelain"])).toBe(beforeStatus);

  // Snapshot commit carries the worktree content (tracked + untracked), not HEAD's.
  const snapshotReadme = gitOutput(workspace, ["show", `${record.ref}:README.md`]);
  expect(snapshotReadme).toBe("# changed\n".trim());
  expect(gitOutput(workspace, ["show", `${record.ref}:untracked.txt`])).toBe("new file");
  // HEAD itself did not move.
  expect(gitOutput(workspace, ["log", "-1", "--format=%s"])).toBe("init");
});

test("snapshots are listed newest-last and pruned to the retention bound", async () => {
  const workspace = makeRepo(makeProject());
  const store = new WorkspaceSnapshotStore({
    projectRoot: join(workspace, ".."),
    keep: 2,
    env: GIT_IDENTITY,
  });
  expect(DEFAULT_SNAPSHOT_KEEP).toBe(3);

  const records: WorkspaceSnapshotRecord[] = [];
  for (let index = 0; index < 4; index += 1) {
    writeFileSync(join(workspace, `file-${index}.txt`), String(index));
    records.push(await store.create(workspace, { runId: "run-1" }));
  }
  const listed = await store.list(workspace, "run-1");
  expect(listed.map((record) => record.ref)).toEqual([
    `${SNAPSHOT_REF_PREFIX}run-1/0003`,
    `${SNAPSHOT_REF_PREFIX}run-1/0004`,
  ]);
  expect(at(records, 0).ref).toBe(`${SNAPSHOT_REF_PREFIX}run-1/0001`);
  // Pruning only ever removes loop refs; refs/heads stays intact.
  expect(gitOutput(workspace, ["for-each-ref", "--format=%(refname)", "refs/heads"])).toContain(
    "refs/heads/main",
  );
});

test("restore refuses a dirty worktree and otherwise restores tracked content", async () => {
  const workspace = makeRepo(makeProject());
  const store = new WorkspaceSnapshotStore({
    projectRoot: join(workspace, ".."),
    env: GIT_IDENTITY,
  });
  writeFileSync(join(workspace, "README.md"), "# snapshot state\n");
  const record = await store.create(workspace, { runId: "run-1" });

  // Dirty: the ADR's data-loss path is refused.
  writeFileSync(join(workspace, "README.md"), "# uncommitted work\n");
  await expect(store.restore(workspace, record.ref)).rejects.toMatchObject({
    refusal: "worktree_dirty",
  });

  // Clean: restore brings snapshot content back; HEAD does not move.
  gitOutput(workspace, ["checkout", "--", "."]);
  const restored = await store.restore(workspace, record.ref);
  expect(restored.commit).toBe(record.commit);
  expect(gitOutput(workspace, ["log", "-1", "--format=%s"])).toBe("init");
  expect(gitOutput(workspace, ["rev-parse", "HEAD"])).not.toBe(record.commit);
});

test("path and repo guards refuse unsafe targets with typed refusals", async () => {
  const root = makeProject();
  const workspace = makeRepo(root);
  const store = new WorkspaceSnapshotStore({ projectRoot: root, env: GIT_IDENTITY });

  // Outside the project root.
  const outside = makeProject();
  await expect(store.create(join(outside, "workspace"), { runId: "run-1" })).rejects.toMatchObject({
    refusal: "path_outside_project",
  });

  // Not a git worktree.
  const plain = join(root, "plain");
  mkdirSync(plain);
  await expect(store.create(plain, { runId: "run-1" })).rejects.toMatchObject({
    refusal: "not_a_git_worktree",
  });

  await expect(store.list(plain, "run-1")).rejects.toMatchObject({ refusal: "not_a_git_worktree" });

  // Relative paths are refused outright.
  await expect(store.create("workspace", { runId: "run-1" })).rejects.toMatchObject({
    refusal: "path_outside_project",
  });

  // Restore only accepts loop-owned refs.
  await expect(store.restore(workspace, "refs/heads/main")).rejects.toMatchObject({
    refusal: "ref_outside_snapshot_namespace",
  });
  await expect(store.restore(workspace, `${SNAPSHOT_REF_PREFIX}run-1/9999`)).rejects.toMatchObject({
    refusal: "snapshot_ref_missing",
  });

  void workspace;
  void store;
});

test("snapshotting an unborn-HEAD repo still records the worktree", async () => {
  const root = makeProject();
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const git = (args: string[]) =>
    spawnSync("git", args, { cwd: workspace, env: { ...process.env, ...GIT_IDENTITY } });
  git(["init", "-q"]);
  writeFileSync(join(workspace, "only.txt"), "uncommitted\n");

  const store = new WorkspaceSnapshotStore({ projectRoot: root, env: GIT_IDENTITY });
  const record = await store.create(workspace, { runId: "run-unborn" });
  expect(gitOutput(workspace, ["show", `${record.ref}:only.txt`])).toBe("uncommitted");
  expect(SnapshotRefusalError.name).toBe("SnapshotRefusalError");
});
