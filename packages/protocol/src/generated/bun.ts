// ── rustra generated ────────────────────────────────────────
// File:   bun.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  schema → host entry
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

import { fileURLToPath } from 'node:url';
import { suffix } from 'bun:ffi';
import { createBunBootstrap, createBunEventSubscription } from '@rustra/bun';
import { GENERATED_CONTRACT_HASH, SCHEMA_VERSION } from './contract.js';
import { frameRegistry } from './frame-registry.js';

export * from './commands.js';

const targetDirectory = new URL("../../../../target/", import.meta.url);
const library = `${process.platform === 'win32' ? '' : 'lib'}loop_bridge.${suffix}`;

export const rustra = createBunBootstrap({
  libraryName: "loop_bridge",
  libraryCandidates: [
    fileURLToPath(new URL(`release/${library}`, targetDirectory)),
    fileURLToPath(new URL(`debug/${library}`, targetDirectory)),
  ],
  frameCodecs: frameRegistry,
  contractHash: GENERATED_CONTRACT_HASH,
  contractVerification: 'strict',
  schemaVersion: SCHEMA_VERSION,
});

// 이벤트 브릿지는 부트스트랩과 같은 후보 계산으로 cdylib 을 해상한다
// (libraryName 추론 폴백과 RUSTRA_BUN_LIBRARY 도 동일하게 존중 — 옵션 대칭).
export const events = createBunEventSubscription({
  libraryName: "loop_bridge",
  libraryCandidates: [
    fileURLToPath(new URL(`release/${library}`, targetDirectory)),
    fileURLToPath(new URL(`debug/${library}`, targetDirectory)),
  ],
});
export const subscribeEvent = events.subscribeEvent;
