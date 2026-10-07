import { expect, test } from "bun:test";
import { receiptsBlockCriteria } from "../packages/orchestrator/src/criteria-self-heal";

test("unknown writer outside task scope does not invalidate stable passing receipt", () => {
  const receipt = {
    id: "check", command: "true", args: [], workingDirectory: ".", exitCode: 0,
    stdout: "", stderr: "", timedOut: false, durationMs: 1,
    source: {
      beforeFingerprint: "stable", afterFingerprint: "stable",
      observedChangedPaths: ["apps/other-session/file.ts"],
      observedOutsideWriteScope: [],
    },
  };
  expect(receiptsBlockCriteria([receipt], ["packages/orchestrator/src/**"])).toBe(false);
  expect(receiptsBlockCriteria([{ ...receipt, source: { ...receipt.source, observedOutsideWriteScope: ["apps/other-session/file.ts"] } }], ["packages/orchestrator/src/**"])).toBe(true);
});
