# Cross-Field Persona Development Briefing

- **Date:** 2026-09-22
- **Purpose:** Synthesis of the four Loop persona briefings into one cross-field picture of how different kinds of developers actually build software — workflow stages, verification practice, tooling — and what that implies for Loop's workflow profiles (plan-first / spike-first / TDD-first) and for matching Loop's own run traces against them.
- **Inputs:** `indie-hacker.md`, `bigtech-engineer.md`, `datasci-sre.md`, `gamedev-embedded.md` (all in this directory; each with verified sources and per-persona observable patterns).
- **Method:** Each briefing is a synthesis of primary public sources fetched and verified on 2026-09-22 (engineering blogs, SRE books, GDC talks, tooling docs, surveys, HN threads). This document merges their findings; it does not add new sources. Full per-persona source lists live in the four files and in `../persona-benchmark-playbook.md`.

## Scope and method

The four personas were chosen to span the space of development constraints rather than to be representative of job titles: one person with no institutions (indie/solo), thousands of engineers sharing one trunk (big-tech/platform), work whose correctness is unknown until measured (data-science/ML) and work whose failure is a matter of when (SRE), and work whose acceptance criterion is a physical measurement on finite hardware (game/embedded). Each briefing answers the same question — *how does work actually advance from intent to shipped, and what counts as evidence along the way* — so their findings are directly comparable field-by-field.

## The four personas at a glance

| | Indie / solo | Big-tech / platform | Data-science/ML + SRE | Game / embedded |
|---|---|---|---|---|
| Dominant constraint | attention & feedback speed | coordination & blast radius | uncertainty (ML) / risk (SRE) | finite machine & frame |
| Unit of progress | shipped increment a user can touch | small reviewed, revertible change | experiment run / risk-managed change | iteration (game) / build-on-target (embedded) |
| Gate that advances work | deploy + market feedback | code review (+ presubmit) | evaluation gate / error budget | numeric budget met on hardware |
| Failure handling | kill the product, postmortem-lite | blameless postmortem + tracked action items | rollback + postmortem + runbook update | revert to last good capture; replay to reproduce |
| Canonical tooling | monolith, SQLite, Sentry, live dashboards | monorepo, presubmits, Tricorder, flags, canary | notebooks, MLflow/Metaflow, registries, runbooks | profilers, content cookers, build farms, Twister/Renode |

## Cross-field patterns

The patterns below are what survive when the four fields are laid side by side. The first is the top-level finding; the rest are the recurring mechanisms.

1. **Work advances through pre-declared gates, and the persona is the gate.** Every field has an institution that decides when work moves forward; fields differ in where the gate sits, what evidence it demands, and what happens on failure. Indie: the deploy/launch node is the gate, evidence is production metrics and revenue, failure means kill. Big-tech: review is the gate, evidence is reviewer judgment over a small diff, failure is a comment thread. ML/SRE: the evaluation gate is the gate, evidence is a measured metric against a threshold, failure routes back to the notebook. Game/embedded: the budget is the gate, evidence is a physical measurement (frame time, WCET) on real hardware, failure is revert-and-re-measure. The persona is best identified not by its tools but by its gate's position and evidence type.
2. **Verification position is the sharpest differentiator.** Indie verification is late, cheap, and integration-shaped (production is the staging); big-tech verification is interleaved, cheap-first, and hermetic (presubmit small tests before merge, heavy tests continuously); ML verification is a gating diamond (offline metrics, then online A/B, failed gate routes back to exploration); embedded verification is tiered by fidelity (host → simulator → board), where only the last tier is authoritative. In trace terms: where verify nodes sit, how many there are per implementation node, and whether a failure edge exists is enough to distinguish all four.
3. **Budgets are numeric and declared in advance.** The error budget (1 − SLO), the frame budget (16.6 ms), the eval threshold ("accuracy ≥ X"), the appetite (fixed six-week cycles), and pre-declared rollback triggers are the same device: a quantity fixed before execution, spent consciously, with a pre-agreed consequence when exhausted. Numeric budgets are what make gates machine-checkable instead of judgment calls.
4. **Cheap-first funnels; expensive evidence is rationed.** Presubmit-vs-CI, offline-vs-online eval, simulator-vs-board, smoke-vs-soak, canary-vs-full-fleet: every field runs a high-frequency cheap loop and a low-frequency authoritative loop, with each expensive tier gated by (and orders of magnitude rarer than) the tier before it.
5. **Failure produces documents that re-enter the backlog.** Blameless postmortems with tracked action items (big-tech/SRE), runbook updates linked from alerts (SRE), replay recordings and capture artifacts (game), postmortem-lite retrospectives and public kill notes (indie). The loop closes structurally: follow-ups become ordinary tasks in the same planning system as feature work.
6. **Reproducibility via pinned inputs.** Pinned data version + config + seed (ML), pinned toolchain + bit-identical builds (embedded/game), recorded-input replay asserting identical output (game lockstep), hermetic single-process tests (Google's "small" tests). Every field that trusts a result can re-derive it.
7. **Deploy is decoupled from release — except where launch *is* the release.** Feature flags, push tiers, canary analysis, and staged rollouts separate shipping code from exposing users in big-tech and SRE practice. The indie inverts this deliberately: the launch is both deploy and market test, because the audience is the measurement instrument.
8. **Policy lives in tooling, not exhortation.** OWNERS files + Tricorder review bots, the Power of Ten rules + fatal warnings, eval gates inside the pipeline, error-budget policy automation, reproducibility hash checks. Rules that matter are encoded as checks a machine can fail; rules that live in prose get skipped under pressure.

### Workflow stages compared

- **Indie:** idea → build smallest sellable slice → launch publicly → iterate or kill; days-to-weeks per cycle; a shallow graph with no review dependency; killing products is a normalized portfolio stage.
- **Big-tech:** design doc (with alternatives considered) → small CL → review gate → presubmit → trunk → staged rollout with automated rollback; a serialized decision node upstream of all implementation; many small cycles per feature.
- **Data-science/ML:** hypothesis → notebook experiments → evaluation gate → promotion to pipeline/registry → online experiment; SRE: policy (SLO/budget/runbook) → risk-managed change → measured rollout → drill the failure path. Two promotion loops sharing one numeric vocabulary.
- **Game/embedded:** budget sheet → implement → profile/measure loop (hundreds of iterations) → cook content → automated playtest / host tests → hardware-in-the-loop → certified reproducible build. The funnel narrows toward hardware, which is scarce and serialized.

### Verification practices compared

- **Indie:** manual click-through as primary loop; integration tests only for money-touching paths; error trackers and uptime checks as the real post-release suite; public metrics as product verification.
- **Big-tech:** hermetic small/medium/large taxonomy keyed to what tests touch; presubmit runs only fast tiers; flakiness tracked as a defect class; canary-vs-baseline statistical analysis gates promotion.
- **Data-science/ML:** every run recorded and comparable (code + config + data + metrics); promotion gated by numeric thresholds on held-out data; offline improvement explicitly not sufficient; rollback a lookup, not a rebuild.
- **Game/embedded:** the acceptance criterion is a physical measurement on physical hardware against a pre-declared budget; evidence media (video, profiler captures) reviewed after automated gates; determinism enables recorded-input replay; host tests necessary, target tests authoritative.

### Tooling compared

- **Indie:** one runtime, one database, one host; hosted payments/auth/email/analytics; Sentry-class error tracking; public live dashboards.
- **Big-tech:** monorepo and trunk; presubmit + Tricorder static analysis filed as review comments; feature flags; Kayenta-class automated canary analysis; build cops keeping trunk green.
- **Data-science/ML + SRE:** notebooks; experiment trackers (MLflow/Metaflow); model registries with stage transitions; scheduler-run pipelines; SLI/SLO machinery; runbooks linked from alerts; DiRT/chaos drills.
- **Game/embedded:** profilers; engine/content split with automated cookers; build farms; Twister driving real boards via hardware maps; Renode-class simulators; dual-target unit tests (host + chip); reproducible-build toolchains.

## Trace signatures at a glance

If Loop runs the same task under each persona's workflow, the traces should differ like this:

| Persona | Graph shape | Verify nodes | Failure edge |
|---|---|---|---|
| Indie | shallow, serial, template-shaped | one, clustered at the end (deploy/launch carries completion) | kill/cancel at first feedback |
| Big-tech | serialized plan node upstream; many small implement↔review cycles | interleaved, cheap-first, machine-gated | comment/fix loop back to implement |
| Data-science/ML | parallel spikes converging to one promotion node | gating diamond with numeric contract | failed gate routes back to exploration |
| Game/embedded | budget decision upstream; measure→change→re-measure chains; sim tier then hardware tier | measure-and-compare nodes emitting capture artifacts; long off-path soak runs | revert to last good measurement; escalate to hardware tier |

## Implications for Loop workflow profiles

- **Profiles differ mechanically, not philosophically.** The three planned profiles already span the biggest axis: plan-first puts the serialized decision node upstream (big-tech/SRE policy layer), spike-first makes the first artifacts disposable measurements (notebook/profiler capture), TDD-first writes the gate before the implementation (eval gate, embedded dual-target test). The briefings validate all three as real industry shapes, not strawmen.
- **A "budget-first" profile is the strongest fourth candidate** (named in the game/embedded briefing): numeric acceptance thresholds declared before implementation, then implement↔measure until the budget passes. It reuses the error-budget/frame-budget structure every field already trusts.
- **Completion contracts should be numeric predicates wherever possible.** Every field that industrialized its gate converted it to a number; Loop's completion checks should follow, with re-routes (escalate, roll back, re-explore) pre-agreed rather than judged mid-run.
- **Failure edges are part of the profile.** A profile is incomplete until its failed-gate behavior is defined: back to exploration (ML), back to implement (review), roll back and re-measure (game), kill (indie). Traces without failure edges are un-realistic for every persona.
- **Evidence artifacts belong in the trace.** Capture files, eval metrics, replay recordings, review verdicts — the per-persona patterns describe what verification *emits*, not just whether it passed.

## Tensions and caveats

- **Each briefing's patterns describe the modal, documented workflow, not a census.** Public sources over-represent Google-style process, loud indie voices, prescribed MLOps discipline, and GDC-talk-shaped game folklore. The long tails (solo TDD adherents, glue-code ML, unglamorous build farms) are documented in each briefing's caveats.
- **Heavy process is an effect of blast radius, not virtue.** Review gates and staged rollouts exist because thousands share a trunk; applying them wholesale to a one-shot agent run adds latency without risk reduction. Transfer the *structure* (gates, budgets, failure edges), not the headcount.
- **Ground truth is the missing ingredient.** The ML eval gate and the game frame budget assume you can measure "better." For open-ended Loop tasks, gates degrade to proxy checks (tests, static analysis, contract checks); profiles should say which proxy they use.
- **Sub-personas within a pairing pull in opposite directions** (ML speed vs. SRE control; game frame-spending vs. embedded safety-margin). Keep both halves; the benchmark's value is in comparing their trade-offs on the same task, not in averaging them.

## Sources

Full per-persona source lists (all fetched and verified 2026-09-22; one canonical Netflix link serves 403 to scripted fetches but resolves in a browser) are in the four input briefings:

- `indie-hacker.md` — Levels (*MAKE*, 12-startups), DHH (TDD, Majestic Monolith), Basecamp (*Shape Up*), HN threads, Tringas, awesome-indie, SO Survey 2023.
- `bigtech-engineer.md` — Google Code Review Guide, Design Docs at Google, SRE Book (postmortems, on-call, release engineering), Amazon Builders' Library, Meta rapid release, *Software Engineering at Google* Ch. 11, Tricorder, Kayenta.
- `datasci-sre.md` — Google MLOps guide, Netflix notebook scheduling, Metaflow, MLflow, TDSP, Hidden Technical Debt, SRE Book (risk, emergency response), SRE Workbook (SLOs), DiRT, PagerDuty, Wikimedia runbooks, Principles of Chaos.
- `gamedev-embedded.md` — Acton and Llopis data-oriented design, DOOM source, 1500 Archers, Fiedler timestep, Overwatch ECS, Sea of Thieves testing, Unreal Automation/Gauntlet, Zephyr Twister, Renode, ESP-IDF, Grenning, Power of Ten, Reproducible Builds.
