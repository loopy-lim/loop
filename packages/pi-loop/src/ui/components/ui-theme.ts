/**
 * Structural subset of the Pi theme that the Loop TUI components need,
 * following the `ViewerTheme` precedent in ../files-viewer.ts: Pi's active
 * `Theme` satisfies this interface (every token name below is a Pi `FgToken` /
 * `BgToken`), and tests can supply a plain recorder. Components style through
 * these semantic tokens only — no hardcoded ANSI escapes.
 */

export type LoopUiFgToken =
  | "accent"
  | "dim"
  | "muted"
  | "success"
  | "warning"
  | "error";

export type LoopUiBgToken = "selectedBg";

export interface LoopUiTheme {
  fg(token: LoopUiFgToken, text: string): string;
  bg(token: LoopUiBgToken, text: string): string;
  bold(text: string): string;
  italic(text: string): string;
  underline(text: string): string;
  strikethrough(text: string): string;
}
