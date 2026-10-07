import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { AttentionList, type AttentionItem } from "./attention-list";
import type { LoopUiTheme } from "./ui-theme";

const theme: LoopUiTheme = {
  fg: (_token, text) => text,
  bg: (_token, text) => text,
  bold: (text) => text,
  italic: (text) => text,
  underline: (text) => text,
  strikethrough: (text) => text,
};

function item(id: string, kind: AttentionItem["kind"], summary = `summary for ${id}`): AttentionItem {
  return { id, kind, summary, taskId: id === "a2" ? "tui-components" : null };
}

test("AttentionList renders an empty state when nothing is open", () => {
  const list = new AttentionList({ items: () => [], theme });
  expect(list.render(40)).toEqual(["OK"]);
});

test("AttentionList renders a header, kind-marked items, and an overflow line", () => {
  const items = [
    item("a1", "question"),
    item("a2", "failure"),
    item("a3", "conflict"),
    item("a4", "decision"),
  ];
  const list = new AttentionList({ items: () => items, theme, maxItems: 2 });
  const lines = list.render(80);
  expect(lines).toEqual([
    "Attention · 4 open",
    "? summary for a1",
    "! summary for a2 (tui-components)",
    "… 2 more attention items",
  ]);
});

test("AttentionList colors by kind through semantic tokens", () => {
  const items = [item("a1", "failure"), item("a2", "conflict"), item("a3", "question")];
  const styled: LoopUiTheme = { ...theme, fg: (token, text) => `[${token}]${text}` };
  const lines = new AttentionList({ items: () => items, theme: styled }).render(80);
  expect(lines[1]).toMatch(/^\[error\]/);
  expect(lines[2]).toMatch(/^\[warning\]/);
  expect(lines[3]).toMatch(/^\[accent\]/);
});

test("AttentionList lines stay within the supplied width", () => {
  const items = Array.from({ length: 8 }, (_, index) =>
    item(`a${index}`, "question", `아주 긴 요약 텍스트 ${index} — width handling check`),
  );
  const list = new AttentionList({ items: () => items, theme, maxItems: 3 });
  for (const width of [80, 40, 20, 12]) {
    for (const line of list.render(width)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  }
});

test("AttentionList reuses cached lines while data is unchanged and re-renders after invalidate", () => {
  let items: AttentionItem[] = [item("a1", "question")];
  const list = new AttentionList({ items: () => items, theme });
  const first = list.render(80);
  expect(list.render(80)).toBe(first); // unchanged data → cached array reused
  items = [item("a1", "failure")];
  expect(list.render(80)[1]).toBe("! summary for a1"); // signature change → fresh render
  list.invalidate();
  expect(list.render(80)[1]).toBe("! summary for a1"); // still correct after invalidate
});
