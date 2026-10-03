import { expect, test } from "bun:test";
import { normalizeLabel } from "../src/normalize";

test("normalizes whitespace and title-cases words", () => {
  expect(normalizeLabel("  hello   WORLD  ")).toBe("Hello World");
});
