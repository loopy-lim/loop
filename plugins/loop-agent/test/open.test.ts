import { describe, expect, test } from "bun:test";

import { openAgentInvocation } from "../src/open";

describe("Open Loop Agent plugin", () => {
  test("runs loop in the invoking pane without creating or attaching a workspace", () => {
    const invocation = openAgentInvocation("w1:p1");
    expect(invocation.command).toBe("herdr");
    expect(invocation.args).toEqual(["pane", "run", "--pane", "w1:p1", "loop"]);
  });

  test("uses argv-only execution (no shell metacharacters)", () => {
    const invocation = openAgentInvocation("w1:p1");
    for (const arg of invocation.args) {
      expect(arg).not.toMatch(/[;&|`$]/);
    }
  });
});
