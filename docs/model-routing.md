# Model routing

Reader: maintainers changing compute policy or model configuration.

| Class | Name | Intended work |
| --- | --- | --- |
| D0 | deterministic | dependencies, tests, overlaps, capacity, liveness |
| D1 | typed decision | constrained Jev judgment with deterministic fallback |
| S1 | tiny | trivial bounded edits or reduction |
| S2 | fast | normal research and localized work |
| S3 | balanced | broader coding and repair |
| S4 | strong | cross-boundary or high-risk reasoning |
| S5 | frontier | exceptional complexity; concurrency-capped |

```text
task requirements
      │
      ├─ deterministic? ──────────────▶ D0
      │
      ▼
capability + risk floor + configured bounds
      │
      ▼
available profiles only
      │
      ▼
lowest sufficient class, then cost + latency
      │ failure / failed verification
      ▼
next class → … → frontier → human attention
```

Risk raises the minimum class: high starts at strong; critical starts at frontier. A task's configured maximum is still enforced.

Model IDs live in `config/models.toml`. Rust core sees opaque compute candidates and compute classes only; provider names remain in the TypeScript composition root. Visible Codex and AGY candidates are launched through Herdr.

Jev is optional. It receives a closed label set and structured features, then must clear both the top-score and top-two-margin thresholds. Network errors, invalid responses, or ambiguous scores select the configured deterministic fallback.

Verification failure increments the attempt and advances one compute class without exceeding the task maximum. Completion checks—not provider confidence—decide success.
