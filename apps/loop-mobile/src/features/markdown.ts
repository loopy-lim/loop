/**
 * Lightweight markdown -> render-node parser (decision 2026-xx-codex-detail-
 * checklist C1). Dependency 0, closed grammar — code fences, inline code,
 * headers, bullets, ordered lists, bold, italic (single `*` only: underscore
 * italics stay literal so snake_case never flips), and `[label](https://…)`
 * links (http/https only; anything else stays literal) — with everything
 * else (including unknown emphasis like `~~`) preserved as plain text.
 * Pure: no React, no projection mutation — the projection text is consumed
 * as-is (D4 §8: the app never re-redacts or re-sends rendered text).
 */

import { space } from "../ui/tokens";

export type MarkdownInline =
  | { kind: "text"; text: string }
  | { kind: "inlineCode"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; text: string; url: string };

export type MarkdownBlock =
  | { kind: "code"; lang: string; text: string }
  | { kind: "header"; level: 1 | 2 | 3; text: string }
  | { kind: "bullet"; text: string; level: number }
  | { kind: "ordered"; n: number; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "text"; text: string };

const HEADER_PREFIX = /^(#{1,3})\s+(.*)$/;
const BULLET_PREFIX = /^([ \t]{2,})[-*]\s+(.*)$/;
const BULLET_TOP_PREFIX = /^[-*]\s+(.*)$/;
const ORDERED_PREFIX = /^(\d{1,3})[.)]\s+(.*)$/;
const FENCE_PREFIX = /^[ \t]{0,6}```(\S*)\s*$/;
const FENCE_CLOSE_PREFIX = /^[ \t]{0,6}```\s*$/;
/** `[label](url)` with an http(s) url — other schemes stay literal text. */
const LINK_PREFIX = /^\[([^\][]+)\]\((https?:\/\/[^()\s]+)\)/;
/** GFM delimiter row: only dashes, colons, pipes, spaces — at least one dash. */
const TABLE_DELIM = /^[\s|:-]+$/;
/** Indent steps for nested bullets — the closed spacing scale indexed by
 * level (design-spec AC-S3-2: no arithmetic at call sites). Level caps at
 * the list end. ui/tokens is importable without the RN runtime, so the pure
 * parser stays headless. */
export const BULLET_INDENT = [space.m, space.l, space.xl];

/** Parse one line's inline spans: inline code wins first (its content is
 * literal), then links, bold, italic outside code. Unmatched markers stay
 * literal; a `[` that is not a well-formed link advances one character so
 * the scan always makes progress. */
export function parseInline(text: string): MarkdownInline[] {
  const spans: MarkdownInline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const code = rest.indexOf("`");
    const link = rest.indexOf("[");
    const bold = rest.indexOf("**");
    const italic = rest.indexOf("*");
    // `**` also contains `*` at the same index — bold wins the tie.
    const starts: Array<[number, "code" | "link" | "bold" | "italic"]> = [];
    if (code >= 0) starts.push([code, "code"]);
    if (link >= 0) starts.push([link, "link"]);
    if (bold >= 0) starts.push([bold, "bold"]);
    if (italic >= 0 && italic !== bold) starts.push([italic, "italic"]);
    if (starts.length === 0) {
      spans.push({ kind: "text", text: rest });
      break;
    }
    starts.sort((a, b) => a[0] - b[0]);
    const first = starts[0];
    if (first === undefined) {
      spans.push({ kind: "text", text: rest });
      break;
    }
    const [at, which] = first;
    if (which === "code") {
      const close = rest.indexOf("`", at + 1);
      if (close < 0) {
        spans.push({ kind: "text", text: rest });
        break;
      }
      if (at > 0) spans.push({ kind: "text", text: rest.slice(0, at) });
      spans.push({ kind: "inlineCode", text: rest.slice(at + 1, close) });
      rest = rest.slice(close + 1);
      continue;
    }
    if (which === "link") {
      const match = LINK_PREFIX.exec(rest.slice(at));
      if (match === null) {
        // Not a link: keep the bracket literal and rescan the remainder.
        spans.push({ kind: "text", text: rest.slice(0, at + 1) });
        rest = rest.slice(at + 1);
        continue;
      }
      if (at > 0) spans.push({ kind: "text", text: rest.slice(0, at) });
      spans.push({ kind: "link", text: match[1] ?? "", url: match[2] ?? "" });
      rest = rest.slice(at + match[0].length);
      continue;
    }
    if (which === "bold") {
      const close = rest.indexOf("**", bold + 2);
      if (close < 0) {
        spans.push({ kind: "text", text: rest });
        break;
      }
      if (bold > 0) spans.push({ kind: "text", text: rest.slice(0, bold) });
      spans.push({ kind: "bold", text: rest.slice(bold + 2, close) });
      rest = rest.slice(close + 2);
      continue;
    }
    // italic: single `*` pair with flanking rules — whitespace inside either
    // delimiter (`2 * 3 * 4`) keeps every asterisk literal.
    const openOk = !/\s/.test(rest.slice(italic + 1, italic + 2));
    const close = openOk ? rest.indexOf("*", italic + 1) : -1;
    const closeOk = close > italic + 1 && !/\s/.test(rest.slice(close - 1, close));
    if (!openOk || !closeOk || close < 0) {
      spans.push({ kind: "text", text: rest.slice(0, italic + 1) });
      rest = rest.slice(italic + 1);
      continue;
    }
    if (italic > 0) spans.push({ kind: "text", text: rest.slice(0, italic) });
    spans.push({ kind: "italic", text: rest.slice(italic + 1, close) });
    rest = rest.slice(close + 1);
  }
  return spans.filter((span) => span.text.length > 0);
}

/** Split one GFM table row into trimmed cells (leading/trailing empties
 * dropped). */
function splitTableRow(line: string): string[] {
  const parts = line.split("|");
  if (parts.length > 0 && parts[0]?.trim() === "") parts.shift();
  if (parts.length > 0 && parts[parts.length - 1]?.trim() === "") parts.pop();
  return parts.map((cell) => cell.trim());
}

/** Parse assistant text into closed-grammar render blocks. A code fence
 * left open by a mid-stream cut stays an honest code block of what arrived. */
export function parseMarkdown(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.split("\n");
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "text", text: paragraph.join("\n") });
      paragraph = [];
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fence = FENCE_PREFIX.exec(line);
    if (fence !== null) {
      flushParagraph();
      const body: string[] = [];
      let closed = false;
      for (let j = i + 1; j < lines.length; j += 1) {
        if (FENCE_CLOSE_PREFIX.test(lines[j] ?? "")) {
          closed = true;
          i = j;
          break;
        }
        body.push(lines[j] ?? "");
      }
      blocks.push({ kind: "code", lang: fence[1] ?? "", text: body.join("\n") });
      if (!closed) break; // streaming cut inside a fence: stop consuming
      continue;
    }
    // GFM table: a leading-pipe line whose NEXT line is a delimiter row —
    // a lone pipe line stays literal text (plan 2026-10-25 AC-1).
    if (line.trimStart().startsWith("|")) {
      const next = lines[i + 1] ?? "";
      if (next.includes("-") && TABLE_DELIM.test(next)) {
        flushParagraph();
        const head = splitTableRow(line);
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length) {
          const row = lines[j] ?? "";
          if (!row.trimStart().startsWith("|")) break;
          rows.push(splitTableRow(row));
          j += 1;
        }
        blocks.push({ kind: "table", head, rows });
        i = j - 1;
        continue;
      }
    }
    const header = HEADER_PREFIX.exec(line);
    if (header !== null) {
      flushParagraph();
      const level = (header[1]?.length ?? 1) as 1 | 2 | 3;
      blocks.push({ kind: "header", level, text: header[2] ?? "" });
      continue;
    }
    const nestedBullet = BULLET_PREFIX.exec(line);
    if (nestedBullet !== null) {
      flushParagraph();
      const level = Math.min(Math.ceil((nestedBullet[1]?.length ?? 0) / 2), BULLET_INDENT.length);
      blocks.push({ kind: "bullet", text: nestedBullet[2] ?? "", level });
      continue;
    }
    const bullet = BULLET_TOP_PREFIX.exec(line);
    if (bullet !== null) {
      flushParagraph();
      blocks.push({ kind: "bullet", text: bullet[1] ?? "", level: 0 });
      continue;
    }
    const ordered = ORDERED_PREFIX.exec(line);
    if (ordered !== null) {
      flushParagraph();
      blocks.push({ kind: "ordered", n: Number.parseInt(ordered[1] ?? "0", 10), text: ordered[2] ?? "" });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}
