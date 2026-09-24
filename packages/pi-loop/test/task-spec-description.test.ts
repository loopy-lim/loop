import { expect, test } from "bun:test";

import { derivePersonaVocabulary, KIND_DEFAULT_PERSONAS } from "@loop/orchestrator/persona";

import { taskSpecInputDescription } from "../src/lead/prompts";

// Disk-independent default-install fixture: the compile-time persona floor
// with no registry (matches the derivation for an uninstalled personas dir).
const vocabulary = derivePersonaVocabulary({});

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

test("taskSpecInputDescription renders every persona id in vocabulary order", () => {
  const description = taskSpecInputDescription(vocabulary);

  // The default vocabulary still produces the historical list, in order.
  expect(vocabulary.ids).toEqual(LEGACY_PERSONA_LIST.split(" | "));
  // The description renders that exact list inside the persona parenthetical.
  expect(description).toContain(`"persona" id (${LEGACY_PERSONA_LIST})`);
  // Every id appears in vocabulary order within the rendered list.
  let cursor = description.indexOf(`"persona" id (`);
  expect(cursor).toBeGreaterThanOrEqual(0);
  for (const id of vocabulary.ids) {
    const at = description.indexOf(id, cursor);
    expect(at).toBeGreaterThanOrEqual(cursor);
    cursor = at;
  }
});

test("taskSpecInputDescription renders every kind default as kind→persona", () => {
  const description = taskSpecInputDescription(vocabulary);

  for (const [kind, persona] of Object.entries(vocabulary.kindDefaults)) {
    expect(description).toContain(`${kind}→${persona}`);
  }
  // Each pair appears exactly once, immediately after "Kind defaults: ".
  const match = description.match(/Kind defaults: ([a-z]+→[a-z]+(?:, [a-z]+→[a-z]+)*)\./);
  expect(match).not.toBeNull();
});

test("taskSpecInputDescription keeps the unknown-id rejection wording", () => {
  const description = taskSpecInputDescription(vocabulary);
  expect(description).toContain("unknown ids are rejected at submission with the valid id list");
});

test("derived prose covers the full legacy vocabulary (no id dropped or invented)", () => {
  const description = taskSpecInputDescription(vocabulary);

  // Same pair set as the legacy mapping: nothing dropped, nothing invented.
  const renderedPairs = (description.match(/Kind defaults: ([a-z]+→[a-z]+(?:, [a-z]+→[a-z]+)*)\./) ?? [])[1]?.split(", ") ?? [];
  expect(renderedPairs).toHaveLength(LEGACY_KIND_DEFAULTS.length);
  expect([...renderedPairs].sort()).toEqual([...LEGACY_KIND_DEFAULTS].sort());
});

test("taskSpecInputDescription reflects configured registry additions and kind-default overrides", () => {
  // config/personas/pirate.md joins the vocabulary and decision is overridden
  // to designer: both must flow into the prose. Statically precomputed prose
  // (module constants) would not track configuration — this is the regression
  // pin against reintroducing it.
  const configured = derivePersonaVocabulary(
    { implementer: "IMPL", reviewer: "REV", debugger: "DBG", architect: "ARCH", designer: "DES", pirate: "YARR" },
    { ...KIND_DEFAULT_PERSONAS, decision: "designer" },
  );
  const description = taskSpecInputDescription(configured);

  expect(description).toContain("implementer | reviewer | debugger | designer | architect | pirate");
  expect(description).toContain("decision→designer");
  expect(description).not.toContain("decision→architect");
  // Overridden kinds keep the floor for the rest.
  expect(description).toContain("research→debugger");
});
