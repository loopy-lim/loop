/**
 * Showcase v4 demo gateway wrapper (task simulator-showcase-4).
 *
 * OUT-OF-TREE, DEMO-ONLY (v3 wrapper precedent,
 * docs/research/simulator-showcase/v3/gateway-wrapper.ts): runs the
 * UNMODIFIED in-repo gateway (packages/gateway/src/main.ts
 * bootGatewayFromEnv — including the session collector and the
 * /v1/sessions surface this showcase demonstrates) with ONE runtime
 * workaround:
 *
 * 1. unhandledRejection guard — the SSE pump (server.ts pump/flush) throws
 *    "Controller is already closed" when a client disconnects mid-stream
 *    and the process exits (v3 evidence §5 D-d). Recurred verbatim in v4
 *    prep: the React Native app's transport probe disconnects right after
 *    connect and took the launchd gateway down mid-demo (43rd restart in
 *    service.log). The guard keeps the demo gateway alive.
 *
 * No repository file is modified. The proper fix belongs to the gateway
 * follow-up task (packages/gateway is outside this task's write scope).
 * The pane-mirror workarounds from v3 are NOT needed here (the v4 demo
 * drives no pane streams) and are left out.
 */

process.on("unhandledRejection", (reason) => {
  console.error("[v4-wrapper] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[v4-wrapper] uncaughtException:", err);
});

const REPO = "/Users/loopy/dev/ll3/loop";

const { bootGatewayFromEnv } = await import(`${REPO}/packages/gateway/src/main.ts`);
const server = await bootGatewayFromEnv();
const shutdown = () => {
  // Note: server.stop() self-recurses (main.ts Object.assign wrapper calls
  // server.stop() again — RangeError, noise only), so exit directly.
  server.abortRuns();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
console.log(`[v4-wrapper] gateway listening on http://${server.hostname}:${server.port}/v1`);
