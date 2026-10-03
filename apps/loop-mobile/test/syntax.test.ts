/**
 * Syntax-highlighting scanner tests (task `composer-attach-and-highlighting`).
 * Pure functions only: identical inputs must produce identical spans, spans
 * must be contiguous/non-overlapping/total over the input, unknown languages
 * must return null (the caller's monospace fallback), and unterminated
 * strings/comments must degrade honestly (no throw, no invented close).
 */

import { describe, expect, test } from "bun:test";

import { canonicalLanguage, highlightSyntax, type SyntaxSpan } from "../src/features/syntax";

/** Spans must tile the whole string in order — the renderer's slicing
 * contract (it reconstructs the exact code from span boundaries). */
function expectTiling(code: string, spans: SyntaxSpan[]): void {
  let cursor = 0;
  for (const span of spans) {
    expect(span.start).toBe(cursor);
    expect(span.end).toBeGreaterThan(span.start);
    cursor = span.end;
  }
  expect(cursor).toBe(code.length);
  // Reconstruction equals the input — index correctness proven end-to-end.
  expect(spans.map((s) => code.slice(s.start, s.end)).join("")).toBe(code);
}

/** Collect the slice text for one kind. */
function textOfKind(code: string, spans: SyntaxSpan[], kind: SyntaxSpan["kind"]): string[] {
  return spans.filter((s) => s.kind === kind).map((s) => code.slice(s.start, s.end));
}

describe("canonicalLanguage", () => {
  test("fence aliases map onto the five scanner profiles", () => {
    expect(canonicalLanguage("ts")).toBe("ts");
    expect(canonicalLanguage("tsx")).toBe("ts");
    expect(canonicalLanguage("TypeScript")).toBe("ts");
    expect(canonicalLanguage("js")).toBe("ts");
    expect(canonicalLanguage("jsx")).toBe("ts");
    expect(canonicalLanguage("rs")).toBe("rust");
    expect(canonicalLanguage("py")).toBe("python");
    expect(canonicalLanguage("json")).toBe("json");
    expect(canonicalLanguage("bash")).toBe("bash");
    expect(canonicalLanguage("sh")).toBe("bash");
    expect(canonicalLanguage("zsh")).toBe("bash");
  });

  test("unknown or empty tags fall back to null", () => {
    expect(canonicalLanguage("")).toBeNull();
    expect(canonicalLanguage("yaml")).toBeNull();
    expect(canonicalLanguage("sql")).toBeNull();
    expect(canonicalLanguage("```")).toBeNull();
  });
});

describe("determinism and tiling", () => {
  const code = "const answer = 42; // six by nine\nconsole.log(`${answer}`);";
  test("identical input produces identical spans", () => {
    const a = highlightSyntax(code, "ts");
    const b = highlightSyntax(code, "ts");
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
  });

  test("spans cover the whole input exactly (render slice contract)", () => {
    expectTiling(code, highlightSyntax(code, "ts")!);
  });

  test("empty code yields zero spans for supported languages", () => {
    expect(highlightSyntax("", "ts")).toEqual([]);
    expect(highlightSyntax("", "json")).toEqual([]);
  });
});

describe("ts / js / tsx profile", () => {
  test("keyword, number, comment, string, template literal", () => {
    const code = 'const n = 42; // answer\nconst s = "hi";\nconst t = `a${1}b`;';
    const spans = highlightSyntax(code, "ts")!;
    expectTiling(code, spans);
    expect(textOfKind(code, spans, "keyword")).toEqual(["const", "const", "const"]);
    expect(textOfKind(code, spans, "number")).toEqual(["42"]);
    expect(textOfKind(code, spans, "comment")).toEqual(["// answer"]);
    expect(textOfKind(code, spans, "string")).toEqual(['"hi"', "`a${1}b`"]);
  });

  test("literals (true/false/null/undefined) and numbers with exponent/hex", () => {
    const code = "let ok = true; let gone = null; let big = 0xff; let e = 1e-10;";
    const spans = highlightSyntax(code, "js")!;
    expect(textOfKind(code, spans, "literal")).toEqual(["true", "null"]);
    expect(textOfKind(code, spans, "number")).toEqual(["0xff", "1e-10"]);
  });

  test("escaped quote stays inside the string; block comment spans lines", () => {
    const code = 'const s = "a\\"b"; /* multi\nline */ let x;';
    const spans = highlightSyntax(code, "ts")!;
    expect(textOfKind(code, spans, "string")).toEqual(['"a\\"b"']);
    expect(textOfKind(code, spans, "comment")).toEqual(["/* multi\nline */"]);
    expect(textOfKind(code, spans, "keyword")).toEqual(["const", "let"]);
  });

  test("unterminated string ends honestly at end of line (streaming cut)", () => {
    const code = 'const s = "unterminated\nlet after = 1;';
    const spans = highlightSyntax(code, "ts")!;
    expect(textOfKind(code, spans, "string")).toEqual(['"unterminated']);
    expect(textOfKind(code, spans, "keyword")).toEqual(["const", "let"]);
  });

  test("unterminated template string runs to end of input (streaming cut)", () => {
    const code = "const t = `still going";
    const spans = highlightSyntax(code, "ts")!;
    expect(textOfKind(code, spans, "string")).toEqual(["`still going"]);
  });
});

describe("rust profile", () => {
  test("fn/let/mut keywords, numbers, strings, block comment", () => {
    const code = "pub fn main() {\n    let mut n: u64 = 1_000; // count\n    /* block */\n}";
    const spans = highlightSyntax(code, "rust")!;
    expectTiling(code, spans);
    expect(textOfKind(code, spans, "keyword")).toEqual(["pub", "fn", "let", "mut"]);
    expect(textOfKind(code, spans, "number")).toEqual(["1_000"]);
    expect(textOfKind(code, spans, "comment")).toEqual(["// count", "/* block */"]);
  });

  test("lifetime 'a stays plain while char 'x' is a string", () => {
    const code = "fn f<'a>(c: char) -> &'a str { 'x' }";
    const spans = highlightSyntax(code, "rust")!;
    expect(textOfKind(code, spans, "string")).toEqual(["'x'"]);
    const plain = textOfKind(code, spans, "plain").join("|");
    expect(plain).toContain("'a");
  });

  test("true/false literals", () => {
    const code = "let flag = true; let off = false;";
    const spans = highlightSyntax(code, "rust")!;
    expect(textOfKind(code, spans, "literal")).toEqual(["true", "false"]);
  });
});

describe("python profile", () => {
  test("def/return keywords, None/True literals, # comment", () => {
    const code = "def greet(name):\n    return None  # nothing yet\nflag = True";
    const spans = highlightSyntax(code, "py")!;
    expectTiling(code, spans);
    expect(textOfKind(code, spans, "keyword")).toEqual(["def", "return"]);
    expect(textOfKind(code, spans, "literal")).toEqual(["None", "True"]);
    expect(textOfKind(code, spans, "comment")).toEqual(["# nothing yet"]);
  });

  test("triple-quoted docstring spans lines as one string", () => {
    const code = '"""Doc\nstring"""\nx = 1';
    const spans = highlightSyntax(code, "python")!;
    expect(textOfKind(code, spans, "string")).toEqual(['"""Doc\nstring"""']);
    expect(textOfKind(code, spans, "number")).toEqual(["1"]);
  });

  test("single-quoted strings and escaped quotes", () => {
    const code = "s = 'it\\'s'";
    const spans = highlightSyntax(code, "python")!;
    expect(textOfKind(code, spans, "string")).toEqual(["'it\\'s'"]);
  });
});

describe("json profile", () => {
  test("keys/values are strings; true/false/null literals; numbers", () => {
    const code = '{"ok": true, "count": 3, "none": null, "off": false}';
    const spans = highlightSyntax(code, "json")!;
    expectTiling(code, spans);
    expect(textOfKind(code, spans, "string")).toEqual(['"ok"', '"count"', '"none"', '"off"']);
    expect(textOfKind(code, spans, "literal")).toEqual(["true", "null", "false"]);
    expect(textOfKind(code, spans, "number")).toEqual(["3"]);
  });

  test("unterminated string (streaming cut) runs to end of input", () => {
    const code = '{"key": "value';
    const spans = highlightSyntax(code, "json")!;
    expect(textOfKind(code, spans, "string")).toEqual(['"key"', '"value']);
  });
});

describe("bash profile", () => {
  test("keywords, # comment, double and single quoted strings", () => {
    const code = "if [ -n \"$x\" ]; then\n  echo 'literal'  # done\nfi";
    const spans = highlightSyntax(code, "bash")!;
    expectTiling(code, spans);
    expect(textOfKind(code, spans, "keyword")).toEqual(["if", "then", "fi"]);
    expect(textOfKind(code, spans, "comment")).toEqual(["# done"]);
    expect(textOfKind(code, spans, "string")).toEqual(['"$x"', "'literal'"]);
  });

  test("$variables highlight as literals", () => {
    const code = "echo $HOME ${CACHE_DIR} $1";
    const spans = highlightSyntax(code, "bash")!;
    expect(textOfKind(code, spans, "literal")).toEqual(["$HOME", "${CACHE_DIR}", "$1"]);
  });

  test("shebang line is a comment", () => {
    const code = "#!/usr/bin/env bash\necho hi";
    const spans = highlightSyntax(code, "bash")!;
    expect(textOfKind(code, spans, "comment")).toEqual(["#!/usr/bin/env bash"]);
  });
});

describe("fallback contract", () => {
  test("unsupported language returns null (caller keeps monospace fallback)", () => {
    expect(highlightSyntax("SELECT * FROM t", "sql")).toBeNull();
    expect(highlightSyntax("anything", "")).toBeNull();
    expect(highlightSyntax("key: value", "yaml")).toBeNull();
  });
});
