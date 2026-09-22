# Persona Research Playbook: Re-running the Persona Study as a Loop DAG

- **Date:** 2026-09-22
- **Purpose:** Exact recipe for re-running (or extending) the persona research that produced the four briefings in `personas/` and the synthesis in `personas/persona-development-briefing.md`. Documents the DAG shape, per-persona source lists and research prompts, merge steps, output locations, and completion checks.
- **Status:** Provenance record for attempt 0 and operating procedure for future attempts. All steps below are deterministic; the only model usage is inside the two research worker kinds, and no step requires a paid model call to verify.

## DAG shape

```text
persona-research-indie ─┐
persona-research-bigtech ├─(parallel, independent)─► persona-briefing (merge + synthesis)
persona-research-datasci-sre │
persona-research-gamedev ─┘
```

- **Fan-out stage:** four independent research workers, one per persona. They run in parallel; none reads another's output. Each writes exactly one file under `docs/research/personas/`.
- **Merge stage:** one integration worker reads all four briefings and writes the cross-field synthesis. It must run after all four fan-out nodes complete (dependency: `persona-research-*` → `persona-briefing`).
- **Optional extension nodes:** a fifth persona slots in as one more parallel fan-out node plus a one-line addition to the merge worker's input list (see "Extending the study").

## Where outputs land

| Output | Path |
|---|---|
| Indie/solo briefing | `docs/research/personas/indie-hacker.md` |
| Big-tech/platform briefing | `docs/research/personas/bigtech-engineer.md` |
| Data-science/ML + SRE briefing | `docs/research/personas/datasci-sre.md` |
| Game/embedded briefing | `docs/research/personas/gamedev-embedded.md` |
| Cross-field synthesis | `docs/research/personas/persona-development-briefing.md` |
| This playbook | `docs/research/persona-benchmark-playbook.md` |

Read scope for the merge node: `docs/research/personas/**`. Nothing in this study writes outside `docs/research/`; no Rust, store, bridge, or adapter code is touched.

## Fan-out node template (per persona)

Each fan-out node gets: (a) a persona angle (below), (b) its source list (below), (c) the common output contract (below).

### Common research prompt (fill the two placeholders)

```text
Research how {PERSONA} actually build software — not how methodology literature
says they should. Cover, each as its own section: (1) stack and tooling choices,
(2) end-to-end workflow stages from intent to shipped work, (3) verification
practice (what counts as evidence, where it sits in the workflow), (4) release
cadence and rollout mechanics, (5) failure handling at both the incident and
portfolio level. Prefer primary public sources: engineering blogs, conference
talks, official tooling docs, open-source repositories, survey data, long-form
practitioner threads. For EVERY source, verify reachability (HTTP 200) before
citing; if a canonical link serves 403/404 to scripted fetches but resolves in
a browser, keep it and note the fact. Write the briefing to {OUTPUT_PATH} with
exactly this structure:

- H1 title, then a metadata block: Date, Purpose (tie to Loop's persona-driven
  development-analysis capability and workflow profiles), Method (name source
  classes and the verification date), Relation to prior briefings (name which
  earlier briefing this complements and what constraint family it adds).
- `## Who this persona is` — one paragraph: dominant constraint, unit of
  progress, what the tooling exists to do.
- Numbered H2 sections (`## 1. ...`) for the five coverage areas.
- `## Observable patterns (for trace/profile matching)` — numbered list; each
  item states a pattern and ends with an explicit "In a trace: ..." sentence
  describing what a Loop run trace would look like if the pattern were present.
- `## Mapping to Loop workflow profiles` — short bullets tying the patterns to
  plan-first / spike-first / TDD-first and any new profile candidates.
- `## Tensions and caveats` — source biases, idealization vs. census, scale
  mismatches with a single-agent system.
- `## Sources` — full URLs with the verification date; group under a lead-in
  sentence stating every link was fetched and verified reachable.

Do not hand-copy prior briefings' sources where redundant; cite the prior
briefing by filename instead. {ANGLE}.
```

### Persona angles and output paths

1. **Indie/solo** — `ANGLE`: emphasize build-in-public as a workflow stage, launch mechanics as a combined release-and-market-test event, appetite-based scoping (*Shape Up*), manual-first integration-shaped verification, production monitoring as the real test suite, portfolio-level kill behavior, scaffolding reuse. `OUTPUT_PATH`: `docs/research/personas/indie-hacker.md`.
2. **Big-tech/platform** — `ANGLE`: emphasize design-doc culture (alternatives considered), code review as the merge institution (small CLs, OWNERS, readability), hermetic test-size taxonomy and presubmit, trunk-based development with flags and staged/canary rollout, on-call and blameless postmortems with tracked action items, policy encoded in tooling (Tricorder, error budgets). `OUTPUT_PATH`: `docs/research/personas/bigtech-engineer.md`.
3. **Data-science/ML + SRE (paired)** — `ANGLE`: emphasize the ML empirical loop (notebook → refactored pipeline promotion, experiment tracking, numeric evaluation gates, offline-vs-online evidence) and the SRE reliability loop (error-budget policy, incremental rollout, DiRT/chaos drills, runbooks linked from alerts); keep the two in tension as iteration-speed vs. change-control. `OUTPUT_PATH`: `docs/research/personas/datasci-sre.md`.
4. **Game/embedded (paired)** — `ANGLE`: emphasize numeric budgets declared before implementation (frame time, RAM, WCET), profile-before-optimize experiment loops, engine/content separation with cook pipelines, reproducible builds and toolchain pinning, determinism and recorded-input replay, automated playtesting with evidence media, and the sim-first/hardware-later verification funnel. `OUTPUT_PATH`: `docs/research/personas/gamedev-embedded.md`.

### Source lists per persona

Seed each fan-out node with its source list; the worker verifies reachability and may add primary sources, but every link in the final `## Sources` section must have been fetched.

**indie-hacker.md**

- https://readmake.com/ (Levels, *MAKE* free preview)
- https://levels.io/12-startups-12-months/
- https://dhh.dk/2014/tdd-is-dead-long-live-testing.html
- https://majesticmonolith.com/
- https://basecamp.com/shapeup
- https://news.ycombinator.com/item?id=42373343 (Ask HN: $500/mo side projects)
- https://news.ycombinator.com/item?id=31471834 (Ask HN: got-hit-by-a-bus)
- https://news.ycombinator.com/item?id=14385251 (Ask HN: closing side projects)
- https://tylertringas.com/storemapper-bootstrapped-to-50000year-in-2-years-with-live-metrics/
- https://github.com/mezod/awesome-indie
- https://survey.stackoverflow.co/2023/

**bigtech-engineer.md**

- https://google.github.io/eng-practices/review/
- https://www.industrialempathy.com/posts/design-docs-at-google/
- https://sre.google/sre-book/postmortem-culture/
- https://sre.google/sre-book/being-on-call/
- https://sre.google/sre-book/release-engineering/
- https://aws.amazon.com/builders-library/automating-safe-hands-off-deployments/
- https://engineering.fb.com/2017/08/31/web/rapid-release-at-massive-scale/
- https://abseil.io/resources/swe-book/html/ch11.html
- https://research.google/pubs/pub43322/ (Tricorder)
- https://research.google/pubs/pub43455/ (Build in the Cloud)
- https://netflixtechblog.com/automated-canary-analysis-at-netflix-with-kayenta-3d0a06f619e7

**datasci-sre.md**

- https://cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning
- https://netflixtechblog.com/scheduling-notebooks-at-netflix-869c99fea81f (403 to scripts; resolves in browser)
- https://docs.metaflow.org/introduction/what-is-metaflow
- https://mlflow.org/docs/latest/tracking.html
- https://learn.microsoft.com/en-us/azure/architecture/data-science-process/overview
- https://proceedings.neurips.cc/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html (Hidden Technical Debt)
- https://sre.google/sre-book/embracing-risk/
- https://sre.google/sre-book/emergency-response/
- https://sre.google/workbook/implementing-slos/
- https://cloud.google.com/blog/products/devops-sre/sre-fundamentals-slis-slas-and-slos
- https://www.usenix.org/publications/login/oct14/introducing-dirt
- https://response.pagerduty.com/
- https://wikitech.wikimedia.org/wiki/Runbook
- https://principlesofchaos.org/

**gamedev-embedded.md**

- https://www.youtube.com/watch?v=rX0ItVEVjHc (Acton, CppCon 2014)
- https://gamesfromwithin.com/data-oriented-design (Llopis)
- https://www.dataorienteddesign.com/dodbook/ (Fabian)
- https://github.com/id-Software/DOOM
- https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond
- https://www.gafferongames.com/post/fix_your_timestep/
- https://www.youtube.com/watch?v=8QHHVpBiG-I (Overwatch GDC 2017)
- https://www.youtube.com/watch?v=X673tOi8pU8 (Sea of Thieves GDC 2018)
- https://dev.epicgames.com/documentation/en-us/unreal-engine/automation-system-in-unreal-engine
- https://dev.epicgames.com/documentation/en-us/unreal-engine/gauntlet-automation-tool-in-unreal-engine
- https://docs.zephyrproject.org/latest/develop/test/twister.html
- https://renode.readthedocs.io/en/latest/
- https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/unit-tests.html
- https://pragprog.com/titles/jgade/test-driven-development-for-embedded-c/
- http://web.eecs.umich.edu/~imarkov/10rules.pdf (Power of Ten)
- https://reproducible-builds.org/

### Fan-out completion check (per persona)

```bash
test -s <OUTPUT_PATH> && grep -q '## Sources' <OUTPUT_PATH> && echo "CHECK PASSED"
```

## Merge node (persona-briefing)

- **Depends on:** all four fan-out nodes.
- **Read scope:** `docs/research/personas/**`. **Write scope:** `docs/research/personas/persona-development-briefing.md` and `docs/research/persona-benchmark-playbook.md`.
- **Prompt:**

```text
Read all four persona briefings in docs/research/personas/ (indie-hacker,
bigtech-engineer, datasci-sre, gamedev-embedded). Write
docs/research/personas/persona-development-briefing.md: a cross-field synthesis
that (a) summarizes each persona's dominant constraint, unit of progress, gate,
and tooling in one comparison table; (b) contains a `## Cross-field patterns`
section that compares workflow stages, verification practices, and tooling
across the four fields and enumerates the recurring mechanisms as numbered
patterns, naming the single top-level pattern first; (c) derives implications
for Loop workflow profiles (plan-first / spike-first / TDD-first, plus any
candidate profiles such as budget-first), including failure-edge and
completion-contract design; (d) preserves each briefing's caveats (source bias,
idealization, scale mismatch); (e) points to the per-persona files for full
source lists rather than duplicating them. Then write
docs/research/persona-benchmark-playbook.md documenting exactly how to re-run
this study as a Loop DAG per this file's structure: DAG shape, per-persona
angles and prompts, per-persona source lists, merge steps, output paths, and
completion checks. Respect declared scopes; add no new sources.
```

- **Merge steps, in order:**
  1. Read the four briefings end to end; extract each one's "Observable patterns", "Mapping to Loop workflow profiles", and "Tensions and caveats".
  2. Build the comparison table (constraint / unit of progress / gate / failure handling / tooling).
  3. Derive cross-field patterns by intersecting the per-persona pattern lists; the top pattern is the one present in all four fields with the least field-specific variance — for attempt 0 that was **work advances through pre-declared gates, and the persona is identified by its gate's position and evidence type**.
  4. Write the synthesis briefing (see its prompt above).
  5. Write the playbook (this document) so the next attempt can re-run steps 1–4 without re-deriving anything.
  6. Run the completion check below.

### Merge completion check

```bash
test -s docs/research/personas/persona-development-briefing.md \
  && test -s docs/research/persona-benchmark-playbook.md \
  && [ $(grep -c '^## ' docs/research/personas/persona-development-briefing.md) -ge 6 ]
```

## Constraints (apply to every node)

- Respect declared read/write scopes; nothing outside `docs/research/` is read or written.
- No provider, Pi, model, or endpoint concepts enter the study's outputs as system design; personas describe human development workflows only.
- Verification of completion checks is bash-only; no paid model call is required for any check.
- Links that serve 403/404 to scripted fetches may be cited if they resolve in a browser, with the fact noted.

## Extending the study

- **New persona:** add one fan-out node (angle + source list + output path) and one input to the merge node's read list and comparison table. Candidates the four briefings themselves suggest: frontend/design-engineer, security engineer, open-source maintainer, QA/test engineer.
- **Re-run for freshness:** re-verify every source link (HTTP status) on the new run date and update the verification dates in each briefing's metadata and `## Sources` lead-in; re-derive the synthesis from the refreshed briefings rather than patching it.
- **Feeding stream B (persona benchmark):** each briefing's "Observable patterns (for trace/profile matching)" section is the contract for what the benchmark subsystem's traces must be able to express (gate position, verification placement, failure edges, numeric contracts, evidence artifacts). Start from `persona-development-briefing.md` § "Implications for Loop workflow profiles".
- **Feeding stream C (self-trace analysis):** compare Loop's own run traces against the "Trace signatures at a glance" table in the synthesis briefing; a mismatch between Loop's modal trace shape and the intended profile is a finding.
