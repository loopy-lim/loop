/**
 * Lightweight markdown -> render-node parser (decision 2026-xx-codex-detail-
 * checklist C1). Dependency 0, closed grammar of exactly five constructs —
 * code fences, inline code, headers, bullets, bold — with everything else
 * (including unknown emphasis like `~~`) preserved as plain text. Pure:
 * no React, no projection mutation — the projection text is consumed as-is
 * (D4 §8: the app never re-redacts or re-sends rendered text).
 */

export type MarkdownInline =
  | { kind: "text"; text: string }
  | { kind: "inlineCode"; text: string }
  | { kind: "bold"; text: string };

export type MarkdownBlock =
  | { kind: "code"; lang: string; text: string }
  | { kind: "header"; level: 1 | 2 | 3; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "text"; text: string };

const HEADER_PREFIX = /^(#{1,3})\s+(.*)$/;
const BULLET_PREFIX = /^[-*]\s+(.*)$/;
const FENCE_PREFIX = /^```(\S*)\s*$/;

/** Parse one line's inline spans: inline code wins first (its content is
 * literal), then bold outside code. Unmatched markers stay literal. */
export function parseInline(text: string): MarkdownInline[] {
  const spans: MarkdownInline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const code = rest.indexOf("`");
    const bold = rest.indexOf("**");
    if (code < 0 && bold < 0) {
      spans.push({ kind: "text", text: rest });
      break;
    }
    if (code >= 0 && (bold < 0 || code < bold)) {
      const close = rest.indexOf("`", code + 1);
      if (close < 0) {
        spans.push({ kind: "text", text: rest });
        break;
      }
      if (code > 0) spans.push({ kind: "text", text: rest.slice(0, code) });
      spans.push({ kind: "inlineCode", text: rest.slice(code + 1, close) });
      rest = rest.slice(close + 1);
      continue;
    }
    const close = rest.indexOf("**", bold + 2);
    if (close < 0) {
      spans.push({ kind: "text", text: rest });
      break;
    }
    if (bold > 0) spans.push({ kind: "text", text: rest.slice(0, bold) });
    spans.push({ kind: "bold", text: rest.slice(bold + 2, close) });
    rest = rest.slice(close + 2);
  }
  return spans.filter((span) => span.text.length > 0);
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
        if (FENCE_PREFIX.test(lines[j] ?? "")) {
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
    const header = HEADER_PREFIX.exec(line);
    if (header !== null) {
      flushParagraph();
      const level = (header[1]?.length ?? 1) as 1 | 2 | 3;
      blocks.push({ kind: "header", level, text: header[2] ?? "" });
      continue;
    }
    const bullet = BULLET_PREFIX.exec(line);
    if (bullet !== null) {
      flushParagraph();
      blocks.push({ kind: "bullet", text: bullet[1] ?? "" });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}
