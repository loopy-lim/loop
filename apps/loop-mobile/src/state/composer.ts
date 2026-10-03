/**
 * Composer routing (decision 2026-xx-gui-conversation D6): a composer submit
 * is a STEER when the observed session is mid-run and run-correlated (the
 * already-implemented mailbox path delivers it at the next turn boundary);
 * otherwise it creates a NEW run through the existing submit surface. Steer
 * input is always allowed while running (D4 §6); the split is deterministic
 * so the screen stays thin and the contract is spy-testable.
 */

import type { GatewayClient } from "../gateway-client/client";

export type ComposerTarget = { kind: "steer"; runId: string } | { kind: "prompt" };

/** Route one composer submit. */
export function composerTarget(input: { running: boolean; runId: string | null }): ComposerTarget {
  if (input.running && input.runId !== null) {
    return { kind: "steer", runId: input.runId };
  }
  return { kind: "prompt" };
}

/**
 * Submit the composer text against the routed target. Returns the accepted
 * run summary for prompt submits (the caller navigates to its conversation)
 * and null for steers (the steer marker in the conversation is the feedback).
 * Neither path retries: submit and steer are both non-idempotent.
 */
export async function submitComposerText(
  client: GatewayClient,
  params: { target: ComposerTarget; text: string },
): Promise<{ runId: string | null }> {
  if (params.target.kind === "steer") {
    await client.steerRun(params.target.runId, params.text);
    return { runId: null };
  }
  const accepted = await client.submitPrompt(params.text);
  return { runId: accepted.run.runId };
}

/**
 * One send attempt — the first press and the Resend button (C10) share
 * this exact path. Success reaches onSuccess (which is where the caller
 * clears the draft); failure reaches onFailure with a client-owned message
 * and the caller's draft survives untouched, so Resend re-submits the
 * same text through the same routed target (steer stays steer while the
 * turn is running).
 */
export async function sendComposerText(
  client: GatewayClient,
  params: {
    target: ComposerTarget;
    text: string;
    onSuccess: (result: { runId: string | null }) => void;
    onFailure: (message: string) => void;
  },
): Promise<void> {
  try {
    const result = await submitComposerText(client, { target: params.target, text: params.text });
    params.onSuccess(result);
  } catch (e: unknown) {
    params.onFailure(e instanceof Error ? e.message : "submit failed");
  }
}
