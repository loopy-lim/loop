/**
 * HerdrStore — the ONE owner of app state (rebuild brief §5: 상태는 한 곳).
 *
 * Replaces the old per-screen useState/projection sprawl: connection
 * lifecycle, the SSE subscription, and the last known herdr state live
 * here. Screens read via `useSyncExternalStore` and mutate through the
 * client. Pure derivation helpers (agent/group selectors) are exported for
 * direct unit testing.
 *
 * The store never renders and imports no react-native module — same
 * importable-without-RN contract as the token modules.
 */

import type { ConnectionConfig } from "../auth/connection";
import { HerdrClient, type FetchLike } from "./client";
import { observeHerdrState, type HerdrStreamStatus } from "./stream";
import type { HerdrPane, HerdrState, HerdrWorkspace } from "./wire";

export type HerdrConnectionStatus = "idle" | "connecting" | "live" | "waiting" | "failed";

export type HerdrAppState = {
  connection: {
    host: string | null;
    port: number | null;
    status: HerdrConnectionStatus;
    failure: string | null;
  };
  /** Last known herdr state; null until the first frame arrives. */
  herdr: HerdrState | null;
};

const IDLE_STATE: HerdrAppState = {
  connection: { host: null, port: null, status: "idle", failure: null },
  herdr: null,
};

export class HerdrStore {
  readonly #fetchImpl: FetchLike | undefined;
  #state: HerdrAppState = IDLE_STATE;
  #listeners = new Set<() => void>();
  #controller: AbortController | null = null;
  #client: HerdrClient | null = null;
  /** Sequence guard: a stale stream's callback must never write after a
   * newer connect() replaced it. */
  #generation = 0;

  constructor(options: { fetchImpl?: FetchLike } = {}) {
    this.#fetchImpl = options.fetchImpl;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): HerdrAppState => {
    return this.#state;
  };

  get client(): HerdrClient {
    if (this.#client === null) {
      throw new Error("herdr store is not connected");
    }
    return this.#client;
  }

  get connected(): boolean {
    return this.#client !== null;
  }

  /** Begin observing a gateway. Replaces any previous observation. */
  connect(config: ConnectionConfig): void {
    this.disconnect();
    this.#generation += 1;
    const generation = this.#generation;
    this.#client = new HerdrClient(config, this.#fetchImpl ?? fetch);
    this.#controller = new AbortController();
    const { host, port } = parseHostPort(config.baseUrl);
    this.#patch({
      connection: { host, port, status: "connecting", failure: null },
      herdr: null,
    });
    const options = {
      config,
      signal: this.#controller.signal,
      ...(this.#fetchImpl === undefined ? {} : { fetchImpl: this.#fetchImpl }),
      onState: (herdr: HerdrState) => {
        if (generation !== this.#generation) return;
        this.#patch({ herdr });
      },
      onStatus: (status: HerdrStreamStatus) => {
        if (generation !== this.#generation) return;
        if (status === "live" || status === "connecting" || status === "waiting") {
          const failure = this.#state.connection.failure;
          this.#patch({
            connection: { host, port, status, failure: status === "waiting" ? failure : null },
          });
        }
      },
      onError: (error: Error) => {
        if (generation !== this.#generation) return;
        this.#patch({
          connection: { host, port, status: "failed", failure: error.message },
        });
      },
    };
    void observeHerdrState(options).catch(() => {
      if (generation === this.#generation) {
        this.#patch({
          connection: { host, port, status: "failed", failure: "stream failed" },
        });
      }
    });
  }

  /** Stop observing and drop the client; the app renders the connect gate. */
  disconnect(): void {
    this.#generation += 1;
    this.#controller?.abort();
    this.#controller = null;
    this.#client = null;
    this.#state = IDLE_STATE;
    this.#emit();
  }

  /** One forced pull (pull-to-refresh); returns the fresh state or null. */
  async refresh(): Promise<HerdrState | null> {
    if (this.#client === null) return null;
    try {
      const herdr = await this.#client.state();
      if (herdr.version >= (this.#state.herdr?.version ?? -1)) {
        this.#patch({ herdr });
      }
      return herdr;
    } catch {
      return null;
    }
  }

  #patch(patch: Partial<HerdrAppState>): void {
    this.#state = { ...this.#state, ...patch };
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

function parseHostPort(baseUrl: string): { host: string; port: number } {
  const url = new URL(baseUrl);
  return { host: url.hostname, port: Number.parseInt(url.port, 10) };
}

// ——— pure selectors (unit-tested without react) ———————————————————————————

/** Panes with a detected/managed agent, in stable display order. */
export function agentPanes(state: HerdrState): HerdrPane[] {
  return state.panes
    .filter((pane) => pane.agent !== null)
    .sort(comparePanes);
}

/** All panes of one tab in stable display order. */
export function panesOfTab(state: HerdrState, tabId: string): HerdrPane[] {
  return state.panes.filter((pane) => pane.tabId === tabId).sort(comparePanes);
}

export type HerdrWorkspaceGroup = { workspace: HerdrWorkspace; panes: HerdrPane[] };

/** Agents grouped by their workspace; empty workspaces are omitted. */
export function workspaceGroups(state: HerdrState): HerdrWorkspaceGroup[] {
  const groups: HerdrWorkspaceGroup[] = [];
  const workspaces = [...state.workspaces].sort((a, b) => a.number - b.number);
  for (const workspace of workspaces) {
    const panes = state.panes
      .filter((pane) => pane.workspaceId === workspace.id && pane.agent !== null)
      .sort(comparePanes);
    if (panes.length > 0) groups.push({ workspace, panes });
  }
  return groups;
}

function comparePanes(a: HerdrPane, b: HerdrPane): number {
  if (a.focused !== b.focused) return a.focused ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Display title for a pane row: terminal title → kind label → pane id. */
export function paneDisplayName(pane: HerdrPane, kindLabel: string): string {
  if (pane.title !== null && pane.title.length > 0) return pane.title;
  if (pane.agent !== null) return kindLabel;
  return pane.id;
}
