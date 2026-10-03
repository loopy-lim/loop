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

/** Honest notices (C10): kind-owned phrases, tone chosen at the call site. */
export const WAITING_FOR_INVENTORY_NOTICE =
  "No session observed for this run yet — waiting for the inventory…";
export const RECONNECTING_NOTICE = "reconnecting — replaying recent frames";
export const SESSION_ENDED_NOTICE = "session ended";
/** Stream failures render as a one-line state summary — never a raw
 * transport dump (C10). */
export const STREAM_DISCONNECTED_NOTICE = "stream disconnected — the client keeps retrying";

/** Submit-failure affordance (C10): same submit route, preserved draft. */
export const RESEND_BUTTON_LABEL = "Resend";

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
  "Attach needs an observed session — waiting for the inventory…";

/** Chats-list surface phrases (§7: phrases are owned constants, never
 * composed inline at call sites). Values are display-stable — the section
 * label styles render them uppercase; the copy stays sentence case. */
/** The app title in the status-bar-substitute header (chats home, task
 * `header-statusbar-redesign`). */
export const APP_TITLE = "Loop";
export const CHATS_HEADING = "Chats";
export const SESSIONS_HEADING = "Sessions";
export const REFRESH_LABEL = "Refresh";
export const REFRESHING_LABEL = "loading…";
export const EMPTY_RUNS_NOTICE = "No runs yet — submit a prompt to start one.";

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
 * discovered from the inventory once the tap registers, and every waiting
 * message says so instead of claiming a session that is not observed yet. */
export const SPAWN_TUI_LABEL = "New TUI session";
export const SPAWN_TUI_SPAWNING = "Opening a new pi TUI on the host…";
export const SPAWN_TUI_WAITING = "Window opened — waiting for the session to appear…";
/** `tmuxTarget` is display-only per the spawn contract; naming the target
 * here is exactly the evidence an operator checks in `tmux ls`. */
export const SPAWN_TUI_TIMEOUT_PREFIX =
  "The window opened but no session was observed yet — check the Sessions list (";
export const SPAWN_TUI_TIMEOUT_SUFFIX = ").";
export const SPAWN_TUI_INVENTORY_UNAVAILABLE =
  "Window opened — the session inventory is unavailable, so the session cannot be auto-opened. Check the Sessions list once it recovers.";
export const SPAWN_TUI_BLOCKED =
  "Spawning is turned off on this gateway — ask the operator to enable it.";
export const SPAWN_TUI_FAILED_PREFIX = "Spawn failed — ";
