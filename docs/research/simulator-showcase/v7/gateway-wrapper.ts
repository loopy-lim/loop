/**
 * Showcase v7 gateway wrapper (task showcase-v7; v4 wrapper precedent).
 *
 * OUT-OF-TREE, DEMO-ONLY: runs the UNMODIFIED in-repo gateway
 * (packages/gateway/src/main.ts bootGatewayFromEnv) with the same one
 * runtime workaround the v4 wrapper established:
 *
 * 1. unhandledRejection/uncaughtException guards — the SSE pump can throw
 *    "Controller is already closed" when a client disconnects mid-stream
 *    and take the gateway down mid-demo (v4 evidence §5 D-d). The guards
 *    keep the demo gateway alive; the proper fix belongs to the gateway
 *    follow-up task (packages/gateway is outside this task's write scope).
 *
 * Tokenless evidence (decision 2026-xx-tokenless-auth-and-app-layout §D-A1):
 * this wrapper is started with NO LOOP_GATEWAY_JWT_* and NO
 * LOOP_GATEWAY_AUTH_MODE environment at all — the composition defaults to
 * `authMode: "tailscale"`, and the Tailscale-bound listener accepts
 * unauthenticated requests (the automated curl checks in evidence.md §2
 * prove 200 without a bearer and are the machine-checkable criterion 1).
 * Still deterministic-local provider mode (free, no model calls).
 *
 * Usage:
 *   LOOP_GATEWAY_HOST=100.80.133.120 LOOP_GATEWAY_PORT=18477 \
 *   LOOP_GATEWAY_DATABASE_PATH=~/.loop/gateway/loop.db \
 *   LOOP_GATEWAY_PROJECT_ROOT=/Users/loopy/dev/ll3/loop \
 *   bun docs/research/simulator-showcase/v7/gateway-wrapper.ts
 */

process.on("unhandledRejection", (reason) => {
  console.error("[v7-wrapper] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[v7-wrapper] uncaughtException:", err);
});

const REPO = "/Users/loopy/dev/ll3/loop";

const { bootGatewayFromEnv } = await import(`${REPO}/packages/gateway/src/main.ts`);
const server = await bootGatewayFromEnv();
const shutdown = () => {
  server.abortRuns();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
console.log(`[v7-wrapper] gateway (tokenless tailscale mode) listening on http://${server.hostname}:${server.port}/v1`);
