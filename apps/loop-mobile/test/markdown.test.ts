/**
 * Unit tests for the lightweight markdown renderer (decision
 * 2026-xx-codex-detail-checklist C1). Deterministic: pure parser, no
 * React, no network, no model calls.
 */

import { describe, expect, test } from "bun:test";

import { BULLET_INDENT, parseInline, parseMarkdown } from "../src/features/markdown";

describe("markdown parser (C1, AC1-1) — five closed constructs", () => {
  test("a code fence yields one code node with its language and raw code", () => {
    const blocks = parseMarkdown("```ts\nconst a = 1;\nconst b = 2;\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("code");
    expect(blocks[0]?.kind === "code" && blocks[0]?.lang).toBe("ts");
    expect(blocks[0]?.kind === "code" && blocks[0]?.text).toBe("const a = 1;\nconst b = 2;");
  });

  test("inline code yields an inlineCode span (AC1-1)", () => {
    const spans = parseInline("run `bun test` now");
    expect(spans).toHaveLength(3);
    expect(spans[1]?.kind).toBe("inlineCode");
    expect(spans[1]?.kind === "inlineCode" && spans[1]?.text).toBe("bun test");
  });

  test("a ## header yields a header node with its level (AC1-1)", () => {
    const blocks = parseMarkdown("## Plan");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("header");
    expect(blocks[0]?.kind === "header" && blocks[0]?.level).toBe(2);
    expect(blocks[0]?.kind === "header" && blocks[0]?.text).toBe("Plan");
  });

  test("a bullet yields a bullet node (AC1-1)", () => {
    const blocks = parseMarkdown("- first item");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("bullet");
    expect(blocks[0]?.kind === "bullet" && blocks[0]?.text).toBe("first item");
  });

  test("**bold** yields a bold span (AC1-1)", () => {
    const spans = parseInline("this is **important**");
    expect(spans[1]?.kind).toBe("bold");
    expect(spans[1]?.kind === "bold" && spans[1]?.text).toBe("important");
  });

  test("unknown emphasis syntax is preserved as plain text (AC1-1)", () => {
    const spans = parseInline("a ~~strike~~ b");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.kind).toBe("text");
    expect(spans[0]?.kind === "text" && spans[0]?.text).toBe("a ~~strike~~ b");
  });

  test("mixed document keeps block order and prose integrity", () => {
    const blocks = parseMarkdown(
      "## Notes\n- one\n- two\nplain **bold** and `code`\n```bash\nls -la\n```",
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "header",
      "bullet",
      "bullet",
      "text",
      "code",
    ]);
  });

  test("a mid-stream open fence stays an honest code block of what arrived", () => {
    const blocks = parseMarkdown("```python\nprint('hi')");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("code");
    expect(blocks[0]?.kind === "code" && blocks[0]?.text).toBe("print('hi')");
  });

  test("the copy payload is the parsed raw code — no fence markers (AC2-2)", () => {
    const blocks = parseMarkdown("```\nselect 1;\n```");
    const code = blocks[0]?.kind === "code" ? blocks[0]?.text : "";
    expect(code).toBe("select 1;");
    expect(code.includes("`")).toBe(false);
  });
});

describe("dependency hygiene (C1, AC1-3)", () => {
  test("package.json adds no markdown/highlight library — dependency 0 stays", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("../package.json") as { dependencies: Record<string, string> };
    const names = Object.keys(pkg.dependencies);
    const banned = /markdown|remark|marked|highlight|prism|shiki/i;
    expect(names.filter((name) => banned.test(name))).toEqual([]);
  });
});

// ——— plan 2026-10-25 AC-6: ordered lists, links, italics ———————————————

describe("ordered lists (AC-6)", () => {
  test("a `1.` line yields an ordered block with its number", () => {
    const blocks = parseMarkdown("1. first\n2. second");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("ordered");
    expect(blocks[0]?.kind === "ordered" && blocks[0]?.n).toBe(1);
    expect(blocks[0]?.kind === "ordered" && blocks[0]?.text).toBe("first");
    expect(blocks[1]?.kind === "ordered" && blocks[1]?.n).toBe(2);
  });

  test("a `1)` marker also yields an ordered block", () => {
    const blocks = parseMarkdown("3) third");
    expect(blocks[0]?.kind).toBe("ordered");
    expect(blocks[0]?.kind === "ordered" && blocks[0]?.n).toBe(3);
  });

  test("prose sentences with dots are not ordered lists", () => {
    const blocks = parseMarkdown("버전 1.2가 나왔습니다");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("text");
  });
});

describe("inline links (AC-6)", () => {
  test("an http link becomes a link span with its url", () => {
    const spans = parseInline("see [docs](https://example.com/a) now");
    expect(spans).toHaveLength(3);
    expect(spans[1]?.kind).toBe("link");
    expect(spans[1]?.kind === "link" && spans[1]?.text).toBe("docs");
    expect(spans[1]?.kind === "link" && spans[1]?.url).toBe("https://example.com/a");
  });

  test("https links are admitted like http", () => {
    const spans = parseInline("[x](https://example.com)");
    expect(spans[0]?.kind).toBe("link");
  });

  test("non-http schemes stay literal text", () => {
    const spans = parseInline("[x](file:///etc/passwd)");
    expect(spans.some((span) => span.kind === "link")).toBe(false);
    const joined = spans.map((span) => ("text" in span ? span.text : "")).join("");
    expect(joined).toBe("[x](file:///etc/passwd)");
  });

  test("a stray bracket advances literally instead of hanging", () => {
    const spans = parseInline("a [ b [c](https://e.com)");
    expect(spans.some((span) => span.kind === "link")).toBe(true);
  });
});

describe("italic (AC-6)", () => {
  test("a single-* pair yields an italic span", () => {
    const spans = parseInline("this is *neat* ok");
    expect(spans).toHaveLength(3);
    expect(spans[1]?.kind).toBe("italic");
    expect(spans[1]?.kind === "italic" && spans[1]?.text).toBe("neat");
  });

  test("multiplication asterisks stay literal (flanking rules)", () => {
    const spans = parseInline("2 * 3 * 4 = 24");
    expect(spans.some((span) => span.kind === "italic")).toBe(false);
    const joined = spans.map((span) => ("text" in span ? span.text : "")).join("");
    expect(joined).toBe("2 * 3 * 4 = 24");
  });

  test("bold still wins over italic at the same index", () => {
    const spans = parseInline("**bold** then *italic*");
    expect(spans.map((span) => span.kind)).toEqual(["bold", "text", "italic"]);
  });
});

// ——— plan 2026-10-25-markdown-comfort: tables, nested bullets ——————————

describe("GFM tables (comfort AC-1)", () => {
  test("a header+delimiter pair opens a table; rows are trimmed cells", () => {
    const blocks = parseMarkdown("| 구성 | 상태 |\n|---|---|\n| macOS VM | 설치 완료 |\n| 릴레이 | 6시간 정상 |");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("table");
    if (blocks[0]?.kind !== "table") return;
    expect(blocks[0].head).toEqual(["구성", "상태"]);
    expect(blocks[0].rows).toEqual([["macOS VM", "설치 완료"], ["릴레이", "6시간 정상"]]);
  });

  test("colon-aligned delimiters are admitted", () => {
    const blocks = parseMarkdown("| a | b |\n| :--- | ---: |");
    expect(blocks[0]?.kind).toBe("table");
  });

  test("a lone pipe line without a delimiter row stays literal text", () => {
    const blocks = parseMarkdown("a | b 병합\n그 다음 줄");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("text");
  });

  test("a delimiter row without a pipe header stays literal text", () => {
    const blocks = parseMarkdown("구분\n|---|---|\n내용");
    expect(blocks[0]?.kind).toBe("text");
  });

  test("rows stop at the first non-pipe line", () => {
    const blocks = parseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n\n본문 문단");
    expect(blocks[0]?.kind).toBe("table");
    if (blocks[0]?.kind !== "table") return;
    expect(blocks[0].rows).toEqual([["1", "2"]]);
    expect(blocks[1]?.kind).toBe("text");
  });
});

describe("nested bullets (comfort AC-2)", () => {
  test("two-space indent yields a level-1 bullet", () => {
    const blocks = parseMarkdown("- 상위\n  - 하위\n- 상위2");
    expect(blocks.map((block) => block.kind)).toEqual(["bullet", "bullet", "bullet"]);
    if (blocks[1]?.kind !== "bullet") return;
    expect(blocks[1].level).toBe(1);
    expect(blocks[1].text).toBe("하위");
    if (blocks[0]?.kind !== "bullet") return;
    expect(blocks[0].level).toBe(0);
  });

  test("indent level caps at the registered steps", () => {
    const blocks = parseMarkdown("        - 깊음");
    if (blocks[0]?.kind !== "bullet") return;
    expect(blocks[0].level).toBe(3);
  });

  test("nested indent steps come from the closed spacing scale", () => {
    // ui/tokens space: m=12, l=16, xl=24 — keep the parser in sync with the
    // design system (plan 2026-10-25-markdown-comfort AC-3).
    expect(BULLET_INDENT).toEqual([12, 16, 24]);
  });
});

describe("indented fences (markdown-comfort follow-up, live finding)", () => {
  test("a fence indented inside a list item is still a code block", () => {
    const blocks = parseMarkdown("실행:\n  ```bash\n  diskutil list\n  ```");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("text");
    expect(blocks[1]?.kind).toBe("code");
    expect(blocks[1]?.kind === "code" && blocks[1]?.lang).toBe("bash");
    // the code body keeps its own indentation — code semantics, honest render
    expect(blocks[1]?.kind === "code" && blocks[1]?.text).toBe("  diskutil list");
  });

  test("a deeper-indented fence (nested list level 2+) still opens", () => {
    const blocks = parseMarkdown("    ```\n    x\n    ```");
    expect(blocks[0]?.kind).toBe("code");
    expect(blocks[0]?.kind === "code" && blocks[0]?.text).toBe("    x");
  });

  test("inline backticks never become fences", () => {
    const blocks = parseMarkdown("이것은 `코드` 입니다");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("text");
  });
});
