import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyApproval, describeApprovalTrigger } from "./classifier";

describe("classifyApproval", () => {
  it("unannotated tools ask (MCP defaults: not read-only, possibly destructive/open world)", () => {
    assert.equal(classifyApproval(undefined), "ask");
    assert.equal(classifyApproval({}), "ask");
  });

  it("read-only tools allow without asking", () => {
    assert.equal(classifyApproval({ readOnlyHint: true }), "allow");
    assert.equal(classifyApproval({ readOnlyHint: true, openWorldHint: false }), "allow");
  });

  it("destructive tools always ask, even when marked read-only", () => {
    assert.equal(classifyApproval({ destructiveHint: true }), "ask");
    assert.equal(classifyApproval({ readOnlyHint: true, destructiveHint: true }), "ask");
  });

  it("non-read-only tools ask unless destructive and open world are both false", () => {
    assert.equal(classifyApproval({ destructiveHint: false }), "ask");
    assert.equal(classifyApproval({ openWorldHint: false }), "ask");
    assert.equal(classifyApproval({ destructiveHint: false, openWorldHint: true }), "ask");
    assert.equal(classifyApproval({ destructiveHint: true, openWorldHint: false }), "ask");
    assert.equal(classifyApproval({ destructiveHint: false, openWorldHint: false }), "allow");
  });
});

describe("describeApprovalTrigger", () => {
  it("names the hint that triggered approval", () => {
    assert.equal(describeApprovalTrigger({ destructiveHint: true }), "destructive");
    assert.equal(
      describeApprovalTrigger({ readOnlyHint: true, destructiveHint: true }),
      "destructive",
    );
    assert.equal(describeApprovalTrigger(undefined), "possibly destructive, open world");
    assert.equal(describeApprovalTrigger({ destructiveHint: false }), "open world");
    assert.equal(describeApprovalTrigger({ openWorldHint: false }), "possibly destructive");
  });
});
