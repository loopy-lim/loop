/**
 * run-sound.ts — pi extension that plays a sound when a Loop run settles.
 *
 * What it does:
 *   Subscribes to the `loop:run-end` bus event published by the Loop Lead
 *   extension (packages/pi-loop) and plays a system sound via `afplay`:
 *
 *   - status `completed` -> success sound (default Glass.aiff)
 *   - anything else (attention/paused/cancelled/failed) -> fail sound
 *     (default Basso.aiff)
 *
 * Sound overrides:
 *   - `LOOP_RUN_SOUND`      path/alias for the success sound
 *   - `LOOP_RUN_SOUND_FAIL` path/alias for the non-success sound
 *   - value `off` (case-insensitive) disables that sound entirely
 *   - values that are not absolute paths are passed to afplay as-is, so
 *     bare names like "Ping" or "Funk" resolve via afplay's sound search
 *
 * Fail-open contract (fail-observer, mirrors session-tap.ts): the extension
 * never throws into pi. Missing Loop extension -> no events -> no sound.
 * A missing audio binary or sound file is swallowed silently. The spawned
 * player is detached (`unref`) with an `error` listener, so it never keeps
 * pi alive nor crashes it via an unhandled 'error' event. pi behavior is
 * unaffected in every mode.
 *
 * Self-contained by design: only node built-ins, no workspace imports —
 * this file is loaded directly by pi from wherever it is installed.
 */

import { spawn } from "node:child_process";

/** Default success sound (macOS system library). */
const DEFAULT_SUCCESS_SOUND = "/System/Library/Sounds/Glass.aiff";
/** Default non-success sound (macOS system library). */
const DEFAULT_FAIL_SOUND = "/System/Library/Sounds/Basso.aiff";

/** The only bus channel this extension consumes. */
const RUN_END_EVENT = "loop:run-end";

/** Defensive parse of loop:run-end payloads: { runId: string, status: string }. */
function parseRunEnd(data: unknown): { runId: string; status: string } | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const { runId, status } = data as { runId?: unknown; status?: unknown };
	if (typeof runId !== "string" || typeof status !== "string") return undefined;
	return { runId, status };
}

/** `off` (any case) disables playback; empty/undefined falls back to default. */
function resolveSound(envValue: string | undefined, fallback: string): string | undefined {
	if (envValue === undefined) return fallback;
	const trimmed = envValue.trim();
	if (trimmed.toLowerCase() === "off") return undefined;
	if (trimmed.length === 0) return fallback;
	return trimmed;
}

/**
 * Fire-and-forget playback. The child is unref'd so it never holds the pi
 * process open; an 'error' listener swallows spawn/ENOENT failures so an
 * unhandled 'error' event can never crash pi.
 */
function playSound(path: string): void {
	try {
		const child = spawn("afplay", [path], { stdio: "ignore" });
		child.on("error", () => {
			/* fail-open: no audio binary / spawn failure is silently dropped */
		});
		child.unref();
	} catch {
		/* fail-open: never throw into pi */
	}
}

export default function runSoundExtension(pi: import("@earendil-works/pi-coding-agent").ExtensionAPI) {
	// Without the event bus (pi builds without it, i.e. no Loop extension)
	// this extension stays silent — exactly like persona.ts / todo-widget.ts.
	if (!pi.events) return;

	pi.events.on(RUN_END_EVENT, (data: unknown) => {
		try {
			const parsed = parseRunEnd(data);
			if (!parsed) return; // defensive: malformed payload -> no sound

			const success = parsed.status === "completed";
			const envValue = success ? process.env.LOOP_RUN_SOUND : process.env.LOOP_RUN_SOUND_FAIL;
			const sound = resolveSound(envValue, success ? DEFAULT_SUCCESS_SOUND : DEFAULT_FAIL_SOUND);
			if (!sound) return; // opted out via `off`
			playSound(sound);
		} catch {
			/* fail-open: never throw into pi */
		}
	});
}
