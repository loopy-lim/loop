/**
 * ANSI → styled spans for the herdr transcript and terminal views (rebuild
 * brief §7 위험 완화: 파서는 SGR만 지원하고 커서 제어 시퀀스는 제거한다).
 *
 * Design rules:
 * - Only CSI … m (SGR) styling is interpreted. Every other escape sequence
 *   (cursor movement, OSC, device queries) is stripped — a transcript is
 *   read as text, not replayed as a terminal.
 * - Colors resolve to the xterm-256 palette; the 16 base colors use a dark
 *   terminal mapping so "ansi" reads stay cohesive with the app theme.
 * - Adjacent runs with identical style are merged; the run count is bounded
 *   so a pathological frame can never explode the render tree.
 * - Pure module: no react-native import (unit-test contract).
 */

export type AnsiColor = { readonly kind: "palette"; readonly index: number } | {
  readonly kind: "rgb";
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

export type AnsiStyle = {
  readonly fg: AnsiColor | null;
  readonly bg: AnsiColor | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
};

export type AnsiRun = AnsiStyle & { readonly text: string };

export const PLAIN_STYLE: AnsiStyle = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
};

/** Run budget: a pane frame past this many runs renders its tail plain. */
export const MAX_RUNS = 600;

/** Parse terminal text into styled runs. Never throws. */
export function parseAnsi(input: string): AnsiRun[] {
  const runs: AnsiRun[] = [];
  let style: AnsiStyle = PLAIN_STYLE;
  let buffer = "";

  const flush = (): void => {
    if (buffer.length === 0) return;
    const last = runs[runs.length - 1];
    if (last !== undefined && sameStyle(last, style)) {
      // Mutating the last run's text is safe: runs are plain records.
      (last as { text: string }).text += buffer;
    } else if (runs.length < MAX_RUNS) {
      runs.push({ ...style, text: buffer });
    } else {
      const tail = runs[runs.length - 1];
      if (tail !== undefined) (tail as { text: string }).text += buffer;
    }
    buffer = "";
  };

  let i = 0;
  const length = input.length;
  while (i < length) {
    const char = input[i];
    if (char === "\u001b" && i + 1 < length) {
      const next = input[i + 1];
      if (next === "[") {
        const terminator = findCsiEnd(input, i + 2);
        if (terminator === null) break; // truncated sequence at frame end: drop the tail
        const params = input.slice(i + 2, terminator);
        if (input[terminator] === "m") {
          flush();
          style = applySgr(style, params);
        }
        i = terminator + 1;
        continue;
      }
      if (next === "]") {
        const bell = input.indexOf("\u0007", i + 2);
        const stringTerminator = input.indexOf("\u001b\\", i + 2);
        if (bell === -1 && stringTerminator === -1) break; // truncated OSC: drop the tail
        i = bell !== -1 ? bell + 1 : stringTerminator + 2;
        continue;
      }
      if (next === "(" || next === ")" || next === "#" || next === "%") {
        i += 3; // two-byte escape sequences (charset, line attrs)
        continue;
      }
      i += 2; // two-character escapes (ENQ replies etc.)
      continue;
    }
    buffer += char;
    i += 1;
  }
  flush();
  return runs;
}

/** Index of the final byte of a CSI sequence, or null when unterminated. */
function findCsiEnd(input: string, from: number): number | null {
  for (let i = from; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0x40 && code <= 0x7e) return i;
  }
  return null;
}

function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
  return (
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse &&
    colorEquals(a.fg, b.fg) &&
    colorEquals(a.bg, b.bg)
  );
}

function colorEquals(a: AnsiColor | null, b: AnsiColor | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "rgb" && b.kind === "rgb") {
    return a.r === b.r && a.g === b.g && a.b === b.b;
  }
  if (a.kind === "palette" && b.kind === "palette") {
    return a.index === b.index;
  }
  return false;
}

/** Apply one SGR parameter string (semicolon or colon separated numbers). */
export function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  if (params.length === 0) return PLAIN_STYLE;
  const numbers = params
    .split(/[;:]/)
    .map((part) => Number.parseInt(part, 10));
  let next = style;
  let i = 0;
  while (i < numbers.length) {
    const code = numbers[i];
    i += 1;
    if (code === undefined || Number.isNaN(code)) continue;
    if (code === 0) {
      next = PLAIN_STYLE;
      continue;
    }
    if (code === 1) next = { ...next, bold: true };
    else if (code === 2) next = { ...next, dim: true };
    else if (code === 3) next = { ...next, italic: true };
    else if (code === 4) next = { ...next, underline: true };
    else if (code === 7) next = { ...next, inverse: true };
    else if (code === 22) next = { ...next, bold: false, dim: false };
    else if (code === 23) next = { ...next, italic: false };
    else if (code === 24) next = { ...next, underline: false };
    else if (code === 27) next = { ...next, inverse: false };
    else if (code === 39) next = { ...next, fg: null };
    else if (code === 49) next = { ...next, bg: null };
    else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      next = { ...next, fg: { kind: "palette", index: code - (code >= 90 ? 90 : 30) + (code >= 90 ? 8 : 0) } };
    } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
      next = { ...next, bg: { kind: "palette", index: code - (code >= 100 ? 100 : 40) + (code >= 100 ? 8 : 0) } };
    } else if ((code === 38 || code === 48) && i < numbers.length) {
      const mode = numbers[i];
      if (mode === 5 && i + 1 < numbers.length) {
        const index = numbers[i + 1] ?? 0;
        const color: AnsiColor = { kind: "palette", index: Math.min(255, Math.max(0, index)) };
        next = code === 38 ? { ...next, fg: color } : { ...next, bg: color };
        i += 2;
      } else if (mode === 2 && i + 3 < numbers.length) {
        const color: AnsiColor = {
          kind: "rgb",
          r: clampByte(numbers[i + 1]),
          g: clampByte(numbers[i + 2]),
          b: clampByte(numbers[i + 3]),
        };
        next = code === 38 ? { ...next, fg: color } : { ...next, bg: color };
        i += 4;
      } else {
        break; // malformed extended color: stop consuming
      }
    }
  }
  return next;
}

function clampByte(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0;
  return Math.min(255, Math.max(0, value));
}

// ——— xterm-256 palette → hex ————————————————————————————————————————————————

const BASE16 = [
  "#000000", "#cd3131", "#0dbc79", "#e5e510",
  "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
  "#666666", "#f14c4c", "#23d18b", "#f5f543",
  "#3b8eea", "#d670d6", "#29b8db", "#ffffff",
] as const;

/** Resolve a palette color to hex; null for out-of-range indices. */
export function paletteHex(index: number): string | null {
  if (index < 16) return BASE16[index] ?? null;
  if (index < 232) {
    const cell = index - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const r = steps[Math.floor(cell / 36)] ?? 0;
    const g = steps[Math.floor((cell % 36) / 6)] ?? 0;
    const b = steps[cell % 6] ?? 0;
    return rgbHex(r, g, b);
  }
  if (index < 256) {
    const gray = 8 + (index - 232) * 10;
    return rgbHex(gray, gray, gray);
  }
  return null;
}

export function ansiColorHex(color: AnsiColor): string {
  return color.kind === "rgb" ? rgbHex(color.r, color.g, color.b) : paletteHex(color.index) ?? "#f2f5f9";
}

function rgbHex(r: number, g: number, b: number): string {
  const hex = (value: number): string => value.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
