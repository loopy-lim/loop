import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import type { TaskContextOutput, TaskSpecInput } from "@loop/protocol";

import { byteHead } from "./context-lifecycle";

/**
 * G2 — worker 컨텍스트 code map 주입 (docs/research/loop-gap-analysis.md,
 * 부분도입). `loop_code_map`이 Lead 도구로만 존재하는 것과 달리, 이 모듈은
 * 작업의 선언된 scope에서 도출한 요약본을 worker 시작 컨텍스트에 선택적으로
 * 붙인다. 결정적(deterministic)이고 파일시스템 읽기만 수행하며, 실패해도
 * 작업을 실패시키지 않는다(주입물은 언제나 advisory).
 *
 * Boundary: 요약본은 provider 프롬프트의 "Direct dependency results"
 * (supplemental, advisory evidence) 섹션으로 흐르는 합성 항목 하나로
 * 전달된다 — 어댑터 변경 없이 기존 렌더링 경계와 상한(필드당 1200자)을
 * 재사용한다. 항목 id는 결정적이라 프롬프트에서 식별 가능하다.
 */

/** Synthetic advisory entry id. Stable so workers and tests can identify it. */
export const CODE_MAP_ENTRY_ID = "loop_code_map";
/**
 * Matches the provider prompt's per-field bound (packages/providers
 * prompt.ts `safe()`): a longer summary would be truncated again downstream,
 * so the injector caps it at the source.
 */
export const CODE_MAP_CHAR_LIMIT = 1_200;
const DEFAULT_FILE_LIMIT = 60;
const MAX_FILE_BYTES = 256 * 1024;
const declaration = /^\s*(?:export\s+(?:default\s+)?(?:async\s+)?(?:class|function|interface|type|const|enum)|pub(?:\([^)]*\))?\s+(?:async\s+)?(?:fn|struct|enum|trait|mod))\s+([A-Za-z_][A-Za-z0-9_]*)/;

export interface CodeMapRequest {
  task: TaskSpecInput;
  workingDirectory: string;
}

export type CodeMapProvider = (request: CodeMapRequest) => string | undefined;

export interface CodeMapOptions {
  fileLimit?: number;
  charLimit?: number;
}

/**
 * Scope-root directories derived from the declared read/write scopes.
 * A scope glob contributes its leading literal directory segment
 * (`packages/core/src/**` → `packages/core/src`); patterns without a literal
 * prefix (a leading double-star glob) contribute nothing.
 */
export function scopeRoots(scopes: readonly string[]): string[] {
  const roots: string[] = [];
  for (const scope of scopes) {
    const literal = scope.split("*")[0]!.replace(/\/+$/, "");
    if (!literal || literal.endsWith("/") || literal.includes("..")) continue;
    if (!roots.includes(literal)) roots.push(literal);
  }
  return roots;
}

/**
 * Deterministic repo map summary bounded to the declared scopes. Lists each
 * source file with up to three declaration names, mirroring the Lead
 * `loop_code_map` tool's format. Returns undefined (never throws) when no
 * scope root resolves or the file listing is unavailable — the map is
 * advisory and must never fail a dispatch.
 */
export function buildScopeCodeMap(request: CodeMapRequest, options: CodeMapOptions = {}): string | undefined {
  const fileLimit = options.fileLimit ?? DEFAULT_FILE_LIMIT;
  const charLimit = options.charLimit ?? CODE_MAP_CHAR_LIMIT;
  let root: string;
  try { root = realpathSync(request.workingDirectory); } catch { return undefined; }
  const roots = scopeRoots([...request.task.readScope, ...request.task.writeScope]);
  if (roots.length === 0) return undefined;

  const lines: string[] = [];
  const seen = new Set<string>();
  for (const scopeRoot of roots) {
    const candidate = resolve(root, scopeRoot);
    if (!candidate.startsWith(`${root}${sep}`)) continue;
    let target: string;
    try { target = realpathSync(candidate); } catch { continue; }
    if (!target.startsWith(`${root}${sep}`) || !statSync(target).isDirectory()) continue;
    const files = listFiles(target);
    for (const file of files) {
      if (lines.length >= fileLimit || lines.join("\n").length >= charLimit) break;
      if (seen.has(file)) continue;
      seen.add(file);
      let canonical: string;
      try { canonical = realpathSync(file); } catch { continue; }
      if (!canonical.startsWith(`${root}${sep}`) || !statSync(canonical).isFile()) continue;
      if (statSync(canonical).size > MAX_FILE_BYTES) continue;
      const symbols = readFileSync(canonical, "utf8").split(/\r?\n/)
        .map(line => declaration.exec(line)?.[1])
        .filter((name): name is string => Boolean(name))
        .slice(0, 3);
      lines.push(`${relative(root, canonical)}${symbols.length ? ` · ${symbols.join(", ")}` : ""}`);
    }
  }
  if (lines.length === 0) return undefined;
  const map = lines.slice(0, fileLimit).join("\n");
  return map.length > charLimit ? `${byteHead(map, charLimit)}…` : map;
}

function listFiles(directory: string): string[] {
  const result = spawnSync("rg", ["--files", "--hidden", "-g", "!.git", "-g", "!node_modules", "-g", "!target", "-g", "!dist", "."], {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean).map(path => resolve(directory, path));
}

/**
 * Bounds and attaches a code map summary to a start context as one synthetic
 * advisory dependency result. Returns the context unchanged when the map is
 * empty; the input object is never mutated.
 */
export function withCodeMapEntry(context: TaskContextOutput, map: string | undefined): TaskContextOutput {
  const summary = map?.trim();
  if (!summary) return context;
  return {
    ...context,
    dependencyResults: [
      ...context.dependencyResults,
      {
        taskId: CODE_MAP_ENTRY_ID,
        title: "Repository code map (advisory)",
        summary: summary.length > CODE_MAP_CHAR_LIMIT ? byteHead(summary, CODE_MAP_CHAR_LIMIT) : summary,
      },
    ],
  };
}
