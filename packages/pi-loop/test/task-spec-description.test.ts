import { expect, test } from "bun:test";

import { KIND_DEFAULT_PERSONAS, PERSONA_IDS } from "@loop/orchestrator/persona";

import { taskSpecInputDescription } from "../src/lead/prompts";

// The hardcoded prose this description previously shipped. Kept as a pin: the
// derived strings must render the same vocabulary in the same order, so a
// reorder in the persona single source surfaces here instead of silently
// changing the Lead prompt.
const LEGACY_PERSONA_LIST = "implementer | reviewer | debugger | architect | designer";
const LEGACY_KIND_DEFAULTS = [
  "implementation→implementer",
  "verification→reviewer",
  "research→debugger",
  "decision→architect",
  "integration→architect",
];

test("taskSpecInputDescription renders every persona id in PERSONA_IDS order", () => {
  const description = taskSpecInputDescription();

  // The single source still produces the historical list, in order.
  expect(PERSONA_IDS).toEqual(LEGACY_PERSONA_LIST.split(" | "));
  // The description renders that exact list inside the persona parenthetical.
  expect(description).toContain(`"persona" id (${LEGACY_PERSONA_LIST})`);
  // Every id appears in PERSONA_IDS order within the rendered list.
  let cursor = description.indexOf(`"persona" id (`);
  expect(cursor).toBeGreaterThanOrEqual(0);
  for (const id of PERSONA_IDS) {
    const at = description.indexOf(id, cursor);
    expect(at).toBeGreaterThanOrEqual(cursor);
    cursor = at;
  }
});

test("taskSpecInputDescription renders every kind default as kind→persona", () => {
  const description = taskSpecInputDescription();

  for (const [kind, persona] of Object.entries(KIND_DEFAULT_PERSONAS)) {
    expect(description).toContain(`${kind}→${persona}`);
  }
  // Each pair appears exactly once, immediately after "Kind defaults: ".
  const match = description.match(/Kind defaults: ([a-z]+→[a-z]+(?:, [a-z]+→[a-z]+)*)\./);
  expect(match).not.toBeNull();
  const renderedPairs = match![1].split(", ");
});

test("taskSpecInputDescription keeps the unknown-id rejection wording", () => {
  const description = taskSpecInputDescription();
  expect(description).toContain("unknown ids are rejected at submission with the valid id list");
});

test("derived prose covers the full legacy vocabulary (no id dropped or invented)", () => {
  const description = taskSpecInputDescription();

  // Same pair set as the legacy mapping: nothing dropped, nothing invented.
  const renderedPairs = (description.match(/Kind defaults: ([a-z]+→[a-z]+(?:, [a-z]+→[a-z]+)*)\./) ?? [])[1]?.split(", ") ?? [];
  expect(renderedPairs).toHaveLength(LEGACY_KIND_DEFAULTS.length);
  expect([...renderedPairs].sort()).toEqual([...LEGACY_KIND_DEFAULTS].sort());
});
