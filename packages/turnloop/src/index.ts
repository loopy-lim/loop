/**
 * @loop/turnloop — own-turn-loop worker adapter (decision TL1/M-TL0,
 * docs/decisions/2026-xx-own-turn-loop-and-subagent-steering.md).
 *
 * Adapter-layer package: implements the `AgentProvider` contract with an
 * in-process turn loop. Imports only generated `@loop/protocol` types and the
 * reused `@loop/providers` contract/prompt adapter; never imports
 * loop-core/loop-store/loop-bridge, never appends events or reads
 * projections, and never logs credentials.
 */
export * from "./types";
export * from "./context";
export * from "./lanes";
export * from "./engine";
export * from "./fake";
export * from "./provider";
