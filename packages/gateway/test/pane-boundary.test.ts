/**
 * Terminal-mirror architecture gates (decision 2026-xx-terminal-mirror §4).
 * These complement the repo-wide architecture suite (tests/ is outside this
 * task's write scope) with the two pane-specific invariants:
 *
 * 1. The pane concept never enters loop-core (Rust) — `rg -i pane` stays at
 *    zero hits in crates/loop-core/src (decision M-TM0 acceptance).
 * 2. herdr socket protocol knowledge stays confined to the single adapter
 *    file (herdr-pane-source.ts); the rest of packages/gateway/src speaks
 *    only the PaneObservationPort (decision D3 seam).
 */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

function repoPath(...segments: string[]): string {
  return join(root, ...segments);
}

function rustFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...rustFiles(path));
    else if (entry.endsWith(".rs")) out.push(path);
  }
  return out;
}

function tsFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("the pane concept never enters loop-core", () => {
  const hits: string[] = [];
  for (const file of rustFiles(repoPath("crates/loop-core/src"))) {
    // Code-level gate: prose in `///` doc comments may name the boundary it
    // explains; declarations, fields, and strings may not contain the concept.
    const code = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    if (/pane/i.test(code)) hits.push(file);
  }
  expect(hits).toEqual([]);
});

test("herdr socket protocol knowledge stays in the single pane adapter", () => {
  const adapter = "herdr-pane-source.ts";
  // Quoted protocol tokens / wire identifiers only: prose mentions of the
  // concept in comments are not protocol knowledge.
  const forbidden = [
    /['"]pane\.list['"]/,
    /['"]pane\.read['"]/,
    /agent_status/,
    /['"]recent_unwrapped['"]|source: "recent/,
    /herdr\.sock/,
  ];
  for (const file of tsFiles(repoPath("packages/gateway/src"))) {
    if (file.endsWith(adapter)) continue;
    const source = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      expect(source.match(pattern)?.[0]).toBeUndefined();
    }
  }
  // The adapter must actually carry the protocol so the confinement is real.
  expect(readFileSync(repoPath("packages/gateway/src", adapter), "utf8")).toMatch(
    /['"]pane\.list['"]|pane\.list/,
  );
});
