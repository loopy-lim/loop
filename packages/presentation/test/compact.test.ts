import { expect, test } from "bun:test";

import { compactLines, singleLine } from "../src/compact";

test("compactLines reserves the last line for an exact omitted count", () => {
  expect(compactLines(["one", "two", "three"], {
    lineLimit: 1,
    lineTextLimit: 160,
    overflow: (omitted) => `… ${omitted} more rows`,
  })).toEqual(["… 3 more rows"]);
  expect(compactLines(["one", "two", "three"], {
    lineLimit: 2,
    lineTextLimit: 160,
    overflow: (omitted) => `… ${omitted} more rows`,
  })).toEqual(["one", "… 2 more rows"]);
  expect(compactLines(["one", "two"], {
    lineLimit: 2,
    lineTextLimit: 160,
    overflow: (omitted) => `… ${omitted} more rows`,
  })).toEqual(["one", "two"]);
});

test("singleLine normalizes CRLF and truncates by Unicode grapheme", () => {
  const value = singleLine(`prefix\r\n${"👩🏽‍💻".repeat(10)}`, 8);
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

  expect(value).not.toMatch(/[\r\n]/);
  expect([...segmenter.segment(value)]).toHaveLength(8);
  expect(value.endsWith("…")).toBe(true);
});
