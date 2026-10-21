/**
 * Syntax highlighting for code-fence blocks — a dependency-0, closed-grammar
 * scanner (task `composer-attach-and-highlighting`). Display-level only.
 *
 * The contract is index-based: `highlightSyntax` returns spans over the
 * ORIGINAL code string (contiguous, non-overlapping, covering the whole
 * input), so the renderer slices the exact text it already displays and the
 * copy button keeps copying the untouched code. A `null` return means the
 * language is not supported — the caller falls back to plain monospace.
 *
 * Pure: no React, no state, deterministic for identical input (same spans
 * every call) — unit-tested in test/syntax.test.ts.
 */

export type SyntaxTokenKind =
  | "comment" // // …  # …  /* … */
  | "string" // "…" '…' `…` """…"""
  | "number" // 1, 0xff, 1_000, 1.5e10
  | "keyword" // language keywords (const, fn, def, if, …)
  | "literal" // true / false / null / None / undefined / $variables
  | "plain"; // identifiers, punctuation, whitespace

export type SyntaxSpan = { start: number; end: number; kind: SyntaxTokenKind };

/** Languages map onto a small set of scanner profiles; aliases are display
 * spellings of the same profile (tsx and ts share the C-family scanner). */
export type CanonicalLanguage = "ts" | "rust" | "python" | "json" | "bash";

/** Map a fence tag to its scanner profile; null for unknown tags (the
 * caller renders the monospace fallback). */
export function canonicalLanguage(lang: string): CanonicalLanguage | null {
  switch (lang.trim().toLowerCase()) {
    case "ts":
    case "tsx":
    case "typescript":
    case "js":
    case "jsx":
    case "javascript":
    case "mjs":
    case "cjs":
      return "ts";
    case "rust":
    case "rs":
      return "rust";
    case "py":
    case "python":
      return "python";
    case "json":
      return "json";
    case "bash":
    case "sh":
    case "shell":
    case "zsh":
      return "bash";
    default:
      return null;
  }
}

type StringRule = {
  open: string;
  close: string;
  escape: boolean;
  multiline: boolean;
};

type LanguageProfile = {
  lineComments: string[];
  blockComments: Array<[string, string]>;
  strings: StringRule[];
  keywords: ReadonlySet<string>;
  literals: ReadonlySet<string>;
  /** Variables ($VAR) — bash only; highlighted as literals. */
  dollarVariables: boolean;
};

const TS_KEYWORDS = [
  "abstract",
  "any",
  "as",
  "asserts",
  "async",
  "await",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "constructor",
  "continue",
  "debugger",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "infer",
  "instanceof",
  "interface",
  "is",
  "keyof",
  "let",
  "module",
  "namespace",
  "never",
  "new",
  "number",
  "object",
  "of",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "satisfies",
  "set",
  "static",
  "string",
  "super",
  "switch",
  "symbol",
  "this",
  "throw",
  "try",
  "type",
  "typeof",
  "unique",
  "unknown",
  "var",
  "void",
  "while",
  "with",
  "yield",
] as const;

const RUST_KEYWORDS = [
  "as",
  "async",
  "await",
  "break",
  "const",
  "continue",
  "crate",
  "dyn",
  "else",
  "enum",
  "extern",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "static",
  "struct",
  "super",
  "trait",
  "type",
  "union",
  "unsafe",
  "use",
  "where",
  "while",
] as const;

const PYTHON_KEYWORDS = [
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
] as const;

const BASH_KEYWORDS = [
  "case",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "select",
  "then",
  "time",
  "until",
  "while",
] as const;

const PROFILES: Record<CanonicalLanguage, LanguageProfile> = {
  ts: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    strings: [
      { open: '"', close: '"', escape: true, multiline: false },
      { open: "'", close: "'", escape: true, multiline: false },
      { open: "`", close: "`", escape: true, multiline: true },
    ],
    keywords: new Set(TS_KEYWORDS),
    literals: new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]),
    dollarVariables: false,
  },
  rust: {
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    strings: [
      { open: '"', close: '"', escape: true, multiline: false },
      // Rust raw strings r"…" / r#"…"# are rare in fence snippets; the plain
      // quote rule degrades them honestly (quote-to-quote string coloring).
    ],
    keywords: new Set(RUST_KEYWORDS),
    literals: new Set(["true", "false"]),
    dollarVariables: false,
  },
  python: {
    lineComments: ["#"],
    blockComments: [],
    strings: [
      { open: '"""', close: '"""', escape: false, multiline: true },
      { open: "'''", close: "'''", escape: false, multiline: true },
      { open: '"', close: '"', escape: true, multiline: false },
      { open: "'", close: "'", escape: true, multiline: false },
    ],
    keywords: new Set(PYTHON_KEYWORDS),
    literals: new Set(["True", "False", "None"]),
    dollarVariables: false,
  },
  json: {
    lineComments: [],
    blockComments: [],
    strings: [{ open: '"', close: '"', escape: true, multiline: false }],
    keywords: new Set([]),
    literals: new Set(["true", "false", "null"]),
    dollarVariables: false,
  },
  bash: {
    lineComments: ["#"],
    blockComments: [],
    strings: [
      { open: '"', close: '"', escape: true, multiline: false },
      { open: "'", close: "'", escape: false, multiline: false },
    ],
    keywords: new Set(BASH_KEYWORDS),
    literals: new Set(["true", "false"]),
    dollarVariables: true,
  },
};

function isIdentifierStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
}

function isIdentifierContinue(ch: string): boolean {
  return isIdentifierStart(ch) || (ch >= "0" && ch <= "9");
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** Bounds-checked character read (callers guarantee the index is in range). */
function codeCharAt(code: string, index: number): string {
  const value = code[index];
  if (value === undefined) throw new RangeError(`index ${index} out of range`);
  return value;
}

/** One profile-driven scan pass. Spans are contiguous and cover the input. */
function scanProfile(code: string, profile: LanguageProfile): SyntaxSpan[] {
  const spans: SyntaxSpan[] = [];
  const n = code.length;
  let i = 0;
  // Plain-run accumulator: punctuation/whitespace merges into one span to
  // keep the span count proportional to structure, not characters.
  let plainStart = -1;
  const flushPlain = (end: number): void => {
    if (plainStart >= 0) {
      spans.push({ start: plainStart, end, kind: "plain" });
      plainStart = -1;
    }
  };
  const push = (start: number, end: number, kind: SyntaxTokenKind): void => {
    flushPlain(start);
    spans.push({ start, end, kind });
  };

  while (i < n) {
    const ch = codeCharAt(code, i);
    let matched = false;
    for (const [open, close] of profile.blockComments) {
      if (code.startsWith(open, i)) {
        const closeAt = code.indexOf(close, i + open.length);
        const end = closeAt < 0 ? n : closeAt + close.length;
        push(i, end, "comment");
        i = end;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    for (const open of profile.lineComments) {
      if (code.startsWith(open, i)) {
        const nl = code.indexOf("\n", i + open.length);
        const end = nl < 0 ? n : nl; // newline itself stays plain
        push(i, end, "comment");
        i = end;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    for (const rule of profile.strings) {
      if (!code.startsWith(rule.open, i)) continue;
      let j = i + rule.open.length;
      while (j < n) {
        if (rule.escape && code[j] === "\\") {
          j += 2; // the escaped char is part of the string either way
          continue;
        }
        if (code.startsWith(rule.close, j)) {
          j += rule.close.length;
          break;
        }
        if (!rule.multiline && code[j] === "\n") break; // unterminated ends at EOL
        j += 1;
      }
      push(i, Math.min(j, n), "string");
      i = Math.min(j, n);
      matched = true;
      break;
    }
    if (matched) continue;
    if (profile.dollarVariables && ch === "$") {
      // $VAR and $1 run to the first non-identifier char; ${…} runs to its
      // closing brace (or EOL when the cut arrives first — honest).
      let j = i + 1;
      if (code[j] === "{") {
        const close = code.indexOf("}", j);
        j = close < 0 ? n : close + 1;
      } else {
        while (j < n && isIdentifierContinue(codeCharAt(code, j))) j += 1;
      }
      push(i, j, "literal");
      i = j;
      continue;
    }
    if (isDigit(ch)) {
      let j = i + 1;
      while (j < n) {
        const c = codeCharAt(code, j);
        if (isIdentifierContinue(c) || c === ".") {
          j += 1;
          continue;
        }
        // Exponent sign: 1e-10 / 1E+10 — the sign belongs to the number.
        if ((c === "+" || c === "-") && codeCharAt(code, j - 1).toLowerCase() === "e") {
          j += 1;
          continue;
        }
        break;
      }
      push(i, j, "number");
      i = j;
      continue;
    }
    if (isIdentifierStart(ch) && ch !== "$") {
      let j = i + 1;
      while (j < n && isIdentifierContinue(codeCharAt(code, j))) j += 1;
      const word = code.slice(i, j);
      let kind: SyntaxTokenKind = "plain";
      if (profile.keywords.has(word)) kind = "keyword";
      else if (profile.literals.has(word)) kind = "literal";
      if (kind === "plain") {
        if (plainStart < 0) plainStart = i;
        i = j;
      } else {
        push(i, j, kind);
        i = j;
      }
      continue;
    }
    // Rust char literal vs lifetime: 'x' is a string, 'a alone is plain.
    if (ch === "'") {
      const third = i + 2 < n ? code[i + 2] : undefined;
      const fourth = i + 3 < n ? code[i + 3] : undefined;
      if (code[i + 1] === "\\" && fourth === "'") {
        push(i, i + 4, "string"); // '\n' …
        i += 4;
        continue;
      }
      if (third === "'" && code[i + 1] !== undefined) {
        push(i, i + 3, "string"); // 'a'
        i += 3;
        continue;
      }
    }
    if (plainStart < 0) plainStart = i;
    i += 1;
  }
  flushPlain(n);
  return spans;
}

/**
 * Highlight `code` written in `lang`. Returns spans over the original
 * string (sorted, contiguous, total) or null when the language is
 * unsupported — the caller keeps its existing monospace rendering.
 * Deterministic: identical inputs produce identical span arrays.
 */
export function highlightSyntax(code: string, lang: string): SyntaxSpan[] | null {
  const canonical = canonicalLanguage(lang);
  if (canonical === null) return null;
  return scanProfile(code, PROFILES[canonical]);
}
