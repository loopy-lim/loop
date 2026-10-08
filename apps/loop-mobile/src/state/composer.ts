/**
 * Composer routing (decision 2026-xx-gui-conversation D6): a composer submit
 * is a STEER when the observed session is mid-run and run-correlated (the
 * mailbox delivers it at the next turn boundary); otherwise an observed
 * session receives input directly. Only a composer without a session starts
 * a new run. The split is deterministic
 * so the screen stays thin and the contract is spy-testable.
 */

import type { GatewayClient } from "../gateway-client/client";

export type ComposerTarget =
  | { kind: "steer"; runId: string }
  | { kind: "session"; sessionId: string }
  | { kind: "prompt" };

/** Route one composer submit. */
export function composerTarget(input: {
  running: boolean;
  runId: string | null;
  sessionId?: string | null;
}): ComposerTarget {
  if (input.running && input.runId !== null) {
    return { kind: "steer", runId: input.runId };
  }
  if (input.sessionId != null) return { kind: "session", sessionId: input.sessionId };
  return { kind: "prompt" };
}

/**
 * Submit the composer text against the routed target. Returns the accepted
 * run summary for prompt submits (the caller navigates to its conversation)
 * and null for session input or steers (the stream is delivery evidence).
 * None of these non-idempotent paths retries automatically.
 */
export async function submitComposerText(
  client: GatewayClient,
  params: { target: ComposerTarget; text: string },
): Promise<{ runId: string | null }> {
  if (params.target.kind === "steer") {
    await client.steerRun(params.target.runId, params.text);
    return { runId: null };
  }
  if (params.target.kind === "session") {
    await client.submitSessionInput(params.target.sessionId, { text: params.text, attachments: [] });
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
