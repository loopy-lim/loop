/**
 * Herdr HTTP client — the app's entire imperative surface to the gateway's
 * herdr routes (rebuild brief §4). Thin by contract: one method per route,
 * problem errors via GatewayError, no retry policy (streams own reconnect;
 * commands surface errors honestly to the UI).
 *
 * Terminology: the app speaks herdr's own vocabulary — workspaces, tabs,
 * panes, agents — never run/task/attention (rebuild brief §3).
 */

import type { ConnectionConfig } from "../auth/connection";
import { GatewayError, responseError } from "../gateway-client/problem";
import type {
  HerdrAgentStarted,
  HerdrIntegration,
  HerdrPaneReading,
  HerdrState,
  HerdrWorkspaceCreated,
} from "./wire";

/** Minimal injectable fetch (contract tests use it; RN's global otherwise).
 * Structural — not `typeof fetch` — so runtimes with extended fetch types
 * (Bun's `preconnect`) stay assignable. */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Read source whitelist the gateway enforces; the client mirrors it so the
 * UI can only construct legal reads. */
export type HerdrReadSource = "visible" | "recent" | "recent_unwrapped";
export type HerdrReadFormat = "text" | "ansi";

export type HerdrStartRequest = {
  kind: string;
  name?: string | null;
  workspaceId?: string | null;
  tabId?: string | null;
  cwd?: string | null;
  /** true → the gateway creates a fresh workspace and starts there. */
  createWorkspace?: boolean;
};

export class HerdrClient {
  readonly #config: ConnectionConfig;
  readonly #fetchImpl: FetchLike;

  constructor(config: ConnectionConfig, fetchImpl: FetchLike = fetch) {
    this.#config = config;
    this.#fetchImpl = fetchImpl;
  }

  get baseUrl(): string {
    return this.#config.baseUrl;
  }

  async #request(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (this.#config.bearer.length > 0 && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${this.#config.bearer}`);
    }
    if (init?.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return await this.#fetchImpl(`${this.#config.baseUrl}${path}`, { ...init, headers });
  }

  async #json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.#request(path, init);
    if (!response.ok) {
      await responseError(response).then((error) => {
        throw error;
      });
    }
    return (await response.json()) as T;
  }

  async #void(path: string, init?: RequestInit): Promise<void> {
    const response = await this.#request(path, init);
    if (!response.ok && response.status !== 204) {
      await responseError(response).then((error) => {
        throw error;
      });
    }
  }

  /** GET /v1/herdr/state — full state view (also the connect probe). */
  async state(): Promise<HerdrState> {
    return await this.#json<HerdrState>("/v1/herdr/state");
  }

  /** GET /v1/herdr/panes/{paneId}/read. */
  async readPane(
    paneId: string,
    options: { lines?: number; source?: HerdrReadSource; format?: HerdrReadFormat } = {},
  ): Promise<HerdrPaneReading> {
    const params = new URLSearchParams();
    if (options.lines !== undefined) params.set("lines", String(options.lines));
    if (options.source !== undefined) params.set("source", options.source);
    if (options.format !== undefined) params.set("format", options.format);
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return await this.#json<HerdrPaneReading>(
      `/v1/herdr/panes/${encodeURIComponent(paneId)}/read${query}`,
    );
  }

  /** POST /v1/herdr/panes/{paneId}/prompt — deliver text to the agent.
   * 409 agent_blocked is a FIRST-CLASS outcome (the app renders the blocked
   * banner), so it resolves instead of throwing. */
  async prompt(paneId: string, text: string): Promise<{ accepted: true } | { accepted: false; reason: "blocked" | "not_found" | GatewayError }> {
    const response = await this.#request(`/v1/herdr/panes/${encodeURIComponent(paneId)}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    if (response.status === 202) return { accepted: true };
    if (response.status === 409) return { accepted: false, reason: "blocked" };
    if (response.status === 404) return { accepted: false, reason: "not_found" };
    return { accepted: false, reason: await responseError(response) };
  }

  /** POST /v1/herdr/panes/{paneId}/keys — logical keys (esc, ctrl+c, …). */
  async sendKeys(paneId: string, keys: string[]): Promise<void> {
    await this.#void(`/v1/herdr/panes/${encodeURIComponent(paneId)}/keys`, {
      method: "POST",
      body: JSON.stringify({ keys }),
    });
  }

  /** POST /v1/herdr/panes/{paneId}/focus — foreground the pane on the desktop. */
  async focusPane(paneId: string): Promise<void> {
    await this.#void(`/v1/herdr/panes/${encodeURIComponent(paneId)}/focus`, { method: "POST" });
  }

  /** POST /v1/herdr/agents/start. */
  async startAgent(request: HerdrStartRequest): Promise<HerdrAgentStarted> {
    return await this.#json<HerdrAgentStarted>("/v1/herdr/agents/start", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /** POST /v1/herdr/workspaces. */
  async createWorkspace(label?: string | null, cwd?: string | null): Promise<HerdrWorkspaceCreated> {
    return await this.#json<HerdrWorkspaceCreated>("/v1/herdr/workspaces", {
      method: "POST",
      body: JSON.stringify({ label: label ?? null, cwd: cwd ?? null }),
    });
  }

  /** GET /v1/herdr/integrations — installed agent kinds for the picker. */
  async integrations(): Promise<HerdrIntegration[]> {
    const body = await this.#json<{ integrations: HerdrIntegration[] }>("/v1/herdr/integrations");
    return body.integrations;
  }
}
