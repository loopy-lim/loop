import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { WORKFLOW_PROFILE_NAMES, type WorkflowProfileName } from "../src/benchmark";
import { ACTIVITY_HISTORY_LIMIT } from "../src/config";

// Lockstep mirrors (AGENTS.md: never hand-write a TS copy of a Rust domain
// value without pinning it). Each test reads the Rust source as text and
// fails when the TS mirror drifts from the Rust domain source. If the Rust
// file moves, these tests fail loudly by design — a lockstep test that
// silently passes on a missing source is not a lockstep test.

const repoRoot = join(import.meta.dir, "../../..");

/** Rust PascalCase variant → serde `rename_all = "kebab-case"` wire form. */
function toKebabCase(variant: string): string {
  return variant.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** First capture group of every match; empty array when nothing matches. */
function captureAll(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}

test("activity history cap mirrors loop-core ACTIVITY_HISTORY_LIMIT", () => {
  const reducer = readFileSync(join(repoRoot, "crates/loop-core/src/event/reducer.rs"), "utf8");
  const match = reducer.match(/pub const ACTIVITY_HISTORY_LIMIT:\s*usize\s*=\s*(\d+)\s*;/);
  expect(match).not.toBeNull();
  expect(ACTIVITY_HISTORY_LIMIT).toBe(Number(match?.[1]));
});

test("workflow profile names mirror loop-core WorkflowProfile (serde kebab-case)", () => {
  const source = readFileSync(join(repoRoot, "crates/loop-core/src/benchmark/profile.rs"), "utf8");

  const enumBody = source.match(/pub enum WorkflowProfile \{([\s\S]*?)\n\}/);
  expect(enumBody).not.toBeNull();
  const enumSource = enumBody?.[1] ?? "";
  const variants = captureAll(enumSource, /^ {4}([A-Z][A-Za-z0-9]*),$/gm);
  expect(variants.length).toBeGreaterThan(0);

  const kebab: string[] = variants.map(toKebabCase);
  expect([...WORKFLOW_PROFILE_NAMES]).toEqual(kebab as WorkflowProfileName[]);

  // The explicit `as_str` mapping is the second spelling of the same wire
  // form; if serde kebab-case and `as_str` ever disagree, this pins it.
  const asStrLiterals = captureAll(source, /Self::[A-Za-z0-9]+ => "([a-z0-9-]+)"/g);
  expect(asStrLiterals).toEqual(kebab);
});
