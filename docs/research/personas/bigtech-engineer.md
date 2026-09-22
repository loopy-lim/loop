# Persona Briefing: Big-Tech / Platform Engineer

- **Date:** 2026-09-22
- **Purpose:** Research deliverable for Loop's persona-driven development-analysis capability. Describes how engineers at large platform companies (Google/Amazon/Meta/Netflix scale) actually build software, with observable patterns that can later be encoded as workflow profiles (e.g. plan-first vs. spike-first) and matched against Loop's own run traces.
- **Method:** Synthesis of primary public sources — engineering blogs, the Google SRE books, the free online edition of *Software Engineering at Google*, the Amazon Builders' Library, and Google Research publications. All links verified reachable (see Sources; one canonical Medium link serves 403 to scripted fetches but resolves in a browser).

## Who this persona is

An engineer (or platform/SWE-infra engineer) at a company where hundreds to thousands of engineers commit to a shared trunk, deploy many times per day, and where the dominant engineering constraints are coordination and risk at scale, not individual productivity. Tooling (monorepo, trunk-based development, presubmits, staged rollouts) exists to make thousands of parallel changes safe. The unit of progress is the small, reviewed, independently revertible change — not the feature branch.

## 1. Design-doc culture: write before you build

- Substantial work is preceded by a **design doc**: context, goals/non-goals, proposed design, alternatives considered, security/privacy review checklist, and a rollout/observability plan. At Google the doc circulates asynchronously for comments (in Google Docs) and is often presented at a design review before a line of production code is written ([Design Docs at Google]).
- The doc is a coordination artifact, not ceremony: it lets a dozen stakeholders disagree in comments before code review, which is far cheaper than disagreeing during review of a finished change.
- **Alternatives considered** is a mandatory section — a design must argue against named alternatives, which creates durable decision records ("why did we do it this way?").
- Riskier or more reversible-hostile changes get proportionally heavier upfront review; small changes skip the doc entirely. Document weight scales with blast radius.

## 2. Code-review culture: the merge gate is the institution

- **Every** change to production code lands through formal code review. Google's guide treats review as the enforcement point for correctness, style, consistency, and — most importantly — "is this change actually what the author intended?" ([Google Code Review Developer Guide]).
- Changes are deliberately **small** (Google guidance: a well-sized CL is a few hundred lines). Small diffs make review fast, review quality high, and rollback trivial.
- **Ownership gates:** directory-level `OWNERS` files decide who may approve a change; sensitive code (security, payments) requires additional, specific reviewers.
- **Readability programs:** a peer-certification system certifies that an author writes idiomatic, consistent code in a language, so reviews can focus on substance instead of style debates.
- Enforcement is automated where possible: Google's **Tricorder** static-analysis system files review comments automatically and is tuned so that its comments are trusted and fixed by developers — lessons include "make the tool part of the existing workflow (code review), not a separate dashboard" and "tune to a low false-positive rate" ([Tricorder paper]).

## 3. Testing layers: size means hermeticity, not lines of code

- *Software Engineering at Google* explicitly rejects the naive test pyramid in favor of a taxonomy of **small / medium / large** tests defined by what they touch, not how long they are: small tests run in a single process with fakes for I/O; medium tests may touch localhost (real DB in an emulator); large tests may touch anything ([SWE@G Ch. 11 — Testing Overview]).
- **Presubmit** (pre-merge) runs only small tests plus static analysis, because speed of feedback determines whether developers run tests at all. Broader medium/large tests run continuously in the project's continuous integration; the fastest feedback loop is reserved for the most frequently broken contracts.
- Tests must be **hermetic** — no dependence on shared mutable state, network, or wall-clock time — so failures localize to the change under test. Flakiness is treated as a tracked defect class with dedicated dashboards and quarantine processes ([SWE@G Ch. 11 — Testing Overview], [Build in the Cloud]).
- Production-derived artifacts (traces, anonymized request samples) feed test fixtures so large tests exercise realistic behavior — a form of "copy prod into test" that compensates for engineers being far from user-visible failure.

## 4. CI/CD and rollout: decouple deploy from release

- **Trunk-based development (TOT strategy):** everyone commits to one branch; there are no long-lived release branches to merge. Staying green is a shared, staffed responsibility (Google has "build cops" / test Sheriffs who triage breakage and can regressculprits) ([Release Engineering — SRE Book]).
- **Feature flags** separate deploying code from releasing functionality: incomplete features land dark behind flags, are enabled gradually, and can be disabled instantly without a rollback build ([Automating safe, hands-off deployments]).
- **Staged/canary rollout with automated rollback:** Amazon's model is a pipeline of stages (build → gamma/pre-prod → canary on a small traffic slice → full fleet), where each stage has **rollback triggers defined before deploy** and "one-way door" (hard to revert) vs "two-way door" (easy to revert) decisions get different approval rigor ([Automating safe, hands-off deployments]).
- Meta described the same idea as **push tiers** (stranger → canary → full fleet over a week of daily pushes) run by dedicated release engineers, with per-tier halt if metrics degrade ([Rapid Release at Massive Scale]). Netflix automated the analysis itself: **Kayenta** compares canary vs. baseline metrics statistically and blocks promotion on regression, removing "stare at a dashboard" from the loop ([Automated Canary Analysis at Netflix]).
- Google's release engineering treats builds and deploys as a uniform platform: every service is released the same way (Target changelists, incremental rollout with automatic rollback on health signals), so the rollout mechanism is boring and identical across thousands of teams ([Release Engineering — SRE Book]).

## 5. On-call and postmortem loop: failure produces documents and queued work

- On-call is a designed rotation with a **toil cap** (Google SRE: keep manual ops work ≤ ~50% of an engineer's time), paging reserved for user-impacting urgency; everything else becomes ticket work ([Being an On-call Engineer — SRE Book]).
- **Error budgets** (1 − SLO) gate releases: a service that exhausts its budget freezes risky launches and prioritizes reliability work. Reliability is thereby expressed as a number the org can argue about, not a vibe ([Postmortem Culture — SRE Book]).
- Every significant incident gets a **blameless postmortem**: timeline, root cause, impact, and — critically — **tracked action items** with owners and due dates, reviewed in recurring Ops Reviews. The point is to fix the system that allowed the failure, not the person who triggered it ([Postmortem Culture — SRE Book]).
- The loop closes structurally: postmortem action items become normal engineering tasks in the same planning/backlog system as feature work, so lessons persist beyond the incident channel.

## Observable patterns (for trace/profile matching)

1. **Plan-first artifact before implementation:** a design/research document (with "alternatives considered") is produced and reviewed *before* code tasks start. In a trace: a serialized planning/research node upstream of all implementation nodes.
2. **Small-batch review gates:** work arrives as many small changes, each passing a review gate before merge; review is a hard dependency, not a post-hoc audit. In a trace: short implementation bursts interleaved with verification/review nodes, high node count per unit of output.
3. **Layered verification, cheap-first:** fast hermetic checks run before merge; slow cross-cutting checks run continuously/after. In a trace: quick verify tasks adjacent to each implementation task, heavier integration checks later or serialized.
4. **Canary before full rollout:** changes reach "production" in measured stages with automated health comparison and rollback on regression. In a trace: implement → scoped verification/analysis node → integration node, with a failure path back to implement rather than straight to done.
5. **Failure produces a document plus tracked follow-ups:** an incident or defect ends with a written analysis and explicit follow-up tasks (not just an immediate patch). In a trace: a diagnosis/findings artifact whose downstream tasks are scheduled in the same DAG as feature work.
6. **Policy encoded in tooling, not exhortation:** ownership gates, static-analysis comments, flaky-test quarantine, and rollback triggers are automated enforcement points. In a trace: completion checks that gate status machine-style, independent of worker judgment.
7. **Reversibility-scaled rigor:** "one-way door" changes get extra design review and approval; "two-way door" changes ship fast with rollback as the safety net. In a trace: risk class (decision vs. implementation) determines serialization vs. parallelism.

## Tensions and caveats

- Public sources over-represent Google/Amazon/Netflix; Meta's push culture and Microsoft's/GitHub's PR culture differ in detail (train cadence, review tooling). The patterns above are the convergent core, not a uniform description.
- Heavy process is an effect of scale and blast radius, not a virtue in itself — applying it wholesale to a solo/small-team context (or a one-shot agent run) adds latency without proportional risk reduction. Profile mappings should borrow the *structure* (gates, staged rollout, blameless follow-up), not the headcount.
- External documentation understates how much real behavior is "run locally, iterate quickly, then compress into the small reviewed CL" — the review gate shows the artifact, not the messy loop behind it.

## Sources

- Google Engineering Practices Group, *The Code Review Developer Guide* — https://google.github.io/eng-practices/review/
- Malte Ubl, *Design Docs at Google* (Industrial Empathy) — https://www.industrialempathy.com/posts/design-docs-at-google/
- Beyer, Jones, Petoff, Murphy (eds.), *Site Reliability Engineering* (Google, free online), Ch. 15 *Postmortem Culture: Learning from Failure* — https://sre.google/sre-book/postmortem-culture/
- *Site Reliability Engineering*, Ch. 15 companion *Being an On-call Engineer* — https://sre.google/sre-book/being-on-call/
- *Site Reliability Engineering*, Ch. 8 *Release Engineering* — https://sre.google/sre-book/release-engineering/
- Clare Liguori, *Automating safe, hands-off deployments* (Amazon Builders' Library) — https://aws.amazon.com/builders-library/automating-safe-hands-off-deployments/
- Mansour, Behrens, Bordawekar (Meta/Facebook), *Rapid Release at Massive Scale* (Engineering at Meta) — https://engineering.fb.com/2017/08/31/web/rapid-release-at-massive-scale/
- Winters, Manshreck, Wright, *Software Engineering at Google* (free online), Ch. 11 *Testing Overview* — https://abseil.io/resources/swe-book/html/ch11.html
- Sadowski, Aftandilian, Eagle, Miller-Cushon, Jaspan, *Lessons from Building Static Analysis Tools at Google* (Tricorder, CACM 2018; Google Research mirror) — https://research.google/pubs/pub43322/
- John Micco, *Build in the Cloud: Automating Build and Test at Google* (CACM 2017; Google Research mirror) — https://research.google/pubs/pub43455/
- Casey Rosenthal et al., *Automated Canary Analysis at Netflix with Kayenta* (Netflix Tech Blog, 2018) — https://netflixtechblog.com/automated-canary-analysis-at-netflix-with-kayenta-3d0a06f619e7
