/**
 * Showcase/demo launch configuration (task `simulator-showcase`).
 *
 * A dev-only affordance so the app flow can be driven deterministically on
 * the iOS simulator: the launch environment (SIMCTL_CHILD_* vars via
 * `xcrun simctl launch`) is mapped by the AppDelegate to initialProps and
 * interpreted here. Auto-connect/auto-submit invoke the exact same button
 * handlers a human tap would; nothing is persisted — the bearer lives in
 * process memory only (AGENTS.md: do not persist or log credentials).
 *
 * Absent launch env, behavior is unchanged.
 */
export type ShowcaseConfig = {
  /** Prefills the ConnectScreen bearer field (memory only). */
  bearer?: string;
  /** Prefills the ConnectScreen host field (defaults keep the built-in value). */
  host?: string;
  /** Prefills the ConnectScreen port field (defaults keep the built-in value). */
  port?: string;
  /** Prefills the SubmitScreen prompt field. */
  prompt?: string;
  /** Fires the Connect button handler on mount (requires bearer). */
  autoConnect?: boolean;
  /** Fires the Submit button handler after `submitDelayMs`. */
  autoSubmit?: boolean;
  /** Delay before auto-submit fires (default 8000ms). */
  submitDelayMs?: number;
  /** Fires the logout handler — the confirmation dialog's destructive
   * button — after `autoLogoutDelayMs` (one-time login demo: connect, then
   * exercise the same deletion path a human confirms). */
  autoLogout?: boolean;
  /** Delay before auto-logout fires (default 6000ms). */
  autoLogoutDelayMs?: number;
  /** Pane id the RunScreen opens automatically (terminal mirror demo). */
  autoOpenPaneId?: string;
  /** Delay before the auto pane open fires (default 8000ms). */
  autoOpenPaneDelayMs?: number;
  /** Text the ConversationScreen submits as a mid-run steer (v4 demo). */
  autoSteerText?: string;
  /** Delay after "running" before the auto steer fires (default 6000ms). */
  autoSteerDelayMs?: number;
  /** Run id whose chat the app opens right after connect (v4 demo). */
  autoOpenRunId?: string;
  /** Session id the app opens directly right after connect (v8 empty-state
   * demo — same navigation a tap on the uncorrelated sessions row uses). */
  autoOpenSessionId?: string;
  /** Delay after the conversation screen mounts before a scripted scroll-up
   * fires (v8 jump-pill demo): the programmatic scroll drives the SAME
   * onScroll follow machine a human flick drives, so the pill appears
   * through the existing state, not a demo-specific one (C11). */
  autoScrollUpDelayMs?: number;
  /** Prefills the ConversationScreen composer draft (v9 attach demo). */
  composerDraft?: string;
  /** M2 attachment ids whose demo bodies the composer attaches after
   * `attachDelayMs` (v9 attach demo). The scripted attach enters the flow
   * at the SAME continuation the OS photo picker's "picked" outcome feeds
   * (appendPendingAttachment) — the locally generated demo bodies stand in
   * for photo-library picks, which cannot be driven headlessly. */
  attachAssetIds?: string[];
  /** Delay after the conversation mounts before the scripted attach fires
   * (default 3000ms). */
  attachDelayMs?: number;
  /** Delay after the conversation mounts before the scripted Send fires
   * (v9 attach demo — the same submit handler the human send tap invokes,
   * so the upload→input round trip is the production path). Absent: no
   * scripted send. */
  attachSendDelayMs?: number;
  /** Delay after the conversation mounts before the scripted Back fires
   * (session-title capture): the same back handler the human header tap
   * invokes, so the chats list remounts and re-reads the naming evidence
   * the observation accumulated. Absent: no scripted back. */
  autoBackDelayMs?: number;
  /** A `loop://connect?host=&port=` pairing payload delivered by the OS at
   * launch (QR scan / deep link, decision 2026-xx-qr-pairing D-B). The
   * AppDelegate maps the launch URL to this prop — the same continuation the
   * system camera's scan link feeds — and the app parses it, prefills the
   * connect form, and auto-connects through the one connection path. */
  pairingUrl?: string;
};

export function showcaseFromProps(props: unknown): ShowcaseConfig | undefined {
  if (typeof props !== "object" || props === null) return undefined;
  const raw = (props as { showcase?: unknown }).showcase;
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const config: ShowcaseConfig = {};
  if (typeof r.bearer === "string" && r.bearer.length > 0) config.bearer = r.bearer;
  if (typeof r.host === "string" && r.host.length > 0) config.host = r.host;
  if (typeof r.port === "string" && r.port.length > 0) config.port = r.port;
  if (typeof r.prompt === "string") config.prompt = r.prompt;
  if (r.autoConnect === true) config.autoConnect = true;
  if (r.autoSubmit === true) config.autoSubmit = true;
  if (
    typeof r.submitDelayMs === "number" &&
    Number.isFinite(r.submitDelayMs) &&
    r.submitDelayMs >= 0
  ) {
    config.submitDelayMs = r.submitDelayMs;
  }
  if (r.autoLogout === true) config.autoLogout = true;
  if (
    typeof r.autoLogoutDelayMs === "number" &&
    Number.isFinite(r.autoLogoutDelayMs) &&
    r.autoLogoutDelayMs >= 0
  ) {
    config.autoLogoutDelayMs = r.autoLogoutDelayMs;
  }
  if (typeof r.autoOpenPaneId === "string" && r.autoOpenPaneId.length > 0) {
    config.autoOpenPaneId = r.autoOpenPaneId;
  }
  if (
    typeof r.autoOpenPaneDelayMs === "number" &&
    Number.isFinite(r.autoOpenPaneDelayMs) &&
    r.autoOpenPaneDelayMs >= 0
  ) {
    config.autoOpenPaneDelayMs = r.autoOpenPaneDelayMs;
  }
  if (typeof r.autoSteerText === "string" && r.autoSteerText.length > 0)
    config.autoSteerText = r.autoSteerText;
  if (
    typeof r.autoSteerDelayMs === "number" &&
    Number.isFinite(r.autoSteerDelayMs) &&
    r.autoSteerDelayMs >= 0
  ) {
    config.autoSteerDelayMs = r.autoSteerDelayMs;
  }
  if (typeof r.autoOpenRunId === "string" && r.autoOpenRunId.length > 0)
    config.autoOpenRunId = r.autoOpenRunId;
  if (typeof r.autoOpenSessionId === "string" && r.autoOpenSessionId.length > 0) {
    config.autoOpenSessionId = r.autoOpenSessionId;
  }
  if (
    typeof r.autoScrollUpDelayMs === "number" &&
    Number.isFinite(r.autoScrollUpDelayMs) &&
    r.autoScrollUpDelayMs >= 0
  ) {
    config.autoScrollUpDelayMs = r.autoScrollUpDelayMs;
  }
  if (typeof r.composerDraft === "string") config.composerDraft = r.composerDraft;
  if (Array.isArray(r.attachAssetIds)) {
    const ids = r.attachAssetIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    if (ids.length > 0) config.attachAssetIds = ids;
  }
  if (
    typeof r.attachDelayMs === "number" &&
    Number.isFinite(r.attachDelayMs) &&
    r.attachDelayMs >= 0
  ) {
    config.attachDelayMs = r.attachDelayMs;
  }
  if (
    typeof r.attachSendDelayMs === "number" &&
    Number.isFinite(r.attachSendDelayMs) &&
    r.attachSendDelayMs >= 0
  ) {
    config.attachSendDelayMs = r.attachSendDelayMs;
  }
  if (
    typeof r.autoBackDelayMs === "number" &&
    Number.isFinite(r.autoBackDelayMs) &&
    r.autoBackDelayMs >= 0
  ) {
    config.autoBackDelayMs = r.autoBackDelayMs;
  }
  if (typeof r.pairingUrl === "string" && r.pairingUrl.startsWith("loop://")) {
    config.pairingUrl = r.pairingUrl;
  }
  return config;
}
