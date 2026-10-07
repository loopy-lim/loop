import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { TaskCard, taskStateGlyph, type TaskCardData } from "./task-card";
import type { LoopUiTheme } from "./ui-theme";

const theme: LoopUiTheme = {
  fg: (_token, text) => text,
  bg: (_token, text) => text,
  bold: (text) => text,
  italic: (text) => text,
  underline: (text) => text,
  strikethrough: (text) => text,
};

const data: TaskCardData = {
  id: "tui-components",
  title: "재사용 가능한 pi-tui Loop 컴포넌트",
  kind: "implementation",
  state: "running",
  attempt: 2,
};

test("TaskCard renders a header with the state glyph and a meta line", () => {
  const card = new TaskCard({ data: () => data, theme });
  const lines = card.render(80);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toBe(`${taskStateGlyph.running} ${data.title}`);
  expect(lines[1]).toBe(`  ${data.id} · ${data.kind} · ${data.state} · attempt 2`);
});

test("TaskCard glyphs and tokens follow the task state", () => {
  expect(taskStateGlyph.done).toBe("✓");
  expect(taskStateGlyph.failed).toBe("!");
  expect(taskStateGlyph.attention).toBe("!");
  const card = new TaskCard({
    data: () => ({ ...data, state: "failed" }),
    theme: { ...theme, fg: (token, text) => `<${token}>${text}</${token}>` },
  });
  const lines = card.render(80);
  expect(lines[0]).toContain("<error>!</error>");
  expect(lines[1]).toContain("failed");
});

test("TaskCard lines stay within the supplied width", () => {
  const card = new TaskCard({ data: () => data, theme });
  for (const width of [80, 40, 24, 12]) {
    for (const line of card.render(width)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  }
});

test("TaskCard reuses cached lines while data is unchanged and re-renders after invalidate", () => {
  let current: TaskCardData = { ...data };
  const card = new TaskCard({ data: () => current, theme });
  const first = card.render(80);
  expect(card.render(80)).toBe(first); // unchanged data → cached array reused
  current = { ...data, state: "done" };
  expect(card.render(80)[0]).toBe(`✓ ${data.title}`); // signature change → fresh render
  card.invalidate();
  expect(card.render(80)[0]).toBe(`✓ ${data.title}`); // still correct after invalidate
});
