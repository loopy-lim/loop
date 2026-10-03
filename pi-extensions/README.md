# pi-extensions

Generic [pi coding-agent](https://github.com/earendil-works/pi-coding-agent) extensions authored in this repo. They are not part of the Loop build (excluded from tsconfig) — they are loaded by pi directly.

## Extensions

| File | What it does |
| --- | --- |
| `persona.ts` | Persona management: `/persona` command, built-in personas, user-defined personas, auto mode, system-prompt injection, footer status, Loop run-start status re-assert |
| `todo-widget.ts` | `todo` tool plus a persistent live widget above the editor (todos + a distinct Tasks section for Loop runs), and a `/todos` overlay |
| `usage.ts` | `/usage` command aggregating LLM spend (dollars + tokens) across all pi sessions, grouped by day, model, and project |
| `session-tap.ts` | Fail-open live pi conversation mirror to the gateway session collector (interactive TUI included) |

## Install locations

- **Runtime (auto-discovery):** `~/.pi/agent/extensions/`
  - `persona.ts`, `todo-widget.ts`, `usage.ts` are installed there. pi picks them up on startup; run `/reload` inside pi to re-load after editing.
- **Source of truth:** `pi-extensions/` in this repo. Edit here, then re-copy:
  ```bash
  cp pi-extensions/persona.ts pi-extensions/todo-widget.ts pi-extensions/usage.ts ~/.pi/agent/extensions/
  ```
- **Session tap registration:** add `"/Users/loopy/dev/ll3/loop/pi-extensions/session-tap.ts"` to the `extensions` array in `~/.pi/agent/settings.json` (or copy `session-tap.ts` to `~/.pi/agent/extensions/`). Restart pi or run `/reload`; pi loads extensions in interactive, RPC, JSON and print modes. The gateway must be running; override its collector path via `LOOP_GATEWAY_SESSION_SOCKET` (or set `LOOP_SESSION_TAP_SOCKET` for the tap only). Missing gateway never blocks pi. Do not configure both auto-discovery and the settings entry for the same tap.
- **User-defined personas:** `~/.pi/agent/personas/*.md` (one Markdown file per persona). Built-in personas live in code; that directory is only for user overrides. These files are **not** installed by this repo — `pi-extensions/personas/*.md` is reference material only.

---

## persona.ts

Manages which persona (role instructions) is injected into the agent's system prompt via the `before_agent_start` hook. The active choice is persisted to the session with `pi.appendEntry` and restored on session reconstruction. Footer status is shown via `ctx.ui.setStatus('persona', ...)`.

### Built-in personas

| Name | Label | Purpose |
| --- | --- | --- |
| `implementer` | 구현자 | Default development persona — implement requirements exactly |
| `reviewer` | 코드 리뷰어 | Change review specialist, with selectable modes (see below) |
| `debugger` | 디버거 | Root-cause tracking via hypothesis → reproduce → verify loop |
| `architect` | 아키텍트 | Design perspective centered on boundaries, dependencies, trade-offs |

### `/persona` usage

```
/persona              # interactive picker
/persona implementer
/persona reviewer              # prompts for a review mode
/persona reviewer security     # apply reviewer in security mode directly
/persona auto                  # pick a starting persona from project signals
/persona off                   # disable persona injection
```

- **Reviewer modes:** `security` · `performance` · `spec` · `readability`. If no mode is given, an interactive selector appears (in non-UI contexts the default mode is applied). An unknown mode is rejected with a warning listing valid options.
- **Auto mode:** inspects the working directory for project signals, in priority order:
  1. `AGENTS.md` present → `architect`
  2. `package.json` present → `implementer`
  3. git repository → `implementer`
- User-defined personas from `~/.pi/agent/personas/*.md` appear alongside built-ins in the picker and completions.
- Turning a persona off clears the footer status entry.

### Loop run-start status re-assert

The Loop extension (see "Loop run event contract" below) publishes `loop:run-start`
whenever a Loop plan starts executing. While a persona is active, persona.ts
listens for that event and, once per run start:

1. re-asserts the footer status via `ctx.ui.setStatus('persona', ...)` — so the
   status is visible at the moment a DAS run begins, not only at session start;
2. emits one `info` notification of the form `🎭 아키텍트 (auto) — Loop 실행 시작`.

With no persona active (off, or auto resolved to none) nothing is notified.
Environments without the Loop extension never receive the event and behave
exactly as before.

---

## todo-widget.ts

### `todo` tool (for the LLM)

Actions:

- `list` — return current todos
- `add` — append an item (`text` required)
- `toggle` — flip an item's done state (`id` required; errors if not found)
- `clear` — remove all items

### Widget behavior

- A live widget is rendered above the editor via `ctx.ui.setWidget('todo-widget', ...)`.
- Shows pending items (capped at 5 lines); completed items are collapsed into a single summary line.
- The widget is refreshed after **every** mutating tool execution, after session reconstruction, and on every `loop:run-*` bus event, so it stays in sync with the session state.
- The widget composes two sibling sections — the todos list and the Tasks
  section for the current Loop run — each with its own header and glyph style.
- When neither section has content, the widget is cleared (`setWidget(key, undefined)`).

### Tasks section (Loop run visibility)

While a Loop plan is executing, the widget (and the `/todos` overlay) shows a
distinct **Tasks** section beneath the todos — even when the todo list is
empty. It has its own header (progress count + run id) and checkbox-style
glyphs that do not reuse the todos bullet style (`○` / `✓`):

```
── Tasks 2/6 loop-a1b2
▸ impl-b Implement auth
□ impl-c Implement db
■ research Research
```

Per-task status glyphs:

- `▸` running — display-level inference: the first not-done task in plan order
  (the bus contract reports only done ids, so this carries no state).
- `□` pending — not done while the run is active.
- `■` done — reported via `loop:run-progress`.
- `✗` attention — unfinished when the run has ended.

Section behavior:

- `loop:run-start` adds/replaces the section with the run's task list.
- `loop:run-progress` marks the reported task ids done (merged, order stable).
- `loop:run-end` freezes the section to its final state: finished tasks ■,
  unfinished tasks ✗, header annotated `· completed` / `· ended`. The section
  stays as a record until the next run-start replaces it.
- On session reconstruction (`/tree`, fork, restart) the section is restored
  from the latest `loop-run-tasks` custom entry on the branch, with all tasks
  pending (progress is event-only and not replayed).
- The section is line-bounded (8 task lines + overflow indicator) and each
  line is clamped to 160 graphemes.

### `/todos` overlay

`/todos` opens an overlay listing all items (pending and completed) with the
current Tasks section beneath it, without touching the tool state.

---

## Loop run event contract (published by packages/pi-loop)

The Loop Lead extension's `loop_run` tool publishes run boundaries on the
pi event bus (`pi.events`). These extensions are the only consumers; they parse
payloads defensively, so additive changes are safe and a missing Loop extension
changes nothing.

| Channel | Payload | When |
| --- | --- | --- |
| `loop:run-start` | `{ runId: string, tasks: Array<{ id, title }> }` | `loop_run` accepted a plan |
| `loop:run-progress` | `{ runId: string, doneTaskIds: string[] }` | every progress snapshot |
| `loop:run-end` | `{ runId: string, status: string }` | run settled (`failed` if the backend threw) |

`loop:run-start` is additionally persisted as a `loop-run-tasks` custom session
entry (`{ runId, tasks }`) so branch scans can restore the run section after
`/tree`, fork, or restart. The channel names are the only coupling between
`pi-extensions/` and the Loop workspace — no imports in either direction.

---

## Colors stay on theme tokens

Every color in these extensions goes through the active theme — raw ANSI
escape sequences and hardcoded hex colors are rejected by a test guard
(`packages/pi-loop/test/ui.test.ts`). Tokens in use:

| Token | Where |
| --- | --- |
| `toolTitle` | tool call titles (`todo add …`) |
| `accent` | headers (`todos`, `Tasks`), item ids, running task glyph (`▸`) |
| `warning` / `success` | header counters — pending>0 ⇒ `warning`, all done ⇒ `success` |
| `dim` | todo bullets, pending task glyph (`□`), completed items, secondary metadata, overflow lines |
| `muted`, `text` | list text / active item text |
| `error` | errors, attention glyph (`✗`) for unfinished Tasks after run end |
| `borderMuted` | `/todos` overlay rule lines, Tasks section header rule |

The persona footer status uses `ctx.ui.setStatus(key, plainText)`, which only
accepts plain text — the `🎭` prefix is the identifying marker, which is why no
color token is applied there.

---

## Provider applicability

Extensions load only inside pi processes. Per worker lane:

| Lane | persona | todo tool | widget / `/todos` | Notes |
| --- | --- | --- | --- | --- |
| Lead (pi + Loop extension) | ✓ | ✓ | ✓ live | `loop:run-*` events fire |
| pi worker (`pi --no-session -p …`, incl. z.ai default line) | ✓ (prompt injection) | ✓ | headless no-op (`ctx.hasUI` guard) | events may fire; UI calls are no-ops |
| codex CLI (`codex exec --json`) | ✗ | ✗ | ✗ | no extension host; role context flows only via TaskSpec requirements |
| antigravity (`agy --print`) | ✗ | ✗ | ✗ | same |
| zai CLI (`zai --prompt`) | ✗ | ✗ | ✗ | same |

Non-pi workers intentionally stay extension-free: personas rely on pi session
entries for persistence, and mirroring todo state into provider CLIs would
duplicate state and break branch-scoped reconstruction.

---

## Key bindings (enter vs shift+enter)

Line breaking and submission are owned by pi's TUI, not by these extensions or
Loop: `enter` submits, `shift+enter` inserts a newline, `ctrl+j` is an alias
newline (pi defaults `tui.input.newLine = shift+enter, ctrl+j`,
`tui.input.submit = enter`). Terminal differences are handled by pi's terminal
setup guide (Terminal.app has a built-in fallback, tmux needs a remap,
VS Code ≥ 1.109.5 works out of the box, WezTerm is configured via its config).
Manual verification per terminal: enter submits immediately, shift+enter inserts
a newline, ctrl+j inserts a newline.

---

## usage.ts

Aggregates LLM spending across **all** pi sessions on the machine by scanning
`~/.pi/agent/sessions/**/*.jsonl`. Works anywhere pi loads extensions — plain
`pi` and Loop Lead sessions alike.

### `/usage` usage

```
/usage        # aggregate everything (same as /usage all)
/usage all    # aggregate everything
/usage 7      # last 7 calendar days, today included
```

### What it shows

- Per-day subtotals (most recent first) with contributing session counts
- Per-model subtotals (cost desc)
- Per-project subtotals (project taken from the session header's `cwd`; falls
  back to decoding the encoded session directory name)
- Grand total: dollars, tokens (input + output + cacheRead + cacheWrite),
  session and file counts

Rendering: a `ctx.ui.custom` overlay in TUI mode (Escape/ctrl+c to close, no
pi-tui import); a compact one-line `ctx.ui.notify` summary in rpc/json/print
modes. Zero-usage entries (error responses) are skipped; malformed JSON lines
are ignored.

---

## Verifying changes

Transpile + API-surface checks (no pi runtime needed):

```bash
bun build pi-extensions/persona.ts --outdir /tmp/pi-check-persona --target bun \
  --external @earendil-works/pi-coding-agent
bun build pi-extensions/todo-widget.ts --outdir /tmp/pi-check-todo --target bun \
  --external @earendil-works/pi-coding-agent --external @earendil-works/pi-tui
bun build pi-extensions/usage.ts --outdir /tmp/pi-check-usage --target bun \
  --external @earendil-works/pi-coding-agent
```

- `persona.js` should retain only Node builtin imports (the `pi` import is type-only and erased).
- `todo-widget.js` must keep the `@earendil-works/pi-tui` import (pi resolves it at runtime) and both `setWidget` calls.

Inside pi, use `/reload` to apply any changes to the installed files without restarting.

## Key namespace (no conflicts)

- Commands: `persona`, `todos`, `usage` — unique.
- Status/widget keys: status `persona` (`setStatus`), widget `todo-widget` (`setWidget`) — distinct keys in distinct namespaces.
- Bus channels: `loop:run-start`, `loop:run-progress`, `loop:run-end` (published by the Loop extension only).
- Custom session entries: `persona-state` (persona.ts), `loop-run-tasks` (packages/pi-loop) — both additive, replay-safe on branch scans.
