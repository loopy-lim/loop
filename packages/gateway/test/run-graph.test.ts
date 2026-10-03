import { expect, test } from "bun:test";
import type { RunGraphOutput } from "@loop/protocol";
import { authHeader, bootTestGateway } from "./helpers";

const graph: RunGraphOutput = {
  runId: "run-1",
  state: "active",
  lastSequence: "7",
  ownerHealth: "missing",
  openAttentionCount: 0,
  nodes: [
    {
      id: "research",
      title: "Research",
      kind: "research",
      state: "running",
      dependencies: [],
      blockedBy: [],
      readScope: ["src"],
      writeScope: [],
      workers: ["worker-1"],
      attempt: 1,
      resultSummary: null,
      lastFailure: null,
    },
  ],
};

test("graph endpoint returns the Rust-owned read model behind gateway auth", async () => {
  const gateway = bootTestGateway({
    graph: {
      async get() {
        return graph;
      },
    },
  });
  try {
    const path = `${gateway.baseUrl}/v1/runs/run-1/graph`;
    expect((await fetch(path)).status).toBe(401);
    const response = await fetch(path, { headers: authHeader(gateway.token()) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(graph);
  } finally {
    gateway.stop();
  }
});
