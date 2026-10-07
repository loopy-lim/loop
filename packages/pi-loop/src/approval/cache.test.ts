import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SessionApprovalCache } from "./cache";

describe("SessionApprovalCache", () => {
  it("tracks always-allowed tool names per session", () => {
    const cache = new SessionApprovalCache();
    assert.equal(cache.isAlwaysAllowed("bash"), false);
    cache.allowAlways("bash");
    assert.equal(cache.isAlwaysAllowed("bash"), true);
    assert.equal(cache.isAlwaysAllowed("edit"), false);
    assert.equal(cache.size, 1);
  });

  it("reset clears every entry (session start / switch)", () => {
    const cache = new SessionApprovalCache();
    cache.allowAlways("bash");
    cache.allowAlways("edit");
    cache.reset();
    assert.equal(cache.size, 0);
    assert.equal(cache.isAlwaysAllowed("bash"), false);
  });
});
