import { expect, test } from "bun:test";
import { sessionHomeRows } from "../src/state/session-home";

test("home deduplicates session IDs, shows live first and never invents a session for a run", () => {
  const rows = sessionHomeRows([
    { sessionId: "ended", state: "ended", title: null, runId: null, lane: "pi" },
    { sessionId: "live", state: "live", title: "Investigate", runId: "run-1", lane: "pi" },
    { sessionId: "live", state: "live", title: "Duplicate", runId: "run-1", lane: "pi" },
    { sessionId: "solo", state: "live", title: null, runId: null, lane: "pi" },
  ]);
  expect(rows.map((row) => [row.sessionId, row.state, row.title])).toEqual([
    ["live", "live", "Investigate"],
    ["solo", "live", "Unnamed session"],
    ["ended", "ended", "Unnamed session"],
  ]);
  expect(sessionHomeRows([])).toEqual([]);
});
