import type { EventOutput } from "@loop/protocol";

export interface GuidanceStatusView {
  sequence: number;
  taskId: string | null;
  state: "recorded" | "delivered" | "checked";
}

export function guidanceStatus(events: EventOutput[], taskId: string): GuidanceStatusView[] {
  const deliveries: Array<{ at: number; through: number }> = [];
  const stableReceipts: number[] = [];
  const verificationPasses: number[] = [];
  const recorded: Array<{ sequence: number; taskId: string | null }> = [];
  for (const event of [...events].sort((left, right) => Number(left.sequence) - Number(right.sequence))) {
    const sequence = Number(event.sequence);
    if (!Number.isSafeInteger(sequence) || sequence <= 0) continue;
    let kind: { type?: string; data?: Record<string, unknown> } | undefined;
    try {
      kind = (JSON.parse(event.payloadJson) as { kind?: typeof kind }).kind;
    } catch { continue; }
    if (kind?.type === "guidance_delivered" && kind.data?.task_id === taskId) {
      const through = Number(kind.data.through_sequence);
      if (Number.isSafeInteger(through)) deliveries.push({ at: sequence, through });
    }
    if (kind?.type === "check_receipts_recorded" && kind.data?.task_id === taskId) {
      const checks = kind.data.checks;
      if (Array.isArray(checks) && checks.length > 0 && checks.every(check => {
        if (!check || typeof check !== "object") return false;
        const source = (check as { source?: { beforeFingerprint?: string; afterFingerprint?: string } }).source;
        return source?.beforeFingerprint && source.beforeFingerprint === source.afterFingerprint;
      })) stableReceipts.push(sequence);
    }
    if (kind?.type === "verification_passed" && kind.data?.task_id === taskId) verificationPasses.push(sequence);
    if (kind?.type !== "guidance_added") continue;
    const target = kind.data?.task_id;
    if (target !== null && target !== taskId) continue;
    recorded.push({ sequence, taskId: target });
  }
  return recorded.sort((left, right) => left.sequence - right.sequence).map(item => {
    const delivery = deliveries.find(candidate => candidate.through >= item.sequence);
    const checked = delivery && delivery.at > item.sequence && stableReceipts.some(receipt => receipt > delivery.at
      && verificationPasses.some(pass => pass > receipt));
    return { sequence: item.sequence, taskId: item.taskId,
      state: checked ? "checked" as const : delivery ? "delivered" as const : "recorded" as const };
  });
}
