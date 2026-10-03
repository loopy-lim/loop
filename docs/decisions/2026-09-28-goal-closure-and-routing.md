# Goal closure and worker routing

Loop must expose a durable, per-requirement answer to whether a submitted goal is complete. The answer is based on declared acceptance criteria and check receipts, never on worker prose. A criterion names one task and one or more completion check IDs. The bridge validates those references when the run is prepared and the core derives each criterion's state from the task's verified state and its latest check receipts. A run may report `completed` only when every declared criterion is verified. Legacy runs without a goal contract retain their existing task-level behavior but are shown as `untracked` at the goal level.

The Lead records the user's acceptance criteria before dispatch. Quick runs derive them from their explicit requirements. Later requirements are added through a task and criterion together. A correction delivered to a worker is guidance, not completion evidence. Final review compares the original intent and later corrections with the durable criterion list; if a requirement is absent, it remains an explicit gap requiring a follow-up task and check.

Routing accepts a task's compute bounds, risk, and required capabilities. Rust selects the least costly sufficient candidate. The dispatch receipt states the chosen provider and compute class. High and critical risk must respect the configured floors; a missing sufficient provider asks for attention before starting a worker. Escalation after failed checks stays bounded by the task's attempt budget.

For failed focused checks, providers that can continue the same conversation may repair once on the existing worker session before Loop spends another scheduler attempt. The orchestrator reruns the failed checks and records both receipts. Providers without that capability use the existing bounded retry path. An independently run completion check remains the authority in both cases.

Offline tests use fake providers and commands. Authenticated provider runs and visible Herdr behavior are reported as a separate evidence level.
