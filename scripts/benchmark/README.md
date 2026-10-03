# Agent comparison fixture

`fixture/` is an independent clean Git repository with a deliberately failing Bun test. Recreate its Git metadata if needed:

```sh
cd scripts/benchmark/fixture
git init
git add src tests
git -c user.name='Loop Fixture' -c user.email='fixture@localhost' commit -m 'test: record failing normalization contract'
bun test tests/normalize.test.ts # expected to fail
```

The manifest candidates `fake:baseline` and `fake:alternative` are registry IDs formed from `[providers.fake]` and the `baseline` / `alternative` model IDs in the isolated `config/benchmark/` config. Its `configDirectory` is resolved relative to the manifest, so the benchmark does not depend on a developer's normal config or alter production routing. An explicit CLI `--config` still overrides the manifest setting. `FakeProvider` starts no process and makes no external calls.

Set `sourceDirectory` in the manifest to the absolute fixture path (it is already set for this checkout), then run the offline smoke:

```sh
bun run build:cli
./dist/loop benchmark agents scripts/benchmark/manifest.json --json --database /tmp/loop-bench-fixture.sqlite
```

This uses only deterministic `FakeProvider` workers; there is no subprocess, credential lookup, or external provider call. Fake workers intentionally do not edit files, so the completion checks can fail: this smoke verifies manifest parsing, candidate resolution, trial creation, and JSON reporting, not agent quality. The JSON still contains each trial's `status`.

For a paid-provider comparison, make a separate manifest copy, replace `candidateIds` with at least two IDs exposed by the enabled provider models in your config (the registry IDs are `<provider>:<model-id>`), and use a clean committed source fixture plus an isolated database. Build/run with `--config <your-config-directory>` if needed:

```sh
bun run build:cli
./dist/loop benchmark agents /path/to/real-manifest.json --json --config /path/to/config --database /tmp/loop-bench-paid.sqlite
```

This can incur charges. Obtain explicit approval first; keep credentials out of manifests and fixtures, use a bounded iteration count, and inspect trial workspaces, diffs, checks, and statuses rather than trusting worker success alone.
