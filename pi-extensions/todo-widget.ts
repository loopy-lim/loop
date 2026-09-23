/**
 * todo-widget.ts — `todo` tool + persistent live widget for the pi coding agent.
 *
 * Based on the pi todo.ts example (state management via session entries),
 * extended with a live widget above the editor:
 *
 * - `todo` tool for the LLM: actions list/add/toggle/clear.
 * - State is stored in tool result details (not external files), so session
 *   branching restores the correct todo state via the reconstructState pattern
 *   over ctx.sessionManager.getBranch().
 * - Persistent widget 'todo-widget' above the editor via ctx.ui.setWidget:
 *   compact header with done/total count, up to 5 pending items highlighted,
 *   completed items collapsed into a single dim summary line. The widget is
 *   removed when the list is empty.
 * - setWidget is called after every mutating tool execute and after
 *   session_start/session_tree reconstruction, so the widget never drifts.
 * - `/todos` command keeps the full-list overlay component from todo.ts.
 * - Loop run visibility (contract with packages/pi-loop): the `loop:run-*`
 *   bus events published by the `loop_run` tool add a distinct "Tasks"
 *   section beneath the todos in the widget and the /todos overlay, so a
 *   running Loop plan stays visible even when the todo list is empty. The
 *   section has its own header (progress count + run id) and task-specific
 *   status glyphs, and is reconstructed from the `loop-run-tasks` custom
 *   session entries on branch scans.
 *
 * Runtime imports: @earendil-works/pi-tui (matchesKey/Text/truncateToWidth) is
 * provided by pi at runtime (virtual modules); @earendil-works/pi-coding-agent
 * is type-only. Tool parameters are a plain JSON Schema object — pi's
 * validateToolArguments coerces and checks schemas that lack the TypeBox Kind
 * symbol, so no typebox import is needed.
 *
 * Install: copy to ~/.pi/agent/extensions/todo-widget.ts
 */

import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { matchesKey, Text, truncateToWidth } from '@earendil-works/pi-tui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Todo {
	id: number;
	text: string;
	done: boolean;
}

type TodoAction = 'list' | 'add' | 'toggle' | 'clear';

/** Shape persisted in every todo tool result, enabling branch-safe reconstruction */
interface TodoDetails {
	action: TodoAction;
	todos: Todo[];
	nextId: number;
	error?: string;
}

interface TodoToolResult {
	content: Array<{ type: 'text'; text: string }>;
	details: TodoDetails;
}

interface TodoToolParams {
	action: TodoAction;
	text?: string;
	id?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max pending items rendered in the live widget */
const MAX_PENDING_LINES = 5;

/** Max task lines rendered in the Tasks section (plus header + overflow) */
const MAX_TASK_LINES = 8;

/** Grapheme clamp for Tasks section lines (matches the repo-wide line limit) */
const MAX_LINE_GRAPHEMES = 160;

/**
 * Plain JSON Schema for the todo tool parameters. pi validates schemas without
 * the TypeBox Kind symbol via its JSON-Schema coercion/check fallback path.
 */
const TodoParams = {
	type: 'object',
	properties: {
		action: {
			type: 'string',
			enum: ['list', 'add', 'toggle', 'clear'],
			description: 'Action to perform',
		},
		text: { type: 'string', description: 'Todo text (for add)' },
		id: { type: 'number', description: 'Todo ID (for toggle)' },
	},
	required: ['action'],
} as const;

// ---------------------------------------------------------------------------
// /todos overlay component (full list, from todo.ts)
// ---------------------------------------------------------------------------

class TodoListComponent {
	private todos: Todo[];
	private loopRun: LoopRunState | undefined;
	private theme: Theme;
	private onClose: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(todos: Todo[], loopRun: LoopRunState | undefined, theme: Theme, onClose: () => void) {
		this.todos = todos;
		this.loopRun = loopRun;
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const th = this.theme;

		lines.push('');
		const title = th.fg('accent', ' Todos ');
		const headerLine =
			th.fg('borderMuted', '─'.repeat(3)) + title + th.fg('borderMuted', '─'.repeat(Math.max(0, width - 10)));
		lines.push(truncateToWidth(headerLine, width));
		lines.push('');

		if (this.todos.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg('dim', 'No todos yet. Ask the agent to add some!')}`, width));
		} else {
			const done = this.todos.filter((t) => t.done).length;
			const total = this.todos.length;
			lines.push(truncateToWidth(`  ${th.fg('muted', `${done}/${total} completed`)}`, width));
			lines.push('');

			for (const todo of this.todos) {
				const check = todo.done ? th.fg('success', '✓') : th.fg('dim', '○');
				const id = th.fg('accent', `#${todo.id}`);
				const text = todo.done ? th.fg('dim', todo.text) : th.fg('text', todo.text);
				lines.push(truncateToWidth(`  ${check} ${id} ${text}`, width));
			}
		}

		if (this.loopRun) {
			lines.push('');
			for (const line of tasksSectionLines(this.loopRun, th)) {
				lines.push(truncateToWidth(`  ${line}`, width));
			}
		}

		lines.push('');
		lines.push(truncateToWidth(`  ${th.fg('dim', 'Press Escape to close')}`, width));
		lines.push('');

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

// ---------------------------------------------------------------------------
// Live widget rendering
// ---------------------------------------------------------------------------

/**
 * Widget lines for the todo list above the editor:
 * - compact header with done/total count
 * - up to MAX_PENDING_LINES pending items, highlighted
 * - completed items collapsed into a single dim summary line
 *
 * Exported for tests; every color goes through theme tokens (see README).
 */
export function widgetLines(todos: Todo[], theme: Theme): string[] {
	const pending = todos.filter((t) => !t.done);
	const doneCount = todos.length - pending.length;
	const lines: string[] = [];

	// Compact header: done/total count
	lines.push(
		theme.fg('accent', theme.bold('todos ')) +
			theme.fg(pending.length > 0 ? 'warning' : 'success', `${doneCount}/${todos.length}`),
	);

	// Pending items, highlighted (capped)
	for (const todo of pending.slice(0, MAX_PENDING_LINES)) {
		lines.push(theme.fg('dim', '○ ') + theme.fg('accent', `#${todo.id} `) + theme.fg('text', todo.text));
	}
	if (pending.length > MAX_PENDING_LINES) {
		lines.push(theme.fg('dim', `  … ${pending.length - MAX_PENDING_LINES} more pending`));
	}

	// Completed items collapsed into a single dim summary line
	if (doneCount > 0) {
		lines.push(theme.fg('dim', `✓ ${doneCount} completed`));
	}
	return lines;
}

// ---------------------------------------------------------------------------
// Tasks section (rendered from the Loop run bus contract; display only)
// ---------------------------------------------------------------------------

/** Bus channels published by the Loop extension's loop_run tool. */
const LOOP_RUN_START = 'loop:run-start';
const LOOP_RUN_PROGRESS = 'loop:run-progress';
const LOOP_RUN_END = 'loop:run-end';

/** Custom session entry the Loop extension writes at run start. */
const LOOP_RUN_ENTRY = 'loop-run-tasks';

interface LoopRunTask {
	id: string;
	title: string;
}

interface LoopRunState {
	runId: string;
	tasks: LoopRunTask[];
	doneIds: string[];
	/** true after loop:run-end — states are final until the next run-start */
	ended: boolean;
}

/**
 * Defensive parse of loop:run-start / loop-run-tasks payloads. Anything
 * malformed is ignored instead of breaking the widget.
 */
function parseLoopRunStart(data: unknown): LoopRunState | undefined {
	if (typeof data !== 'object' || data === null) return undefined;
	const { runId, tasks } = data as { runId?: unknown; tasks?: unknown };
	if (typeof runId !== 'string' || runId.length === 0 || !Array.isArray(tasks)) return undefined;
	const parsed: LoopRunTask[] = [];
	for (const task of tasks) {
		if (typeof task !== 'object' || task === null) continue;
		const { id, title } = task as { id?: unknown; title?: unknown };
		if (typeof id !== 'string' || typeof title !== 'string') continue;
		parsed.push({ id, title });
	}
	return { runId, tasks: parsed, doneIds: [], ended: false };
}

/** Defensive parse of loop:run-progress payloads. */
function parseLoopRunProgress(data: unknown): { runId: string; doneTaskIds: string[] } | undefined {
	if (typeof data !== 'object' || data === null) return undefined;
	const { runId, doneTaskIds } = data as { runId?: unknown; doneTaskIds?: unknown };
	if (typeof runId !== 'string' || !Array.isArray(doneTaskIds)) return undefined;
	return {
		runId,
		doneTaskIds: doneTaskIds.filter((id): id is string => typeof id === 'string'),
	};
}

/** Defensive parse of loop:run-end payloads. */
function parseLoopRunEnd(data: unknown): { runId: string } | undefined {
	if (typeof data !== 'object' || data === null) return undefined;
	const { runId } = data as { runId?: unknown };
	if (typeof runId !== 'string') return undefined;
	return { runId };
}

/**
 * "Tasks" section lines — a sibling section beneath the todos with its own
 * header and checkbox-style glyphs, deliberately distinct from the todos
 * bullet style (`○`/`✓`):
 *
 *   ── Tasks 2/6 a1b2
 *   ▸ impl-b Implement auth   ← running
 *   □ impl-c Implement db     ← pending
 *   ■ research Research       ← done
 *   ✗ impl-x …                ← attention (unfinished once the run ended)
 *
 * The bus contract reports only done task ids, so the "running" glyph is a
 * display-level inference: the first not-done task in plan order. It carries
 * no state and never rounds-trips into the session.
 *
 * Exported for tests; every color goes through theme tokens (see README).
 */
export function tasksSectionLines(run: LoopRunState, theme: Theme): string[] {
	const doneCount = run.tasks.filter((task) => run.doneIds.includes(task.id)).length;
	const allDone = run.tasks.length > 0 && doneCount === run.tasks.length;
	const lines: string[] = [];

	lines.push(
		truncateToWidth(
			theme.fg('borderMuted', '── ') +
				theme.fg('accent', theme.bold('Tasks ')) +
				theme.fg(allDone ? 'success' : 'warning', `${doneCount}/${run.tasks.length}`) +
				theme.fg('dim', ` ${run.runId}${run.ended ? (allDone ? ' · completed' : ' · ended') : ''}`),
			MAX_LINE_GRAPHEMES,
		),
	);

	let runningMarked = false;
	for (const task of run.tasks.slice(0, MAX_TASK_LINES)) {
		const id = theme.fg('accent', `${task.id} `);
		let line: string;
		if (run.doneIds.includes(task.id)) {
			line = theme.fg('success', '■ ') + id + theme.fg('dim', task.title);
		} else if (run.ended) {
			line = theme.fg('error', '✗ ') + id + theme.fg('dim', task.title);
		} else if (!runningMarked) {
			runningMarked = true;
			line = theme.fg('accent', '▸ ') + id + theme.fg('text', task.title);
		} else {
			line = theme.fg('dim', '□ ') + id + theme.fg('text', task.title);
		}
		lines.push(truncateToWidth(line, MAX_LINE_GRAPHEMES));
	}
	if (run.tasks.length > MAX_TASK_LINES) {
		lines.push(theme.fg('dim', `  … ${run.tasks.length - MAX_TASK_LINES} more tasks`));
	}
	return lines;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// In-memory state (reconstructed from session on load)
	let todos: Todo[] = [];
	let nextId = 1;
	/** Loop run section; absent unless the Loop extension announces a run. */
	let loopRun: LoopRunState | undefined;
	/** Latest live context — bus handlers receive no ctx of their own. */
	let latestCtx: ExtensionContext | undefined;

	/**
	 * Reconstruct state from session entries.
	 * Scans tool results for this tool plus loop-run-tasks custom entries in
	 * order, so session branching automatically yields the todo state and the
	 * loop run section of that point in history.
	 */
	const reconstructState = (ctx: ExtensionContext) => {
		todos = [];
		nextId = 1;
		loopRun = undefined;

		for (const entry of ctx.sessionManager.getBranch()) {
			const custom = entry as { type: string; customType?: string; data?: unknown };
			if (custom.type === 'custom' && custom.customType === LOOP_RUN_ENTRY) {
				const restored = parseLoopRunStart(custom.data);
				if (restored) loopRun = restored;
				continue;
			}
			if (entry.type !== 'message') continue;
			const msg = entry.message;
			if (msg.role !== 'toolResult' || msg.toolName !== 'todo') continue;

			const details = msg.details as TodoDetails | undefined;
			if (details) {
				todos = details.todos;
				nextId = details.nextId;
			}
		}
	};

	/** Todos section plus the Tasks section; undefined when there is nothing to show */
	const currentWidgetLines = (theme: Theme): string[] | undefined => {
		const lines = [
			...(todos.length > 0 ? widgetLines(todos, theme) : []),
			...(loopRun ? tasksSectionLines(loopRun, theme) : []),
		];
		return lines.length > 0 ? lines : undefined;
	};

	/** Push the current state to the persistent widget above the editor */
	const syncWidget = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const lines = currentWidgetLines(ctx.ui.theme);
		if (!lines) {
			ctx.ui.setWidget('todo-widget', undefined);
			return;
		}
		ctx.ui.setWidget('todo-widget', lines);
	};

	/**
	 * Bus handlers receive no ctx; reuse the latest session ctx, tolerating
	 * staleness after session replacement (the next session_start resyncs).
	 */
	const syncViaLatestCtx = () => {
		const ctx = latestCtx;
		if (!ctx) return;
		try {
			syncWidget(ctx);
		} catch {
			// Stale ctx — ignored until the next session lifecycle event.
		}
	};

	// Reconstruct state + resync widget on session lifecycle / branch changes
	pi.on('session_start', async (_event, ctx) => {
		latestCtx = ctx;
		reconstructState(ctx);
		syncWidget(ctx);
	});
	pi.on('session_tree', async (_event, ctx) => {
		latestCtx = ctx;
		reconstructState(ctx);
		syncWidget(ctx);
	});

	// --- Loop run visibility (bus contract with packages/pi-loop) -------------
	// Single consumer of the loop:run-* events; the Loop extension is the only
	// publisher. Payloads are parsed defensively, and environments without the
	// Loop extension never receive these events, so behavior is unchanged.
	if (pi.events) {
		pi.events.on(LOOP_RUN_START, (data) => {
			const started = parseLoopRunStart(data);
			if (!started) return;
			loopRun = started;
			syncViaLatestCtx();
		});
		pi.events.on(LOOP_RUN_PROGRESS, (data) => {
			const progress = parseLoopRunProgress(data);
			const current = loopRun;
			if (!progress || progress.doneTaskIds.length === 0) return;
			if (!current || current.runId !== progress.runId || current.ended) return;
			const merged = new Set(current.doneIds);
			for (const id of progress.doneTaskIds) {
				if (current.tasks.some((task) => task.id === id)) merged.add(id);
			}
			loopRun = { ...current, doneIds: [...merged] };
			syncViaLatestCtx();
		});
		pi.events.on(LOOP_RUN_END, (data) => {
			const end = parseLoopRunEnd(data);
			const current = loopRun;
			if (!end || !current || current.runId !== end.runId) return;
			loopRun = { ...current, ended: true };
			syncViaLatestCtx();
		});
	}

	/**
	 * State transition + result in one step, extracted from execute() so the
	 * caller can resync the widget after every mutation.
	 */
	const runAction = (params: TodoToolParams): TodoToolResult => {
		switch (params.action) {
			case 'list':
				return {
					content: [
						{
							type: 'text',
							text: todos.length
								? todos.map((t) => `[${t.done ? 'x' : ' '}] #${t.id}: ${t.text}`).join('\n')
								: 'No todos',
						},
					],
					details: { action: 'list', todos: [...todos], nextId },
				};

			case 'add': {
				if (!params.text) {
					return {
						content: [{ type: 'text', text: 'Error: text required for add' }],
						details: { action: 'add', todos: [...todos], nextId, error: 'text required' },
					};
				}
				const newTodo: Todo = { id: nextId++, text: params.text, done: false };
				todos.push(newTodo);
				return {
					content: [{ type: 'text', text: `Added todo #${newTodo.id}: ${newTodo.text}` }],
					details: { action: 'add', todos: [...todos], nextId },
				};
			}

			case 'toggle': {
				if (params.id === undefined) {
					return {
						content: [{ type: 'text', text: 'Error: id required for toggle' }],
						details: { action: 'toggle', todos: [...todos], nextId, error: 'id required' },
					};
				}
				const todo = todos.find((t) => t.id === params.id);
				if (!todo) {
					return {
						content: [{ type: 'text', text: `Todo #${params.id} not found` }],
						details: { action: 'toggle', todos: [...todos], nextId, error: `#${params.id} not found` },
					};
				}
				todo.done = !todo.done;
				return {
					content: [{ type: 'text', text: `Todo #${todo.id} ${todo.done ? 'completed' : 'uncompleted'}` }],
					details: { action: 'toggle', todos: [...todos], nextId },
				};
			}

			case 'clear': {
				const count = todos.length;
				todos = [];
				nextId = 1;
				return {
					content: [{ type: 'text', text: `Cleared ${count} todos` }],
					details: { action: 'clear', todos: [], nextId: 1 },
				};
			}

			default:
				return {
					content: [{ type: 'text', text: `Unknown action: ${params.action}` }],
					details: { action: 'list', todos: [...todos], nextId, error: `unknown action: ${params.action}` },
				};
		}
	};

	// Register the todo tool for the LLM
	pi.registerTool({
		name: 'todo',
		label: 'Todo',
		description: 'Manage a todo list. Actions: list, add (text), toggle (id), clear',
		parameters: TodoParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as TodoToolParams;
			const result = runAction(p);
			// Keep the live widget in sync after every mutating execute
			if (p.action !== 'list') {
				syncWidget(ctx);
			}
			return result;
		},

		renderCall(args, theme, _context) {
			let text = theme.fg('toolTitle', theme.bold('todo ')) + theme.fg('muted', args.action);
			if (args.text) text += ` ${theme.fg('dim', `"${args.text}"`)}`;
			if (args.id !== undefined) text += ` ${theme.fg('accent', `#${args.id}`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as TodoDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === 'text' ? text.text : '', 0, 0);
			}

			if (details.error) {
				return new Text(theme.fg('error', `Error: ${details.error}`), 0, 0);
			}

			const todoList = details.todos;

			switch (details.action) {
				case 'list': {
					if (todoList.length === 0) {
						return new Text(theme.fg('dim', 'No todos'), 0, 0);
					}
					let listText = theme.fg('muted', `${todoList.length} todo(s):`);
					const display = expanded ? todoList : todoList.slice(0, 5);
					for (const t of display) {
						const check = t.done ? theme.fg('success', '✓') : theme.fg('dim', '○');
						const itemText = t.done ? theme.fg('dim', t.text) : theme.fg('muted', t.text);
						listText += `\n${check} ${theme.fg('accent', `#${t.id}`)} ${itemText}`;
					}
					if (!expanded && todoList.length > 5) {
						listText += `\n${theme.fg('dim', `... ${todoList.length - 5} more`)}`;
					}
					return new Text(listText, 0, 0);
				}

				case 'add': {
					const added = todoList[todoList.length - 1];
					return new Text(
						theme.fg('success', '✓ Added ') +
							theme.fg('accent', `#${added.id}`) +
							' ' +
							theme.fg('muted', added.text),
						0,
						0,
					);
				}

				case 'toggle': {
					const text = result.content[0];
					const msg = text?.type === 'text' ? text.text : '';
					return new Text(theme.fg('success', '✓ ') + theme.fg('muted', msg), 0, 0);
				}

				case 'clear':
					return new Text(theme.fg('success', '✓ ') + theme.fg('muted', 'Cleared all todos'), 0, 0);
			}
		},
	});

	// Register the /todos command for users (full-list overlay)
	pi.registerCommand('todos', {
		description: 'Show all todos on the current branch',
		handler: async (_args, ctx) => {
			if (ctx.mode !== 'tui') {
				ctx.ui.notify('/todos requires interactive mode', 'error');
				return;
			}

			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				return new TodoListComponent(todos, loopRun, theme, () => done());
			});
		},
	});
}
