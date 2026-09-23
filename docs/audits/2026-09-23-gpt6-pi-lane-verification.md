# GPT-6 Pi-Lane Verification Audit
Date: 2026-09-23

## Lead-Provided Smoke Evidence
- `pi` version: 0.87.1 (updated from 0.87.0)
- `pi --list-models` catalog refreshed, listing `gpt-6-luna` and `gpt-6-sol` under `openai-codex` (272K ctx, 128K max out).
- Headless smokes passed: 
  - `pi -p --provider openai-codex --model gpt-6-luna` returned `OK-LUNA-PI`.
  - `pi -p --provider openai-codex --model gpt-6-sol` returned `OK-SOL-PI`.

## Verification Result
- Command: `bun run check`
- Result: ❌ Failed (Exit Code 1)

### Exact Failure Output
```
(fail) regression: provisioned patterns resolve exactly instead of pi's custom-model fallback [0.43ms]

278 |     id: "glm-5.3-flash",
279 |   });
280 |   // Every pi pattern declared in models.toml resolves against the merged catalog.
281 |   for (const source of piCatalogSources(document)) {
282 |     const pattern = source.provider === "zai" ? `${source.provider}/${source.id}` : source.id;
283 |     expect(findExactCatalogMatch(pattern, merged)).toBeDefined();
                                                         ^
error: expect(received).toBeDefined()

Received: undefined

      at <anonymous> (/Users/loopy/dev/ll3/loop/packages/providers/test/pi-models-json.test.ts:283:52)

 213 pass
 1 fail
 1021 expect() calls
Ran 214 tests across 32 files. [10.49s]
error: script "test" exited with code 1
error: script "check" exited with code 1
```

## Root Cause
The regression test in `packages/providers/test/pi-models-json.test.ts` fails because it asserts all provisioned `pi` patterns exist in a mocked `zai` catalog. With the addition of `openai-codex` models to the `pi` provider in `models.toml`, this strict mock assertion fails.

## Action Taken
As per the strict write-scope instructions, no code outside this audit file was patched. The regression test remains unpatched.
