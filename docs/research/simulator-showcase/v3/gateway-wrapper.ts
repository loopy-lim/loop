/**
 * Showcase v3 demo gateway wrapper (task simulator-showcase-3).
 *
 * OUT-OF-TREE, DEMO-ONLY: runs the UNMODIFIED in-repo gateway
 * (packages/gateway/src/main.ts bootGatewayFromEnv) with runtime workarounds
 * for herdr-0.8.2 defects documented in
 * docs/research/simulator-showcase/v3/evidence.md §5:
 *
 * 1. Reconnect-on-null — herdr 0.8.2 closes the socket after EVERY response;
 *    back-to-back mirror reads hit the dying socket (EPIPE / instant null)
 *    and PaneMirror marks the pane permanently paneGone. On a null result we
 *    tear the socket down and retry (bounded).
 * 2. Inventory debounce — herdr's inventory flickers during session
 *    rearrangement; PaneMirror treats a single missed inventory entry as
 *    permanent paneGone (sticky). Recently seen panes are held in the
 *    reported inventory for a short grace period.
 * 3. Synthesized revisions — herdr 0.8.2 pane.read reports revision 0 even
 *    when the screen buffer changed, so the gateway's revision dedupe never
 *    forwards a second frame (every pane stream freezes after the intro).
 *    We compare consecutive texts per pane and return a monotonic synthetic
 *    revision when the content actually changed.
 * 4. unhandledRejection guard — the SSE pump (server.ts pump/flush) throws
 *    "Controller is already closed" when a client disconnects mid-stream and
 *    the process exits; the guard keeps the demo gateway alive.
 *
 * No repository file is modified. The proper fixes belong to the gateway
 * follow-up task (packages/gateway is outside this task's write scope).
 */

process.on("unhandledRejection", (reason) => {
  console.error("[v3-wrapper] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[v3-wrapper] uncaughtException:", err);
});

const REPO = "/Users/loopy/dev/ll3/loop";

const { HerdrPaneSource } = await import(`${REPO}/packages/gateway/src/herdr-pane-source.ts`);

type Reading = { revision: string; text: string; truncated: boolean };
type Summary = Record<string, unknown> & { paneId: string; _lastSeen?: number };
type Proto = {
  readPane: (paneId: string) => Promise<Reading | null>;
  listPanes: () => Promise<unknown>;
};
const proto = HerdrPaneSource.prototype as unknown as Proto;
const origReadPane = proto.readPane;
const origListPanes = proto.listPanes;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// 3. Synthesized revisions: herdr 0.8.2 pane.read always reports revision 0
// (even pane.list's revision does not track screen-buffer changes for the
// read source), so key the dedupe on CONTENT CHANGE ourselves.
const synth = new Map<string, { lastText: string; revision: bigint }>();

// 1. readPane: reconnect-retry + synthesized content-change revisions.
proto.readPane = async function (paneId: string): Promise<Reading | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const reading = await origReadPane.call(this, paneId);
    if (reading !== null) {
      const state = synth.get(paneId) ?? { lastText: "", revision: 0n };
      if (reading.text !== state.lastText) {
        state.revision += 1n;
        state.lastText = reading.text;
        synth.set(paneId, state);
      }
      return { ...reading, revision: state.revision.toString(10) };
    }
    (this as unknown as { close(): void }).close();
    await sleep(30);
  }
  return null;
};

// 2. listPanes: reconnect-retry + inventory debounce (grace hold).
const GRACE_MS = 2500;
let lastInventory: Summary[] | null = null;
proto.listPanes = async function (): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const inventory = (await origListPanes.call(this)) as Summary[] | null;
    if (inventory !== null) {
      const now = Date.now();
      if (lastInventory !== null) {
        const currentIds = new Set(inventory.map((p) => p.paneId));
        for (const held of lastInventory) {
          const seen = held._lastSeen ?? now;
          if (!currentIds.has(held.paneId) && now - seen < GRACE_MS) {
            inventory.push({ ...held, _lastSeen: now });
          }
        }
      }
      for (const p of inventory) p._lastSeen = now;
      lastInventory = inventory;
      return inventory;
    }
    (this as unknown as { close(): void }).close();
    await sleep(30);
  }
  return null;
};

// Boot the unmodified gateway composition root.
const { PaneMirror } = await import(`${REPO}/packages/gateway/src/pane-mirror.ts`);

// 5. Bounded intro replay: a fresh pane SSE client gets the whole ring buffer
// (512 whole-screen-buffer snapshots ≈ 1-2MB in one burst); the React Native
// XHR transport stalls under that burst. Bound the intro to the LAST frames
// — pane frames are snapshots, so the newest ones are the honest state.
const mirrorProto = PaneMirror.prototype as unknown as {
  observePane: (paneId: string, lastEventId: string | null) => {
    intro: unknown[];
    terminalAfterIntro: boolean;
    listen: (listener: (frame: unknown) => void) => () => void;
  };
};
const origObservePane = mirrorProto.observePane;
const INTRO_BOUND = 3;
mirrorProto.observePane = function (paneId: string, lastEventId: string | null) {
  const observation = origObservePane.call(this, paneId, lastEventId);
  if (lastEventId === null && observation.intro.length > INTRO_BOUND) {
    observation.intro = observation.intro.slice(-INTRO_BOUND);
  }
  return observation;
};

const { bootGatewayFromEnv } = await import(`${REPO}/packages/gateway/src/main.ts`);
const server = await bootGatewayFromEnv();
const shutdown = () => {
  server.abortRuns();
  server.stop();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
console.log(`[v3-wrapper] gateway listening on http://${server.hostname}:${server.port}/v1`);
