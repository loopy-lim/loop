# Agent quality and nightly continuation — verification

## Delivered

- Pi Lead plans now contain explicit `{tasks, criteria}`. Every requirement must map to its task's check IDs; a quick run provides `acceptance`, and a correction task provides `{task, criteria}`. A plan with multiple implementation tasks needs a downstream integration task that depends on all of them.
- Worker prompts keep the essential task contract ahead of optional receipts. Oversized essential fields fail visibly; large dependency and check output can be truncated without hiding scopes, requirements, checks, or worker instructions.
- `loop benchmark agents` clones one clean Git commit per provider trial and runs identical tasks and criteria in each clone. The report includes goal completion, scope observations, retries, attention, and elapsed time. Actual billing is unmeasured.
- `loop nightly` performs one scan and starts only eligible active runs. Its macOS LaunchAgent is installed for 02:00 local time without `RunAtLoad`. The job skips live ownership, in-flight work, user pause, open attention, and terminal runs; idle completed or stalled graphs receive a settlement pass.

## Evidence

| Gate | Result |
| --- | --- |
| `bun run check` | All Rust, codegen, TypeScript, architecture, and 720 Bun tests passed |
| `bun run test:packaged` | Packaged CLI and Pi extension built; offline 7-task acceptance completed with maximum concurrency 3 and one escalation |
| Agent fixture before work | `bun test tests/normalize.test.ts` failed against the committed starting implementation |
| Live comparison | Commit `6d117c449e49960793ef39c806b9ca8bd56ed887`; Z.AI Flashx fast: 1/1 criteria, 13,915 ms, 1 worker start, 0 check failures, 0 scope observations outside write scope; OpenAI Codex Luna fast: 1/1, 25,031 ms, same remaining counts. Both isolated clones changed only `src/normalize.ts`; independent rerun of the test passed in both. Full report: `/tmp/loop-agent-live.GcFChX/report.json` |
| Installed schedule | `kr.ll3.loop.nightly` bootstrapped; plist lint passed; `StartCalendarInterval` 02:00, `RunAtLoad` absent, service idle after installation |
| Real-store nightly preview | 433 terminal runs excluded; one owned active run and one attention run skipped; zero eligible runs at preview time |
| Scheduled runner smoke | A minimal launchd-like environment resolved Node 22.21.1 and Pi through `fnm exec --using default`; temporary empty SQLite store returned `{"mode":"execute","skippedTerminal":0,"rows":[]}` with no provider call |
| Local Lead delivery | Installed `~/.local/bin/loop-pi-extension.js` matched the built bundle byte for byte at SHA-256 `37b15a589e0c9c9196e5a4961483498f1c696c1e25d417e01bd4d9d3f3a30345`; Node imported and registered it with zero exit in both the current shell and a minimal `fnm` environment |

## Limits

- The live agent comparison is one small task and one trial per provider. The times do not establish a general speed ranking. Provider billing is not measured.
- A machine can verify declared checks and scopes, but it cannot prove that a chosen test expresses every part of the user's intent. The Lead's final review remains responsible for omissions.
- The first scheduled 02:00 run has not happened yet. Registration and the one-shot runner were tested separately.
- The comparison requires a clean committed Git source; uncommitted source is refused so candidates see identical input.
- The existing dirty Loop workspace was preserved. No commit or push was made.
