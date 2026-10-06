/**
 * Copy constants for the conversation surface (decision
 * 2026-xx-codex-detail-checklist C5/C9/C10; ui-ux-guidance §7 — user-facing
 * phrases are owned as constants, never composed inline at call sites).
 */

/** Truncation honesty (C5): the cut is the gateway's bounded-field budget —
 * the app only receives the boolean, so the phrase names the bound's owner,
 * never an invented byte count. */
export const TRUNCATED_NOTICE = "…(truncated — gateway wire budget)";

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
export const WAITING_FOR_PROJECTION_NOTICE = "Waiting for run projection…";
export const NO_PANES_NOTICE = "No terminals are available.";
export const PANE_LOADING_NOTICE = "Loading terminals…";
export const LIFECYCLE_ONLY_SUFFIX = " (lifecycle only)";
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
export const ATTENTION_RESPONSE_PLACEHOLDER = "Your response";
export const SUBMITTING_LABEL = "Submitting…";
export const SUBMIT_RESPONSE_LABEL = "Submit response";
export const TERMINAL_SUFFIX = " (terminal)";

/** Submit-failure affordance (C10): same submit route, preserved draft. */
export const RESEND_BUTTON_LABEL = "Resend";
export const READOUT_STYLE = { letterSpacing: 0.6 } as const;

/** Visible steer affordance (visibility contract): the one-word mark shown
 * above the composer input while the turn is running and sends route to
 * the steer mailbox. The placeholder carries the sentence; this mark stays
 * visible while typing. */
export const STEER_MARK_LABEL = "steer";

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
export const EMPTY_RUNS_NOTICE = "No runs yet — submit a prompt to start one.";

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
/** Quiet default-view empty state: runs exist but none are active — the
 * honest mark (the generic "No runs yet" would be false here). */
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
 * 2026-xx-session-spawn §D-D). Owned phrases — never composed inline at
 * call sites. The honest grammar: the app opens the window; the SESSION is
 * discovered from the session list once the tap registers, and every waiting
 * message says so instead of claiming a session that is not observed yet. */
export const SPAWN_TUI_LABEL = "New TUI session";
export const SPAWN_TUI_SPAWNING = "Opening a new pi TUI on the host…";
export const SPAWN_TUI_WAITING = "Window opened — waiting for the session to appear…";
/** `tmuxTarget` is display-only per the spawn contract; naming the target
 * here is exactly the evidence an operator checks in `tmux ls`. */
export const SPAWN_TUI_TIMEOUT_PREFIX =
  "The window opened but no session was observed yet — check the Sessions list (";
export const SPAWN_TUI_TIMEOUT_SUFFIX = ").";
export const SPAWN_TUI_LIST_UNAVAILABLE =
  "Window opened — the session list is unavailable, so the session cannot be auto-opened. Check the Sessions list once it recovers.";
export const SPAWN_TUI_BLOCKED =
  "Spawning is turned off on this gateway — ask the operator to enable it.";
export const SPAWN_TUI_FAILED_PREFIX = "Spawn failed — ";
