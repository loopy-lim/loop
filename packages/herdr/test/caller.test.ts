import { describe, expect, test } from "bun:test";

import { herdrCallerFromEnvironment } from "../src";

describe("herdrCallerFromEnvironment", () => {
  test("derives the caller from a well-formed HERDR_PANE_ID", () => {
    expect(herdrCallerFromEnvironment({ HERDR_PANE_ID: "ws-lead:p-7" })).toEqual({
      workspaceId: "ws-lead",
      paneId: "ws-lead:p-7",
    });
  });

  test("splits on the first ':' only and keeps the original pane id", () => {
    expect(herdrCallerFromEnvironment({ HERDR_PANE_ID: "ws-1:p:extra" })).toEqual({
      workspaceId: "ws-1",
      paneId: "ws-1:p:extra",
    });
    expect(herdrCallerFromEnvironment({ HERDR_PANE_ID: "ws-1:" })).toEqual({
      workspaceId: "ws-1",
      paneId: "ws-1:",
    });
  });

  test("treats an absent or empty HERDR_PANE_ID as no caller (loop-<runId> fallback)", () => {
    expect(herdrCallerFromEnvironment({})).toBeUndefined();
    expect(herdrCallerFromEnvironment({ HERDR_PANE_ID: "" })).toBeUndefined();
    expect(herdrCallerFromEnvironment({ HERDR_PANE_ID: undefined })).toBeUndefined();
    expect(herdrCallerFromEnvironment({ HERDR_WORKSPACE_ID: "ws-1" })).toBeUndefined();
  });

  test("treats a malformed pane id without a workspace prefix as no caller", () => {
    expect(herdrCallerFromEnvironment({ HERDR_PANE_ID: "bare-pane-id" })).toBeUndefined();
    expect(herdrCallerFromEnvironment({ HERDR_PANE_ID: ":p-1" })).toBeUndefined();
  });
});
