# Decision: Model Environment Generalization

## Evidence
This decision is based on findings from:
- `docs/research/model-environment-tolerance.md`
- `docs/research/pi-ecosystem-generalization.md`

## Verdict

### 1. Warning-Handling Mechanism
We will handle the pi custom-model warning by implementing **Option 1 (pi `models.json` custom-model merge)**. A generator in the TypeScript adapters will sync Loop's active model profiles from `config/models.toml` into a `~/.pi/agent/models.json` fragment for pi, upserting the missing IDs (like `glm-5.3-flashx`) into the provider catalog.

**Acceptance Criteria:**
- Spawning a pi worker with a custom model ID declared in `models.toml` executes without printing the "Using custom model id" warning and uses correct cost/context metadata.

**Rejected Options:**
- *Option 2 (Loop-layer warning tolerance):* Rejected because it retains noisy warnings and silently inherits wrong model metadata (e.g., inheriting from `glm-5.3`).
- *Option 3 (Rename Loop ids to built-in catalog ids):* Rejected because it destroys Loop's custom compute-class vocabulary and breaks arbitrary provider support.
- *Option 4 (Register a loop provider via the Loop pi extension):* Rejected because it is a large slice requiring complex headless-mode verification, deferred to a later milestone.

### 2. Ecosystem Improvements
We will implement the following two ecosystem improvements NOW, restricted to config and TypeScript adapter changes (no `loop-core` or Rust bridge changes):

**A. Named Lead personas as config-driven instruction layers (Opportunity 2)**
- **Acceptance Criterion:** The pi-loop extension (`packages/pi-loop/src/extension.ts`) successfully composes `leadInstructions` from a named persona file located in `LOOP_CONFIG_DIR`, verified via offline tests.

**B. Portable config roots for multi-machine setups (Opportunity 4)**
- **Acceptance Criterion:** A `loop doctor` check successfully verifies the resolvability of `LOOP_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, and `HERDR_*` environment variables to support relocatable configuration roots.

## Backlog
The remaining ecosystem generalization opportunities are deferred to the backlog:
- **Opportunity 3:** Package Loop commands as an installable pi package.
- **Opportunity 5:** Workflow-profile DAG templates from the wayfinder/implement shape.
- **Opportunity 6:** Session markers for worker and pane observability.
- **Opportunity 7:** Theme-token-aware Loop rendering (presentation personalization).
