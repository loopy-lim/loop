/**
 * Unit tests for the lightweight markdown renderer (decision
 * 2026-xx-codex-detail-checklist C1). Deterministic: pure parser, no
 * React, no network, no model calls.
 */

import { describe, expect, test } from "bun:test";

import { parseInline, parseMarkdown } from "../src/features/markdown";

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
