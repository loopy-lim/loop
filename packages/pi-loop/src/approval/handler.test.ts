import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { APPROVAL_OPTIONS, registerToolApproval } from "./handler";
import { SessionApprovalCache } from "./cache";
import type {
  ApprovalContext,
  ApprovalPiApi,
  ApprovalUi,
  ToolAnnotations,
  ToolCallVerdict,
} from "./types";

type Handler = (event: unknown, context: ApprovalContext) => Promise<ToolCallVerdict>;

interface Harness {
  handlers: Map<string, Handler>;
  call(toolName: string, context?: ApprovalContext): Promise<ToolCallVerdict>;
  startSession(context?: ApprovalContext): Promise<void>;
}

function createPi(
  tools: Array<{ name: string; annotations?: ToolAnnotations }> = [],
): ApprovalPiApi & Harness {
  const handlers = new Map<string, Handler>();
  const api: ApprovalPiApi & Harness = {
    getAllTools: () => tools,
    on(event, handler) {
      handlers.set(event, handler as Handler);
    },
    handlers,
    async call(toolName, context) {
      const handler = handlers.get("tool_call");
      if (!handler) throw new Error("tool_call handler not registered");
      return handler({ toolName }, context ?? {});
    },
    async startSession(context) {
      const handler = handlers.get("session_start");
      if (!handler) throw new Error("session_start handler not registered");
      await handler({}, context ?? {});
    },
  };
  return api;
}

const uiSelect = (choice: string | undefined): ApprovalUi => ({ select: async () => choice });

describe("registerToolApproval", () => {
  it("registers both session_start and tool_call handlers", () => {
    const pi = createPi();
    registerToolApproval(pi);
    assert.deepEqual([...pi.handlers.keys()].sort(), ["session_start", "tool_call"]);
  });

  it("allows annotated read-only tools without prompting", async () => {
    const pi = createPi([{ name: "read", annotations: { readOnlyHint: true } }]);
    let prompted = false;
    registerToolApproval(pi, {
      ui: {
        confirm: async () => {
          prompted = true;
          return false;
        },
      },
    });
    assert.equal(await pi.call("read"), undefined);
    assert.equal(prompted, false);
  });

  it("blocks with block:true and a reason when the user denies via select", async () => {
    const pi = createPi([{ name: "bash", annotations: { destructiveHint: true } }]);
    registerToolApproval(pi, { ui: uiSelect("Deny") });
    assert.deepEqual(await pi.call("bash"), {
      block: true,
      reason: "bash was not approved",
    });
  });

  it("blocks with block:true when no UI is available (non-interactive fail-safe)", async () => {
    const pi = createPi([{ name: "bash", annotations: { destructiveHint: true } }]);
    registerToolApproval(pi);
    assert.deepEqual(await pi.call("bash"), {
      block: true,
      reason: "bash was not approved",
    });
  });

  it("Allow once runs the tool once and asks again on the next call", async () => {
    const pi = createPi([{ name: "bash", annotations: { destructiveHint: true } }]);
    const selections: string[] = [];
    let promptCount = 0;
    registerToolApproval(pi, {
      ui: {
        select: async (_title, options) => {
          promptCount++;
          selections.push(options.join("|"));
          return "Allow once";
        },
      },
    });
    assert.equal(await pi.call("bash"), undefined);
    assert.equal(await pi.call("bash"), undefined);
    assert.equal(promptCount, 2);
    assert.equal(selections[0], APPROVAL_OPTIONS.join("|"));
  });

  it("Always (session) caches the tool and skips later prompts", async () => {
    const pi = createPi([{ name: "bash", annotations: { destructiveHint: true } }]);
    let promptCount = 0;
    registerToolApproval(pi, {
      ui: {
        select: async () => {
          promptCount++;
          return "Always (session)";
        },
      },
    });
    assert.equal(await pi.call("bash"), undefined);
    assert.equal(await pi.call("bash"), undefined);
    assert.equal(promptCount, 1);
  });

  it("Always (session) is scoped to one session: session_start clears the cache", async () => {
    const cache = new SessionApprovalCache();
    const pi = createPi([{ name: "bash", annotations: { destructiveHint: true } }]);
    let promptCount = 0;
    registerToolApproval(pi, {
      cache,
      ui: {
        select: async () => {
          promptCount++;
          return "Always (session)";
        },
      },
    });
    await pi.call("bash");
    await pi.startSession();
    await pi.call("bash");
    assert.equal(promptCount, 2);
  });

  it("falls back to confirm when select is unavailable (true allows once, false denies)", async () => {
    const pi = createPi([{ name: "bash", annotations: { destructiveHint: true } }]);
    registerToolApproval(pi, { ui: { confirm: async () => true } });
    assert.equal(await pi.call("bash"), undefined);

    const denying = createPi([{ name: "bash", annotations: { destructiveHint: true } }]);
    registerToolApproval(denying, { ui: { confirm: async () => false } });
    assert.deepEqual(await denying.call("bash"), {
      block: true,
      reason: "bash was not approved",
    });
  });

  it("cancelled or unknown select answers deny the call", async () => {
    const pi = createPi([{ name: "bash", annotations: { destructiveHint: true } }]);
    registerToolApproval(pi, { ui: uiSelect(undefined) });
    assert.deepEqual(await pi.call("bash"), {
      block: true,
      reason: "bash was not approved",
    });
  });

  it("unannotated tools ask; annotation lookup falls back to getAllTools", async () => {
    const pi = createPi([{ name: "mystery" }]);
    registerToolApproval(pi, { ui: uiSelect("Deny") });
    assert.deepEqual(await pi.call("mystery"), {
      block: true,
      reason: "mystery was not approved",
    });
  });
});
