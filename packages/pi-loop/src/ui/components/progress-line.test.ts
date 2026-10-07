import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { ProgressLine, type ProgressData } from "./progress-line";
import type { LoopUiTheme } from "./ui-theme";

const theme: LoopUiTheme = {
  fg: (_token, text) => text,
  bg: (_token, text) => text,
  bold: (text) => text,
  italic: (text) => text,
  underline: (text) => text,
  strikethrough: (text) => text,
};

const data: ProgressData = { label: "run-1", done: 3, total: 9 };

test("ProgressLine renders label, bar, and counts within the default budget", () => {
  const line = new ProgressLine({ data: () => data, theme });
  const lines = line.render(80);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe("run-1 ▰▰▰▱▱▱▱▱▱ 3/9");
});

test("ProgressLine shows a full bar in the success token when complete", () => {
  const styled: LoopUiTheme = { ...theme, fg: (token, text) => `<${token}>${text}</${token}>` };
  const line = new ProgressLine({ data: () => ({ ...data, done: 9 }), theme: styled });
  const rendered = line.render(80)[0] ?? "";
  expect(rendered).toContain("<success>▰▰▰▰▰▰▰▰▰</success>");
  expect(rendered.endsWith("9/9")).toBe(true);
});

test("ProgressLine clamps the bar to narrow widths and keeps every line within width", () => {
  const line = new ProgressLine({ data: () => data, theme });
  for (const width of [80, 40, 20, 12, 8]) {
    for (const rendered of line.render(width)) {
      expect(visibleWidth(rendered)).toBeLessThanOrEqual(width);
    }
  }
});

test("ProgressLine renders an empty bar for a zero total", () => {
  const line = new ProgressLine({ data: () => ({ ...data, done: 0, total: 0 }), theme });
  const rendered = line.render(80)[0] ?? "";
  expect(rendered).toBe("run-1 ▱▱▱▱▱▱▱▱▱▱▱▱ 0/0");
});

test("ProgressLine reuses the cache while data is unchanged and re-renders after invalidate", () => {
  let current: ProgressData = { ...data };
  const line = new ProgressLine({ data: () => current, theme });
  const first = line.render(80);
  expect(line.render(80)).toEqual(first); // unchanged data → same output
  current = { ...data, done: 5 };
  expect(line.render(80)[0]).toContain("5/9"); // signature change → fresh render
  line.invalidate();
  expect(line.render(80)[0]).toContain("5/9"); // still correct after invalidate
});
