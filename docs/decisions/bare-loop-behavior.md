# Decision: Bare loop workspace behavior

## Context
The adoptability review highlighted that running `loop` without arguments opens an interactive Loop Lead but does not create or attach a Herdr workspace, which can disorient users expecting a full project context. The review suggested revisiting this behavior to explicitly prompt for or establish a Herdr workspace.

## Decision
Option A: Preserve the invariant and add explicit guidance output when no workspace context exists.

## Justification
Loop's architecture strictly defines boundaries: Herdr owns terminals and panes, Pi owns the interactive Lead experience, and Loop owns orchestration. The README explicitly states as a design invariant that Loop "never creates or attaches a Herdr workspace for itself." Changing the CLI to prompt for or automatically establish a workspace would violate this boundary and mix responsibilities. By preserving the invariant and providing explicit guidance when a workspace context is missing, we maintain the strict separation of concerns while improving user experience and reducing friction.

## Chosen CLI Behavior
When the bare `loop` command is executed and no Herdr workspace context is detected (`HERDR_ENV` absent), the CLI prints a notice to stderr just before starting the Lead:
`Notice: no active Herdr workspace detected; continuing without Herdr run reporting. Run 'herdr' first, or start 'loop' inside an existing Herdr pane.`
The Lead still starts. This preserves the recorded plan invariant that "The Loop agent must still work outside Herdr" (docs/superpowers/plans/2026-09-21-loop-herdr-hosted-agent-plan.md) while guiding users toward full run reporting. Loop never creates or attaches a Herdr workspace for itself.

## Required README Wording Changes
The README "Usage" section will be updated to emphasize that a Herdr workspace is required before using Loop, and explicitly explain the guidance output that appears when one is missing. It will also clarify the difference between `loop` (bare) and `loop run <intent>`.

## Completion Criteria
- Bare `loop` checks for a Herdr workspace context.
- Explicit guidance is printed to stdout if the context is missing, preserving the no-self-workspace invariant.
- README.md has an added "Usage" section that documents this requirement.
