/**
 * Split-viewer layout policy (split-viewer design §B) — the pure half of
 * the responsive container. No react-native import: the decision (wide vs
 * narrow) and the viewer's seeded targets are deterministic data the
 * RunSplitScreen container consumes; tests pin them without a device.
 *
 * Boundary note: this module knows the repo's report paths, not the
 * gateway. Paths ride the read-only /v1/files surface (§A) at open time.
 */

/** Breakpoint between the phone (bottom sheet) and tablet (two-pane)
 * containers. RN `useWindowDimensions` width ≥ this → two-pane. 768 is
 * the iPad-portrait floor and the usual landscape-phone width. */
export const SPLIT_BREAKPOINT = 768;

export type SplitLayout = "wide" | "narrow";

export function resolveSplitLayout(width: number): SplitLayout {
  return width >= SPLIT_BREAKPOINT ? "wide" : "narrow";
}

/** One seeded viewer entry: a repo path the run surface writes reports to.
 * Directories open as listings; files open directly. */
export type ViewerTarget = {
  label: string;
  /** Path relative to the gateway working directory (/v1/files surface). */
  path: string;
};

/** The §B seeded targets: docs/findings, docs/diagnosis, check receipts.
 * Order is display order; all three always appear (a missing path is a
 * 404 problem at open time, not a hidden entry). */
export const VIEWER_TARGETS: readonly ViewerTarget[] = [
  { label: "Findings", path: "docs/findings" },
  { label: "Diagnosis", path: "docs/diagnosis" },
  { label: "Check receipts", path: "docs/checks" },
] as const;
