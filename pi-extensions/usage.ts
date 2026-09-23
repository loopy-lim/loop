/**
 * usage.ts — `/usage` command for the pi coding agent: aggregate LLM spend
 * across ALL pi sessions on this machine.
 *
 * Data source (verified against real session files):
 *   ~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl
 *
 * Each line is a JSON entry. Usage-bearing shapes handled (defensively):
 * - `type:"message"` with `message.role === "assistant"` and
 *   `message.usage` = { input, output, cacheRead, cacheWrite, totalTokens,
 *   cost: { input, output, cacheRead, cacheWrite, total } },
 *   model on `message.model`.
 * - `type:"usage"` entries with `usage` at the top level and
 *   `entry.model ?? entry.modelId` (defensive — none exist in current data).
 *
 * Rules baked in:
 * - Token count = input + output + cacheRead + cacheWrite (falls back to
 *   totalTokens when the breakdown is absent) — i.e. explicitly includes
 *   cacheRead, which `totalTokens` alone may exclude.
 * - Project directory comes from the session header entry's `cwd` field
 *   (authoritative). Fallback: decode the parent directory name, which is
 *   the cwd with `/` mapped to `-`, wrapped in dashes
 *   (`/Users/loopy/dev/ll3/loop` → `--Users-loopy-dev-ll3-loop--`).
 * - Zero-usage entries (error responses carry all-zero usage) are skipped.
 *
 * UI:
 * - TUI: `ctx.ui.custom` overlay (plain string rendering) — per-day,
 *   per-model, per-project subtotals plus a grand total. Escape/ctrl+c
 *   closes. No @earendil-works/pi-tui import: keys are matched as raw bytes
 *   and lines are composed as plain text BEFORE theme coloring, so no
 *   ANSI-aware truncation is needed.
 * - Non-TUI (rpc/json/print): compact one-line summary via ctx.ui.notify.
 *
 * Usage: `/usage` or `/usage all` (everything), `/usage 7` (last 7 calendar
 * days including today). Unknown arguments are rejected.
 *
 * Install: copy to ~/.pi/agent/extensions/usage.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, Theme } from '@earendil-works/pi-coding-agent';

// ---------------------------------------------------------------------------
// Types (loose on purpose — session JSON is parsed defensively)
// ---------------------------------------------------------------------------

interface UsageCost {
	input?: unknown;
	output?: unknown;
	cacheRead?: unknown;
	cacheWrite?: unknown;
	total?: unknown;
}

interface UsageStats {
	input?: unknown;
	output?: unknown;
	cacheRead?: unknown;
	cacheWrite?: unknown;
	totalTokens?: unknown;
	cost?: UsageCost;
}

/** Extracted from one usage-bearing session entry */
interface UsageSample {
	timestamp: number;
	model: string;
	cost: number;
	tokens: number;
}

interface Bucket {
	cost: number;
	tokens: number;
}

interface DateBucket extends Bucket {
	/** Session files (by path) that contributed to this date */
	sessions: Set<string>;
}

interface UsageReport {
	/** null = all time, otherwise the day-range argument */
	scope: number | null;
	/** .jsonl files scanned under the sessions root */
	files: number;
	byDate: Map<string, DateBucket>;
	byModel: Map<string, Bucket>;
	byProject: Map<string, Bucket>;
	totalCost: number;
	totalTokens: number;
	/** All session files that contributed at least one sample */
	sessions: Set<string>;
}

// ---------------------------------------------------------------------------
// Session scanning + aggregation (pure data — no UI)
// ---------------------------------------------------------------------------

function sessionsRoot(): string {
	return join(homedir(), '.pi', 'agent', 'sessions');
}

/** `--Users-loopy-dev-ll3-loop--` → `/Users/loopy/dev/ll3/loop` (best effort) */
function decodeProjectDir(name: string): string {
	return name.replace(/^-+|-+$/g, '').replaceAll('-', '/');
}

/**
 * Parse the command argument: '' | 'all' → null (everything),
 * a non-negative integer → day range, anything else → undefined (invalid).
 */
function parseDayFilter(raw: string): number | null | undefined {
	const arg = (raw ?? '').trim().toLowerCase();
	if (arg === '' || arg === 'all') return null;
	if (!/^\d+$/.test(arg)) return undefined;
	const days = Number.parseInt(arg, 10);
	return days <= 0 ? null : days;
}

/** Local midnight of (today - (days-1)) — /usage 7 covers 7 calendar days */
function dayCutoff(days: number): number {
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	return todayStart - (days - 1) * 86_400_000;
}

function localDate(ts: number): string {
	const d = new Date(ts);
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${d.getFullYear()}-${month}-${day}`;
}

function numberOf(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Token count explicitly including cacheRead/cacheWrite (see header) */
function tokensOf(usage: UsageStats): number {
	const sum =
		numberOf(usage.input) + numberOf(usage.output) + numberOf(usage.cacheRead) + numberOf(usage.cacheWrite);
	if (sum > 0) return sum;
	return numberOf(usage.totalTokens);
}

/**
 * Pull usage out of one parsed session entry. Returns null for any shape we
 * don't recognize — callers skip those silently.
 */
function extractUsage(entry: unknown): UsageSample | null {
	if (typeof entry !== 'object' || entry === null) return null;
	const e = entry as Record<string, unknown>;
	const message = e.message as Record<string, unknown> | undefined;

	let usage: unknown;
	let model: unknown;
	if (e.type === 'usage') {
		usage = e.usage;
		model = e.model ?? e.modelId;
	} else if (e.type === 'message' && typeof message === 'object' && message !== null && message.role === 'assistant') {
		usage = message.usage;
		model = message.model;
	} else {
		return null;
	}
	if (typeof usage !== 'object' || usage === null) return null;

	const timestamp = Date.parse(typeof e.timestamp === 'string' ? e.timestamp : '');
	if (!Number.isFinite(timestamp)) return null;

	const stats = usage as UsageStats;
	const cost = numberOf((stats.cost as UsageCost | undefined)?.total);
	const tokens = tokensOf(stats);
	if (cost === 0 && tokens === 0) return null; // all-zero usage on error responses

	return {
		timestamp,
		model: typeof model === 'string' && model ? model : 'unknown',
		cost,
		tokens,
	};
}

/** Authoritative project cwd from the session header entry, if present */
function sessionCwd(lines: string[]): string | null {
	for (const line of lines) {
		if (!line.includes('"type":"session"')) continue;
		try {
			const header = JSON.parse(line) as { cwd?: unknown };
			if (typeof header.cwd === 'string' && header.cwd) return header.cwd;
		} catch {
			// fall through to the decoded directory name
		}
		break; // only the first session header matters
	}
	return null;
}

function addCost(map: Map<string, Bucket>, key: string, cost: number, tokens: number): void {
	const bucket = map.get(key) ?? { cost: 0, tokens: 0 };
	bucket.cost += cost;
	bucket.tokens += tokens;
	map.set(key, bucket);
}

function emptyReport(scope: number | null): UsageReport {
	return {
		scope,
		files: 0,
		byDate: new Map(),
		byModel: new Map(),
		byProject: new Map(),
		totalCost: 0,
		totalTokens: 0,
		sessions: new Set(),
	};
}

/** Scan every session file under the sessions root and aggregate spend */
function aggregateSessions(days: number | null, root: string = sessionsRoot()): UsageReport {
	const report = emptyReport(days);
	const cutoff = days === null ? null : dayCutoff(days);
	if (!existsSync(root)) return report;

	let projectDirs: string[];
	try {
		projectDirs = readdirSync(root);
	} catch {
		return report;
	}

	for (const dirName of projectDirs) {
		const dirPath = join(root, dirName);
		try {
			if (!statSync(dirPath).isDirectory()) continue;
		} catch {
			continue;
		}

		let fileNames: string[];
		try {
			fileNames = readdirSync(dirPath);
		} catch {
			continue;
		}

		const fallbackProject = decodeProjectDir(dirName);
		for (const fileName of fileNames) {
			if (!fileName.endsWith('.jsonl')) continue;
			const filePath = join(dirPath, fileName);

			let text: string;
			try {
				text = readFileSync(filePath, 'utf8');
			} catch {
				continue;
			}
			report.files++;

			const lines = text.split('\n');
			const project = sessionCwd(lines) ?? fallbackProject;

			for (const line of lines) {
				if (!line.includes('"usage"')) continue;
				let entry: unknown;
				try {
					entry = JSON.parse(line);
				} catch {
					continue; // tolerate malformed lines
				}
				const sample = extractUsage(entry);
				if (!sample) continue;
				if (cutoff !== null && sample.timestamp < cutoff) continue;

				const date = localDate(sample.timestamp);
				const dateBucket = report.byDate.get(date) ?? { cost: 0, tokens: 0, sessions: new Set<string>() };
				dateBucket.cost += sample.cost;
				dateBucket.tokens += sample.tokens;
				dateBucket.sessions.add(filePath);
				report.byDate.set(date, dateBucket);

				addCost(report.byModel, sample.model, sample.cost, sample.tokens);
				addCost(report.byProject, project, sample.cost, sample.tokens);

				report.totalCost += sample.cost;
				report.totalTokens += sample.tokens;
				report.sessions.add(filePath);
			}
		}
	}
	return report;
}

// ---------------------------------------------------------------------------
// Formatting helpers (plain text first, color applied last — ANSI-safe widths)
// ---------------------------------------------------------------------------

const fmtMoney = (n: number): string => `$${n.toFixed(4)}`;
const fmtInt = (n: number): string => n.toLocaleString('en-US');

/** Truncate-or-pad plain text to exactly `width` visible columns */
function fit(text: string, width: number): string {
	if (text.length > width) return text.slice(0, Math.max(0, width - 1)) + '…';
	return text + ' '.repeat(width - text.length);
}

function scopeLabel(days: number | null): string {
	return days === null ? 'all time' : `last ${days} day${days === 1 ? '' : 's'}`;
}

/** Sorted keys for a cost map: most expensive first, ties broken by name */
function keysByCost(map: Map<string, Bucket>): string[] {
	return [...map.keys()].sort((a, b) => {
		const diff = (map.get(b)?.cost ?? 0) - (map.get(a)?.cost ?? 0);
		return diff !== 0 ? diff : a.localeCompare(b);
	});
}

// ---------------------------------------------------------------------------
// /usage overlay component (no pi-tui import — structural Component match)
// ---------------------------------------------------------------------------

function overlayLines(report: UsageReport, th: Theme, width: number): string[] {
	type ThemeColor = Parameters<Theme['fg']>[0];
	const lines: string[] = [];
	const section = (label: string): void => {
		lines.push('');
		lines.push(th.fg('dim', fit(`  ${label}`, width)));
	};
	const row = (plain: string, color: ThemeColor): void => {
		lines.push(th.fg(color, fit(plain, width)));
	};

	// Title bar
	const title = ` usage — ${scopeLabel(report.scope)} `;
	const dashes = Math.max(0, width - title.length - 6);
	lines.push(th.fg('borderMuted', '─'.repeat(3)) + th.fg('accent', th.bold(title)) + th.fg('borderMuted', '─'.repeat(dashes)));

	if (report.files === 0 || report.sessions.size === 0) {
		lines.push('');
		row('  No sessions found under ~/.pi/agent/sessions', 'muted');
		lines.push('');
		lines.push(th.fg('dim', fit('  press Escape to close', width)));
		return lines;
	}

	// Per-day subtotals (most recent first)
	section('per day');
	for (const date of [...report.byDate.keys()].sort((a, b) => b.localeCompare(a))) {
		const b = report.byDate.get(date);
		if (!b) continue;
		const count = b.sessions.size;
		row(
			`  ${date}  ${fit(fmtMoney(b.cost), 12)}${fit(fmtInt(b.tokens), 14)} tok  ${count} session${count === 1 ? '' : 's'}`,
			'text',
		);
	}

	// Per-model subtotals
	section('per model');
	for (const model of keysByCost(report.byModel)) {
		const b = report.byModel.get(model);
		if (!b) continue;
		row(`  ${fit(model, 28)}${fit(fmtMoney(b.cost), 12)}${fit(fmtInt(b.tokens), 14)} tok`, 'text');
	}

	// Per-project subtotals (decoded directory)
	section('per project');
	for (const project of keysByCost(report.byProject)) {
		const b = report.byProject.get(project);
		if (!b) continue;
		row(`  ${fit(project, 54)}${fit(fmtMoney(b.cost), 12)}${fit(fmtInt(b.tokens), 14)} tok`, 'muted');
	}

	// Grand total
	lines.push('');
	row(
		`  TOTAL  ${fmtMoney(report.totalCost)}  ${fmtInt(report.totalTokens)} tok  ${report.sessions.size} session${
			report.sessions.size === 1 ? '' : 's'
		} · ${report.files} file${report.files === 1 ? '' : 's'}`,
		'accent',
	);
	if (report.totalCost === 0) {
		row('  No spend recorded for the selected range.', 'muted');
	}
	lines.push('');
	lines.push(th.fg('dim', fit('  press Escape to close', width)));
	return lines;
}

class UsageOverlayComponent {
	private readonly report: UsageReport;
	private readonly theme: Theme;
	private readonly onClose: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(report: UsageReport, theme: Theme, onClose: () => void) {
		this.report = report;
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		// Raw key matching: Escape = 0x1b, ctrl+c = 0x03 (no pi-tui import)
		if (data === '\x1b' || data === '\x03') {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		this.cachedWidth = width;
		this.cachedLines = overlayLines(this.report, this.theme, width);
		return this.cachedLines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

// ---------------------------------------------------------------------------
// Compact plain-text summary for non-TUI modes
// ---------------------------------------------------------------------------

function compactSummary(report: UsageReport): string {
	if (report.files === 0 || report.sessions.size === 0) {
		return 'usage: no sessions found under ~/.pi/agent/sessions';
	}
	const topModel = keysByCost(report.byModel)[0];
	const parts = [
		`usage (${scopeLabel(report.scope)}): ${fmtMoney(report.totalCost)} · ${fmtInt(report.totalTokens)} tok · ${
			report.sessions.size
		} session${report.sessions.size === 1 ? '' : 's'} · ${report.files} file${report.files === 1 ? '' : 's'}`,
	];
	if (topModel) {
		parts.push(`top model ${topModel} ${fmtMoney(report.byModel.get(topModel)?.cost ?? 0)}`);
	}
	return parts.join(' — ');
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.registerCommand('usage', {
		description: 'Show LLM spending across all pi sessions (/usage, /usage 7, /usage all)',

		handler: async (args, ctx) => {
			const days = parseDayFilter(args);
			if (days === undefined) {
				ctx.ui.notify('usage: expected an optional day count — /usage, /usage 7, /usage all', 'error');
				return;
			}

			const report = aggregateSessions(days);

			if (ctx.mode !== 'tui') {
				// rpc/json/print: compact plain-text summary instead of the overlay
				ctx.ui.notify(compactSummary(report), report.files === 0 ? 'warning' : 'info');
				return;
			}

			await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
				return new UsageOverlayComponent(report, theme, () => done());
			});
		},
	});
}
