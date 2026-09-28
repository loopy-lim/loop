import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { codeMap } from "../src/lead/code-map";

test("code map lists only bounded file and exported symbol names", () => {
  const root = mkdtempSync(join(tmpdir(), "loop-code-map-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "worker.ts"), "export function runWorker() {}\nconst secret = 'value';\nexport class Worker {}\n");
  const result = codeMap(root, "src", 5);
  expect(result).toContain("src/worker.ts");
  expect(result).toContain("runWorker");
  expect(result).toContain("Worker");
  expect(result).not.toContain("value");
  expect(result.split("\n").length).toBeLessThanOrEqual(5);
});

test("code map refuses paths outside the project", () => {
  const root = mkdtempSync(join(tmpdir(), "loop-code-map-"));
  expect(() => codeMap(root, "../", 5)).toThrow(/outside project/);
});
