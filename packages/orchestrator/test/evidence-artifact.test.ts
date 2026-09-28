import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { storeCheckOutput } from "../src/evidence-artifact";

test("large check output is saved privately after redaction and only then gets a path", async () => {
  const root = mkdtempSync(join(tmpdir(), "loop-check-artifact-"));
  const database = join(root, "run.db");
  const output = `${"normal output\n".repeat(50)}api_key=private-value`;
  const stored = await storeCheckOutput(database, "run", "task", "check", output, "");
  expect(stored?.path).toContain("run.db.artifacts");
  expect(stored?.preview).toContain("artifact saved");
  const body = readFileSync(stored!.path, "utf8");
  expect(body).toContain("normal output");
  expect(body).not.toContain("private-value");
  expect(statSync(stored!.path).mode & 0o077).toBe(0);
});

test("small output stays inline without creating an artifact", async () => {
  const root = mkdtempSync(join(tmpdir(), "loop-check-artifact-"));
  expect(await storeCheckOutput(join(root, "run.db"), "run", "task", "check", "ok", "")).toBeUndefined();
});
