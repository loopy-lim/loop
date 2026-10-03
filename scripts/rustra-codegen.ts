import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

interface CollectionContext {
  arrayVariable: string;
  blockIndent: number;
  loopVariable: string;
  rawExpression: string;
}

function applyIndexedAccessGuards(source: string): string {
  return source
    // encodeInto varint writer: do/while 이 최소 1바이트 기록을 보장하므로
    // w - 1 재독입은 항상 범위 안이다. 복합 할당은 인덱스 시그니처 쓰기로
    // 표현되지 않아 읽기/쓰기로 분해한다.
    .replaceAll(
      "out[w - 1] &= 0x7f;",
      "out[w - 1] = out[w - 1]! & 0x7f;",
    )
    // _utf8Decode: 진입 시 end > bytes.length 를 검사하고 루프가 i < end 를
    // 유지하므로 bytes[i + k] 는 항상 범위 안이다.
    .replaceAll("const b = bytes[i];", "const b = bytes[i]!;")
    .replace(/bytes\[i \+ ([1-9])\](?!!)/g, "bytes[i + $1]!")
    // encode 컬렉션 루프: _i/_ii/_iii 인덱스는 for 조건이 배열 길이로 한정한다.
    // 쓰기(디코드 채움 루프)는 noUncheckedIndexedAccess 의 대상이 아니므로 제외.
    .replace(/([A-Za-z_$][\w$]*)\[(_i{1,3})\](?!!)(?!\s*=)/g, "$1[$2]!")
    // decode enum: 태그가 범위를 벗어나면 undefined 가 할당되는 기존 런타임
    // 동작을 보존한다. 여기서 가드를 덧대면 프로토콜 동작이 바뀐다.
    .replace(/_variants\[_v\.value\](?!!)/g, "_variants[_v.value]!");
}

/**
 * @rustra/cli 0.11.3 predates two upstream generator fixes. Keep the published
 * package pinned, then apply the same deterministic semantics until a release
 * containing b4c16550 and c717117f is available.
 */
export function normalizeRustraFrameCodecs(source: string): string {
  const narrowed = source.replace(
    /const _variants = (\[[^\n;]*\])(?! as const);/g,
    "const _variants = $1 as const;",
  );
  const lines = narrowed.split("\n");
  const contexts: CollectionContext[] = [];
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index]!;
    const declaration = /^(\s*)const _arr = (.+);$/.exec(original);
    const hasGeneratedLoop = declaration
      && /^\s*parts\.push\(_pcEncodeVarint\(_arr\.length\)\);$/.test(lines[index + 1] ?? "")
      && /^\s*for \(let _i = 0; _i < _arr\.length; _i\+\+\) \{$/.test(lines[index + 2] ?? "");

    let line: string;
    if (declaration && hasGeneratedLoop) {
      const depth = contexts.length;
      const suffix = "i".repeat(depth);
      const rawExpression = declaration[2]!;
      const normalizedExpression = replaceCollectionElements(rawExpression, contexts);
      const context: CollectionContext = {
        arrayVariable: `_arr${suffix}`,
        blockIndent: declaration[1]!.length - 2,
        loopVariable: `_i${suffix}`,
        rawExpression,
      };
      contexts.push(context);
      line = `${declaration[1]}const ${context.arrayVariable} = ${normalizedExpression};`;
    } else {
      line = replaceCollectionElements(original, contexts);
      const current = contexts.at(-1);
      if (current) {
        line = line
          .replace(
            /for \(let _i = 0; _i < _arr\.length; _i\+\+\)/,
            `for (let ${current.loopVariable} = 0; ${current.loopVariable} < ${current.arrayVariable}.length; ${current.loopVariable}++)`,
          )
          .replaceAll("_arr.length", `${current.arrayVariable}.length`)
          .replaceAll("_arr[_i]", `${current.arrayVariable}[${current.loopVariable}]`);
      }
    }
    output.push(line);

    const current = contexts.at(-1);
    if (current && /^\s*}$/.test(original) && indentation(original) === current.blockIndent) {
      contexts.pop();
    }
  }

  if (contexts.length > 0) {
    throw new Error("generated collection normalization found an unterminated block");
  }
  return applyIndexedAccessGuards(output.join("\n"));
}

function replaceCollectionElements(line: string, contexts: CollectionContext[]): string {
  let result = line;
  for (let index = contexts.length - 1; index >= 0; index -= 1) {
    const context = contexts[index]!;
    result = result.replaceAll(
      `${context.rawExpression}[_i]`,
      `${context.arrayVariable}[${context.loopVariable}]`,
    );
  }
  return result;
}

function indentation(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

interface GeneratedManifest {
  files: Array<{ path: string; sha256: string }>;
}

function normalizeGeneratedDirectory(directory: string, bunTargetDirectory?: string): void {
  const codecsPath = join(directory, "frame-codecs.ts");
  const source = readFileSync(codecsPath, "utf8");
  const normalized = normalizeRustraFrameCodecs(source);
  if (normalized !== source) writeFileSync(codecsPath, normalized);

  if (bunTargetDirectory) {
    const bunPath = join(directory, "bun.ts");
    const bunSource = readFileSync(bunPath, "utf8");
    const bunNormalized = bunSource.replace(
      /const targetDirectory = new URL\("[^"]+", import\.meta\.url\);/,
      `const targetDirectory = new URL("${bunTargetDirectory}", import.meta.url);`,
    );
    if (bunNormalized === bunSource) {
      throw new Error("generated Bun host is missing its target directory declaration");
    }
    writeFileSync(bunPath, bunNormalized);
  }

  const manifestPath = join(directory, ".rustra-generated.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as GeneratedManifest;
  for (const path of ["frame-codecs.ts", ...(bunTargetDirectory ? ["bun.ts"] : [])]) {
    const entry = manifest.files.find((file) => file.path === path);
    if (!entry) throw new Error(`generated manifest does not include ${path}`);
    entry.sha256 = createHash("sha256").update(readFileSync(join(directory, path))).digest("hex");
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function runPublishedCodegen(root: string, configPath: string): void {
  const executable = resolve(root, "node_modules/.bin/rustra");
  if (!existsSync(executable)) {
    throw new Error("missing lock-installed @rustra/cli; run bun install --frozen-lockfile");
  }
  const result = Bun.spawnSync([executable, "codegen", "--config", configPath], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`published Rustra codegen failed with exit code ${result.exitCode}`);
  }
}

function generatedPaths(directory: string): string[] {
  const manifest = JSON.parse(
    readFileSync(join(directory, ".rustra-generated.json"), "utf8"),
  ) as GeneratedManifest;
  return [
    ".rustra-generated.json",
    "schema.json",
    ...manifest.files.map((file) => file.path),
  ];
}

function checkGenerated(root: string, config: Record<string, unknown>): void {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "loop-rustra-codegen-"));
  const temporaryOutput = join(temporaryRoot, "generated");
  const temporaryConfig = join(temporaryRoot, "rustra.json");
  try {
    const codegen = config.codegen as Record<string, unknown>;
    writeFileSync(join(temporaryRoot, "package.json"), '{"type":"module"}\n');
    writeFileSync(temporaryConfig, `${JSON.stringify({
      ...config,
      schema: join(temporaryOutput, "schema.json"),
      output: temporaryOutput,
      codegen: {
        ...codegen,
        rustManifest: resolve(root, String(codegen.rustManifest)),
      },
    }, null, 2)}\n`);
    runPublishedCodegen(root, temporaryConfig);
    const actualOutput = resolve(root, String(config.output));
    const targetRelative = relative(actualOutput, join(root, "target")).split(sep).join("/");
    normalizeGeneratedDirectory(temporaryOutput, `${targetRelative}/`);

    const drift = generatedPaths(temporaryOutput).filter((path) => {
      const expected = join(temporaryOutput, path);
      const actual = join(actualOutput, path);
      return !existsSync(actual) || !readFileSync(expected).equals(readFileSync(actual));
    });
    if (drift.length > 0) {
      throw new Error(`generated contract drift: ${drift.join(", ")}; run bun run codegen`);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function main(): void {
  const root = resolve(import.meta.dir, "..");
  const configPath = join(root, "rustra.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  if (process.argv.includes("--check")) {
    checkGenerated(root, config);
    return;
  }

  runPublishedCodegen(root, configPath);
  normalizeGeneratedDirectory(resolve(dirname(configPath), String(config.output)));
}

if (import.meta.main) main();
