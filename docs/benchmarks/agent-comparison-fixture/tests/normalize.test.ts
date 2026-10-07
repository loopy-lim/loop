import { expect, test } from "bun:test";
import { normalizeLabel } from "../src/normalize";

test("trims, collapses whitespace, and title-cases words", () => {
  expect(normalizeLabel("  hELLO   wORLD  ")).toBe("Hello World");
  expect(normalizeLabel("  ")).toBe("");
});
