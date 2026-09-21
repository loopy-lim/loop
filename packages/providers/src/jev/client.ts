interface JevClientOptions {
  endpoint: string;
  fetch?: FetchLike;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface JevDecisionInput<Label extends string> {
  labels: readonly Label[];
  fallback: Label;
  features: Record<string, string | number | boolean>;
  minimumTopScore: number;
  minimumMargin: number;
}

export type JevDecision<Label extends string> = {
  label: Label;
  source: "jev" | "deterministic_fallback";
};

export class JevClient {
  readonly #endpoint: string;
  readonly #fetch: FetchLike;

  constructor(options: JevClientOptions) {
    this.#endpoint = options.endpoint;
    this.#fetch = options.fetch ?? fetch;
  }

  async decide<Label extends string>(
    input: JevDecisionInput<Label>,
  ): Promise<JevDecision<Label>> {
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels: input.labels, features: input.features }),
      });
      if (!response.ok) throw new Error(`Jev HTTP ${response.status}`);
      const payload = await response.json() as { scores?: Record<string, number> };
      const ranked = input.labels
        .map((label) => [label, payload.scores?.[label] ?? 0] as const)
        .sort((left, right) => right[1] - left[1]);
      const [topLabel, topScore] = ranked[0] ?? [input.fallback, 0];
      const secondScore = ranked[1]?.[1] ?? 0;
      if (
        topScore < input.minimumTopScore
        || topScore - secondScore < input.minimumMargin
      ) {
        return { label: input.fallback, source: "deterministic_fallback" };
      }
      return { label: topLabel, source: "jev" };
    } catch {
      return { label: input.fallback, source: "deterministic_fallback" };
    }
  }
}
