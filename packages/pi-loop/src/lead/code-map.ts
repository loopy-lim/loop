import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const declaration = /^\s*(?:export\s+(?:default\s+)?(?:async\s+)?(?:class|function|interface|type|const|enum)|pub(?:\([^)]*\))?\s+(?:async\s+)?(?:fn|struct|enum|trait|mod))\s+([A-Za-z_][A-Za-z0-9_]*)/;

/** File and declaration names only. The Lead opens source text separately on demand. */
export function codeMap(projectRoot: string, requestedPath: string, lineLimit: number): string {
  const root = realpathSync(projectRoot);
  if (!requestedPath.trim() || isAbsolute(requestedPath)) throw new Error("code map path is outside project");
  const candidate = resolve(root, requestedPath);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) throw new Error("code map path is outside project");
  const target = realpathSync(candidate);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("code map path is outside project");
  const paths = statSync(target).isFile() ? [target] : (() => {
    const result = spawnSync("rg", ["--files", "--hidden", "-g", "!.git", "-g", "!node_modules", "-g", "!target", "-g", "!dist"], {
      cwd: target, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1) throw new Error("code map file listing failed");
    return result.stdout.split(/\r?\n/).filter(Boolean).map(path => resolve(target, path));
  })();
  const lines: string[] = [];
  for (const path of paths.sort()) {
    if (lines.length >= lineLimit) break;
    let canonical: string;
    try { canonical = realpathSync(path); } catch { continue; }
    if (!canonical.startsWith(`${root}${sep}`) || !statSync(canonical).isFile()) continue;
    if (statSync(canonical).size > 256 * 1024) continue;
    const symbols = readFileSync(canonical, "utf8").split(/\r?\n/)
      .map(line => declaration.exec(line)?.[1])
      .filter((name): name is string => Boolean(name))
      .slice(0, 3);
    lines.push(`${relative(root, canonical)}${symbols.length ? ` · ${symbols.join(", ")}` : ""}`);
  }
  return lines.length ? lines.join("\n") : `No source files under ${requestedPath}`;
}
