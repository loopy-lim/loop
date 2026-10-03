/**
 * Public surface of the Loop gateway adapter (ADR §5).
 *
 * Everything exported here is adapter-local: HTTP/SSE framing, the problem
 * envelope, cursors, Tailscale bind checks, and the submission registry.
 * Wire payloads come from `wire.ts` until the Rustra-generated remote types
 * replace them (see wire.ts header).
 */

export * from "./auth";
export * from "./config";
export * from "./cursor";
export * from "./events";
export * from "./files";
export * from "./herdr-pane-source";
export * from "./pane-events";
export * from "./pane-mirror";
export * from "./pane-port";
export * from "./planner";
export * from "./problem";
export * from "./projection";
export * from "./service";
export * from "./session-collector";
export * from "./session-events";
export * from "./spawn";
export * from "./stream";
export * from "./tailscale";
export * from "./wire";
export { startGateway, type GatewayServer, type GatewayServerDeps } from "./server";
