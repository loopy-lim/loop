export interface LeadTimingReceipt {
  readonly runId: string;
  readonly requestToHandoffMs?: number;
  readonly submissionToHandoffMs?: number;
  readonly requestToResultMs?: number;
  readonly handoffToResultMs?: number;
}

interface RunTimes {
  requestAt?: number;
  submissionAt: number;
  handoffAt?: number;
}

function elapsed(start: number | undefined, end: number): number | undefined {
  if (start === undefined || !Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  const value = end - start;
  return value >= 0 && Number.isFinite(value) ? value : undefined;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)}초`;
}

export function formatHandoffTiming(receipt: LeadTimingReceipt | undefined): string | undefined {
  if (receipt?.requestToHandoffMs !== undefined) return `요청→인계 ${seconds(receipt.requestToHandoffMs)}`;
  if (receipt?.submissionToHandoffMs !== undefined) return `도구→인계 ${seconds(receipt.submissionToHandoffMs)}`;
  return undefined;
}

export function formatFinalTiming(receipt: LeadTimingReceipt | undefined): string | undefined {
  if (receipt?.requestToResultMs !== undefined) return `요청→결과 ${seconds(receipt.requestToResultMs)}`;
  if (receipt?.handoffToResultMs !== undefined) return `인계→결과 ${seconds(receipt.handoffToResultMs)}`;
  return undefined;
}

export class LeadTiming {
  readonly #runs = new Map<string, RunTimes>();
  #pendingTurnAt?: number;

  constructor(private readonly clock: () => number = () => performance.now()) {}

  beginTurn(): void {
    const now = this.clock();
    this.#pendingTurnAt = Number.isFinite(now) ? now : undefined;
  }

  beginSubmission(runId: string): void {
    const now = this.clock();
    const requestAt = this.#pendingTurnAt;
    this.#pendingTurnAt = undefined;
    if (!Number.isFinite(now)) return;
    this.#runs.set(runId, { requestAt, submissionAt: now });
  }

  confirmHandoff(runId: string): LeadTimingReceipt | undefined {
    const times = this.#runs.get(runId);
    if (!times) return undefined;
    if (times.handoffAt === undefined) {
      const now = this.clock();
      if (!Number.isFinite(now)) return undefined;
      times.handoffAt = now;
    }
    return {
      runId,
      requestToHandoffMs: elapsed(times.requestAt, times.handoffAt),
      submissionToHandoffMs: elapsed(times.submissionAt, times.handoffAt),
    };
  }

  finishDisplay(runId: string): LeadTimingReceipt | undefined {
    const times = this.#runs.get(runId);
    this.#runs.delete(runId);
    if (times?.handoffAt === undefined) return undefined;
    const now = this.clock();
    return {
      runId,
      requestToResultMs: elapsed(times.requestAt, now),
      handoffToResultMs: elapsed(times.handoffAt, now),
    };
  }

  forget(runId: string): void {
    this.#runs.delete(runId);
  }
}
