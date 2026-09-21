# 오프라인 빌드·설치 파이프라인 증명

- kind: `research`
- attempt: `0`
- date: `2026-09-21` (Asia/Seoul)
- workspace: `/Users/loopy/dev/ll3/loop`
- requested pipeline: `bun run build:cli` → `./dist/loop verify-install`
- result: **PASS**

Source anchors for the receipt contract are `package.json` (`build:cli`),
`packages/cli/src/main.ts:428-477` (`verifyInstall`), and
`packages/cli/test/cli.test.ts:221-228` (the expected JSON receipt).

## Scope and safety boundary

This run used only the local Rust/Bun build and the compiled CLI's fake-provider
acceptance path. No paid model call was made, no real provider credential was
read, and `loop doctor --auth` was not invoked because an authenticated status
check was not needed for this offline proof.

The proof covers creation of the compiled `dist` artifact and execution of the
seven-task offline acceptance scenario. It does not prove a real provider,
credential validity, or a system-wide `loop` installation through
`scripts/install-local.sh`.

## Commands and results

### Build

Command:

```bash
bun run build:cli
```

Exit code: `0`

Complete captured output from the successful rerun:

```text
$ cargo build -p loop-bridge && bun run build:pi && bun build --compile packages/cli/src/main.ts --outfile dist/loop && bun scripts/stage-native.ts
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.03s
$ bun build packages/pi-loop/src/extension.ts --target=node --outfile dist/loop-pi-extension.js
Bundled 374 modules in 11ms

  loop-pi-extension.js  22.20 KB  (entry point)

   [9ms]  bundle  136 modules
  [98ms] compile  dist/loop
```

The build produced/refreshed:

| Artifact | Size | SHA-256 |
| --- | ---: | --- |
| `dist/loop` | 62,606,690 bytes | `c904a7d57a049a71685b11d0a08696fc584aa5080acba06749cbdc8bb4c48f0e` |
| `dist/loop-pi-extension.js` | 22,196 bytes | `dd1b5537e91a1c02dfa05eae08805d5f84133c8e7a5e76d0b8e87695385c257b` |
| `dist/libloop_bridge.dylib` | 12,778,008 bytes | `6331499fb57eb90f71db12561851674260f164a55c6685070b32149290e1c7c2` |

### Compiled CLI acceptance

Command:

```bash
./dist/loop verify-install
```

Exit code: `0`

Complete captured output:

```text
Loop offline acceptance
State: completed
Tasks: 7
Max concurrency: 3
Escalations: 1
```

## Scenario evidence

The compiled command constructs two local `FakeProvider` instances:
`offline-fast` and `offline-strong`. Its seven tasks are:

1. `research-a`
2. `research-b`
3. `research-c`
4. `decision`, dependent on all three research tasks and serialized by its decision kind
5. `impl-a`, dependent on `decision`, write scope `src/a/**`
6. `impl-b`, dependent on `decision`, write scope `src/b/**`
7. `verification`, dependent on both implementation tasks

The receipt proves `tasks: 7`, `maxConcurrent: 3`, and one automatic escalation
from the scripted `impl-b` fast-provider failure to the strong fake provider.
The completion checks are local `true` commands; no model or network request is
part of this acceptance path.

## Evidence limits

This command does not exercise cancellation. The README describes cancellation
alongside the milestone, but `verifyInstall` has no cancellation signal; the
cancellation behavior is covered separately by the orchestrator milestone test
(`packages/orchestrator/test/milestone.test.ts`). It is intentionally not
promoted to this receipt.

The acceptance path is offline in its provider behavior: `FakeProvider` is an
in-process timer-backed implementation (`packages/providers/src/fake.ts`). This
run did not apply an OS-level network block, so dependency resolution performed
by a future clean build could still require the local toolchain/cache or a
network. No authenticated provider command was invoked here.

## Reproduction

```bash
cd /Users/loopy/dev/ll3/loop
bun run build:cli
./dist/loop verify-install
```

## Execution note

The first log-capture wrapper used zsh's read-only `status` variable and exited
with `zsh:3: read-only variable: status` after the build command had run. This
was a wrapper error, not the build result. The pipeline was rerun with a
non-reserved variable name; the commands and exit codes above are from that
successful fresh verification.
