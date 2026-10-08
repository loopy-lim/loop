/**
 * Copy constants for the conversation surface (decision
 * 2026-xx-codex-detail-checklist C5/C9/C10; ui-ux-guidance §7 — user-facing
 * phrases are owned as constants, never composed inline at call sites).
 */

/** Truncation honesty (C5): the phrase states only the fact of the cut —
 * the app only receives the boolean, never an invented reason or byte
 * count (usability audit v9 R-13). */
export const TRUNCATED_NOTICE = "…(truncated)";

/** A closed tool call that produced an empty result (C5-2c) — distinct
 * from a running card that has no result yet (the result area stays hidden). */
export const EMPTY_RESULT_NOTICE = "(no output)";

/** Empty timeline (C9): what is empty + the next action. */
export const EMPTY_TIMELINE_TITLE = "Nothing here yet";
export const EMPTY_TIMELINE_HINT = "Send a prompt below to start the conversation.";

/** Honest notices (C10): kind-owned phrases, tone chosen at the call site.
 * Plain language only — internal vocabulary (inventory, observation) never
 * reaches the user (task `conversation-safearea-fix`). */
export const WAITING_FOR_SESSION_NOTICE =
  "Connecting to this task's session — you can send once it appears.";
export const RECONNECTING_NOTICE = "reconnecting — replaying recent frames";
export const SESSION_ENDED_NOTICE = "session ended";
/** Stream failures render as a one-line state summary — never a raw
 * transport dump (C10). */
export const STREAM_DISCONNECTED_NOTICE = "stream disconnected — the client keeps retrying";
export const WAITING_FOR_PROJECTION_NOTICE = "Getting this task ready…";
export const NO_PANES_NOTICE = "No terminals are available.";
export const PANE_LOADING_NOTICE = "Loading terminals…";
export const LIFECYCLE_ONLY_SUFFIX = " (status only)";
export const EMPTY_DIRECTORY_NOTICE = "Empty directory.";
export const FILES_REPORTS_LABEL = "Files & reports";
export const TERMINALS_HEADING = "Terminals";
/** Run-screen copy (task `redesign-implement`, S-11): the run id is an
 * internal identifier — the screen's heading is the human word; the id
 * rides a quiet caption line for the operator. */
export const RUN_TITLE = "Task";
export const RUN_FINISHED_TITLE = "Task finished";
export const RUN_FAILED_TITLE = "Task failed";
export const RUN_ENDED_TITLE = "Task ended";
export const RUN_SUMMARY_HINT = "Continue this task from its chat in the Chats tab.";
/** Stream-stale honesty (usability audit v9 R-12): the reconnect state
 * rides one owned line — never composed inline at call sites. */
export const RUN_STALE_NOTICE = "reconnecting — recent output may be incomplete";
/** Reply failure (usability audit v9 R-5): the resolve-error surface is a
 * constant — the raw transport message never renders. */
export const RESOLVE_FAILED_NOTICE = "Couldn't send the reply — try again.";
export const ATTENTION_RESPONSE_PLACEHOLDER = "Your response";
/** Progress verb, not the internal act name (usability audit v9 §어휘:
 * "submit" never reaches the surface — every in-flight send reads Sending). */
export const SUBMITTING_LABEL = "Sending…";
/** Attention CTA (usability audit v9 U-5, user-approved): the button names
 * the act — "Reply"; the response word stays in the placeholder. */
export const SUBMIT_RESPONSE_LABEL = "Reply";
export const TERMINAL_SUFFIX = " (terminal)";

/** Submit-failure affordance (C10): same submit route, preserved draft. */
export const RESEND_BUTTON_LABEL = "Resend";
/** Submit failure (usability audit v9 R-6, mechanical part): the failure
 * notice states the fact, the preserved draft, and the next action — the
 * raw transport message never reaches the surface. */
export const SUBMIT_FAILED_NOTICE = "Couldn't send — your draft is kept. Try again.";
export const READOUT_STYLE = { letterSpacing: 0.6 } as const;

/** Visible steer affordance (visibility contract): the one-word mark shown
 * above the composer input while the turn is running and sends route to
 * the steer mailbox. The placeholder carries the sentence; this mark stays
 * visible while typing. Progressive form (usability audit v9 §어휘, DP-U2):
 * the mark names the ongoing act, never the internal routing noun. */
export const STEER_MARK_LABEL = "steering";

/** Run-status display words (usability audit v9 §어휘): the raw status enum
 * (planning/running/attention/…) is an internal vocabulary — the screen
 * renders this closed table instead. planning collapses into Working (the
 * user needs one in-progress word, not the planner's phase). */
export const RUN_STATUS_WORKING = "Working…";
export const RUN_STATUS_NEEDS_REPLY = "Needs your reply";
export const RUN_STATUS_DONE = "Done";
export const RUN_STATUS_FAILED = "Failed";
export const RUN_STATUS_CANCELLED = "Cancelled";

/** Task-count readout units (usability audit v9 §어휘: "1 working · 3 need
 * reply"-class map — pending/attention are internal task-state words).
 * countsText composes numbers with these units; the separator joins them. */
export const COUNTS_QUEUED = "queued";
export const COUNTS_WORKING = "working";
export const COUNTS_NEED_REPLY = "need reply";
export const COUNTS_DONE = "done";
export const COUNTS_FAILED = "failed";
export const COUNTS_CANCELLED = "cancelled";
export const COUNTS_NO_TASKS = "no tasks";
export const COUNTS_SEPARATOR = " · ";

/** Terminal-view honesty notices (terminal mirror v1, decision D6 — moved
 * here from terminalLayout.ts: they are copy, not layout values). Each
 * notice keeps its honesty fact in user language — the mirror is live and
 * NOT a transcript; a status-only/unobserved terminal says why it is quiet;
 * a closed terminal names the closing (usability audit v9 §5: operator
 * vocabulary — snapshot/pane/observation cap/worker — never surfaces). */
export const SNAPSHOT_ORIGIN_NOTICE =
  "Live mirror of the terminal screen — not a full transcript.";
export const LIFECYCLE_ONLY_NOTICE =
  "Status only — this terminal has no live output stream yet.";
export const UNOBSERVED_NOTICE = "No live feed — this terminal is over the watch limit.";
export const PANE_GONE_NOTICE = "Terminal closed — its session ended.";

/** Jump-to-bottom pill (C11). */
export const JUMP_TO_BOTTOM_LABEL = "Jump to latest";

/** Code-block copy control (C2). */
export const COPY_CODE_LABEL = "Copy code";
export const COPIED_CODE_LABEL = "Copied";

/** Composer attachment flow (task `composer-attach-and-highlighting`).
 * Phrases are owned here, never composed inline at call sites (§7). */
export const ATTACH_PHOTO_LABEL = "Add photo";
export const REMOVE_ATTACHMENT_LABEL = "Remove photo";
export const ACTION_PHOTO_LIBRARY_LABEL = "Photo Library";
export const ACTION_CAMERA_LABEL = "Take Photo";
export const ACTION_CANCEL_LABEL = "Cancel";
/** Honest permission-denial phrases: name the fix (Settings), no blame. */
export const CAMERA_DENIED_NOTICE =
  "Camera access is denied — enable it in Settings to attach a photo.";
export const PHOTO_LIBRARY_DENIED_NOTICE =
  "Photo library access is denied — enable it in Settings to attach a photo.";
export const PHOTOS_UNAVAILABLE_NOTICE = "Photo attachments are unavailable on this install.";
export const ATTACH_LIMIT_NOTICE = "At most 8 photos per message.";
export const ATTACH_SESSION_REQUIRED_NOTICE =
  "Attachments need the task's session — still connecting…";

/** Chats-list surface phrases (§7: phrases are owned constants, never
 * composed inline at call sites). Values are display-stable — the section
 * label styles render them uppercase; the copy stays sentence case. */
export const CHATS_HEADING = "Chats";
/** Detail-screen header titles (task `redesign-implement`): the raw-pane
 * and settings surfaces carry their title in the header chrome — the tab
 * destinations keep their labels in the tab bar. */
export const TERMINAL_TITLE = "Terminal";
export const SETTINGS_TITLE = "Settings";
/** Chats-list section labels (task `main-screen-polish`): the list reads
 * as three sections — in-progress work (attention included), what landed
 * today, and everything before. Rendered uppercase by the readout label
 * style; the copy stays sentence case. */
export const ACTIVE_HEADING = "In progress";
export const TODAY_HEADING = "Today";
export const EARLIER_HEADING = "Earlier";
export const EMPTY_RUNS_NOTICE = "No tasks yet — describe one below to start.";
/** List-load failure (usability audit v9 R-7): the error line states the
 * fact and the recovery action — no internal prefix, no raw dump. */
export const RUNS_LIST_ERROR_NOTICE = "Couldn't load the list — pull to retry.";

/** Row swipe action (task `mobile-ux-patterns`, iOS HIG row actions):
 * the one verb the list rows own — the mobile client contract has no
 * cancel/delete surface, so the swipe reveals exactly this and nothing
 * invented. */
export const ROW_OPEN_ACTION_LABEL = "Open";
/** Session-focus toggle (task `session-focus`): the list shows only active
 * work by default; the full inventory exists exclusively behind this
 * explicit toggle, and the toggle is the only way back to the quiet view. */
export const SHOW_ALL_LABEL = "Show all sessions";
export const ACTIVE_ONLY_LABEL = "Active only";
/** Quiet default-view empty state: entries exist but none are active — the
 * honest mark (the generic empty-state notice would be false here). */
export const EMPTY_ACTIVE_NOTICE = "No active loops.";
/** Row-title empty states (task `main-screen-polish`): an entry without
 * an honest name says what is missing — an internal identifier (run id,
 * session id) never fronts a row (brief S-11). "Untitled" names the
 * absence; it does not fabricate a title. */
export const UNTITLED_RUN_LABEL = "Untitled task";
export const UNNAMED_SESSION_LABEL = "Unnamed session";

/** Header-corner logout (task `header-statusbar-redesign`, superseding the
 * list-footer placement): the destructive, low-frequency action is a small
 * icon in the chats header's right corner — the bottom row rode the home-
 * indicator corner, where the rounded screen edges clip it. The icon only
 * OPENS the confirmation alert (mis-tap safe); the destructive button
 * invokes the same App-owned handler the showcase drives. */
export const LOGOUT_LABEL = "Log out";
export const LOGOUT_CONFIRM_TITLE = "Log out?";
export const LOGOUT_CONFIRM_MESSAGE =
  "The saved gateway credential is deleted on this device; the next launch asks you to sign in.";
export const LOGOUT_CONFIRM_CANCEL = "Cancel";

/** Remote spawn surface (task `spawn-app-ui`, decision
 * 2026-xx-session-spawn §D-D; re-aligned to the session-centric IA approved
 * 2026-10-07: the + is the ONLY creation entry and it OPENS A SESSION —
 * every creation phrase says session, never task/run). Owned phrases —
 * never composed inline at call sites. The honest grammar: the app opens
 * the window; the SESSION is discovered from the session list once the tap
 * registers, and every waiting message says so instead of claiming a
 * session that is not observed yet. */
export const SPAWN_TUI_LABEL = "New session";
export const SPAWN_TUI_SPAWNING = "Opening a new session on your computer…";
export const SPAWN_TUI_WAITING = "Window opened — waiting for the session to appear…";
/** `tmuxTarget` is display-only per the spawn contract; naming the target
 * here is exactly the evidence an operator checks in `tmux ls`. */
export const SPAWN_TUI_TIMEOUT_PREFIX =
  "The window opened but no session was observed yet — check the Sessions list (";
export const SPAWN_TUI_TIMEOUT_SUFFIX = ").";
export const SPAWN_TUI_LIST_UNAVAILABLE =
  "Window opened — the session list is unavailable, so the session cannot be auto-opened. Check the Sessions list once it recovers.";
export const SPAWN_TUI_BLOCKED =
  "New sessions are turned off for this connection — ask the owner to enable them.";
export const SPAWN_TUI_FAILED_PREFIX = "Couldn't open a new session — ";

/** Home surfaces (session-centric IA, DP decision 2026-10-07): the home is
 * the OPEN SESSION list; runs and remote submission live behind one explicit
 * history toggle. The remote-submit card keeps its honesty: it sends a task
 * to Loop and does NOT open a terminal session (the wire contract says so
 * before the user commits). Owned phrases — no screen-inline literals. */
export const SESSIONS_VIEW_LABEL = "Sessions";
export const HISTORY_VIEW_LABEL = "Task history";
export const LIVE_SESSIONS_HEADING = "Live sessions";
export const ENDED_SESSIONS_HEADING = "Ended sessions";
export const SESSION_ROW_LIVE_LABEL = "Live";
export const SESSION_ROW_ENDED_LABEL = "Ended";
export const NO_OPEN_SESSIONS_NOTICE = "No open sessions";
/** Quiet group (task `home-cleanup`): sessions whose live feed the gateway
 * lost (tap dropped without a shutdown) are neither live nor honestly
 * ended — they get their own section, never mixed into the ended list.
 * "Quiet" states the observable fact without internal vocabulary (the
 * observation/tap machinery never surfaces). */
export const UNOBSERVED_SESSIONS_HEADING = "Quiet sessions";
export const SESSION_ROW_QUIET_LABEL = "Quiet";
/** Ended-list cap toggle (task `home-cleanup`): the recent window renders
 * by default; the control names the act and carries the hidden count.
 * Numbers compose with owned fragments (the countsText precedent) — the
 * count itself is never an inline literal at the call site. */
export const ENDED_SESSIONS_EXPAND_PREFIX = "Show ";
export const ENDED_SESSIONS_EXPAND_SUFFIX = " older sessions";
export const ENDED_SESSIONS_COLLAPSE_LABEL = "Show recent only";
export const SESSIONS_LIST_ERROR_NOTICE = "Sessions unavailable. Tap to retry.";
export const REMOTE_SUBMIT_NOTICE =
  "Sends a task to Loop — this does not open a terminal session.";
export const REMOTE_PROMPT_PLACEHOLDER = "Describe the task…";
export const REMOTE_SUBMIT_LABEL = "Start task";

/** Conversation header mode toggle (usability audit v9 §어휘): the chip
 * names the DESTINATION — the terminal view (same word as the pane screen
 * title, one vocabulary) or the chat timeline. "Raw" never surfaces. */
export const CHAT_TOGGLE_LABEL = "Chat";

/** Run detail, empty state (Files tab split viewer): the next action names
 * where tasks live now — the history list on the Chats tab. */
export const NO_RUN_OPEN_HINT = "No task open — open one from Task history in Chats.";
