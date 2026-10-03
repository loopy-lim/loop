import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureSourceState,
  changedSourcePaths,
  scopeContainsPath,
  scopedFingerprint,
} from "../src/source-state";

function repository() {
  const root = mkdtempSync(join(tmpdir(), "loop-source-state-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  };
  git("init", "-q");
  writeFileSync(join(root, "owned.ts"), "export const owned = 1;\n");
  writeFileSync(join(root, "other.ts"), "export const other = 1;\n");
  git("add", ".");
  return root;
}

test("source snapshots distinguish unchanged pre-existing dirty files from new edits", async () => {
  const root = repository();
  writeFileSync(join(root, "other.ts"), "export const other = 2;\n");
  const before = await captureSourceState(root);
  writeFileSync(join(root, "owned.ts"), "export const owned = 2;\n");
  const after = await captureSourceState(root);
  expect(before).toBeDefined();
  expect(after).toBeDefined();
  expect(changedSourcePaths(before!, after!)).toEqual(["owned.ts"]);
  expect(before?.fingerprint).not.toBe(after?.fingerprint);
});

test("source snapshots include untracked files and detect mutation during a check", async () => {
  const root = repository();
  const before = await captureSourceState(root);
  writeFileSync(join(root, "new.ts"), "export const fresh = true;\n");
  const after = await captureSourceState(root);
  expect(changedSourcePaths(before!, after!)).toEqual(["new.ts"]);
});

test("source snapshots exclude the run database and its journals", async () => {
  const root = repository();
  const database = join(root, "run.db");
  writeFileSync(database, "first");
  const before = await captureSourceState(root, [database]);
  writeFileSync(database, "second");
  writeFileSync(`${database}-wal`, "journal");
  const after = await captureSourceState(root, [database]);
  expect(changedSourcePaths(before!, after!)).toEqual([]);
});

test("write scope uses path boundaries and does not claim an unrelated file", () => {
  expect(scopeContainsPath(["src/**"], "src/nested/file.ts")).toBe(true);
  expect(scopeContainsPath(["src/**"], "src2/file.ts")).toBe(false);
  expect(scopeContainsPath(["src/*/file.ts"], "src/a/file.ts")).toBe(true);
  expect(scopeContainsPath(["src/*/file.ts"], "src/a/b/file.ts")).toBe(false);
  expect(scopeContainsPath([], "src/a.ts")).toBe(false);
});

test("scoped check snapshots avoid hashing unrelated files", async () => {
  const root = repository();
  const full = await captureSourceState(root);
  const scoped = await captureSourceState(root, [], ["owned.ts"]);
  expect([...scoped!.files.keys()]).toEqual(["owned.ts"]);
  expect(scopedFingerprint(full!, ["owned.ts"])).toBe(scopedFingerprint(scoped!, ["owned.ts"]));
});
