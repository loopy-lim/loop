/**
 * RN rendering of the closed-grammar markdown blocks (decision
 * 2026-xx-codex-detail-checklist C1/C2). Presentational only: the parser
 * (features/markdown.ts) owns the grammar, this file owns look — colors,
 * type roles, and glyphs come from ui/ tokens, never inline hex.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Clipboard, StyleSheet, TouchableOpacity, View } from "react-native";
import type { TextStyle } from "react-native";

import { COPY_CODE_LABEL, COPIED_CODE_LABEL, READOUT_STYLE } from "../ui/copy";
import { DynText } from "../ui/DynText";
import { Icon } from "../ui/Icon";
import { glyph } from "../ui/glyphs";
import { colors, press, radius, space, type } from "../ui/tokens";
import { parseInline, parseMarkdown, type MarkdownInline } from "./markdown";
import { highlightSyntax, type SyntaxSpan } from "./syntax";

/** Token-kind → color role (ui/tokens). `plain` inherits the block's ink —
 * color removal still leaves every glyph (ui-ux-guidance §5). */
const TOKEN_COLOR: Partial<Record<SyntaxSpan["kind"], string>> = {
  comment: colors.syntaxComment,
  keyword: colors.syntaxKeyword,
  string: colors.syntaxString,
  number: colors.syntaxNumber,
  literal: colors.syntaxLiteral,
};

function InlineLine(props: { text: string; style?: TextStyle }) {
  const spans = useMemo(() => parseInline(props.text), [props.text]);
  return (
    <DynText style={props.style}>
      {spans.map((span: MarkdownInline, index: number) => {
        if (span.kind === "bold") {
          return (
            <DynText key={index} style={styles.bold}>
              {span.text}
            </DynText>
          );
        }
        if (span.kind === "inlineCode") {
          return (
            <DynText key={index} style={styles.inlineCode}>
              {span.text}
            </DynText>
          );
        }
        return <DynText key={index}>{span.text}</DynText>;
      })}
    </DynText>
  );
}

/** Code-fence card (C2 + task `composer-attach-and-highlighting`):
 * separated surface, mono type, honest copy of the parsed code (markdown
 * fence markers stripped — the card copies exactly the code, not the
 * syntax that carried it). Supported languages render through the pure
 * span scanner (one nested DynText per span, slicing the original code —
 * the visible text is byte-identical to the copy); unknown languages keep
 * the plain monospace fallback. */
function CodeBlock(props: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const spans = useMemo(() => highlightSyntax(props.code, props.lang), [props.code, props.lang]);
  const onCopy = () => {
    Clipboard.setString(props.code);
    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  return (
    <View style={styles.codeCard}>
      <View style={styles.codeHeader}>
        <DynText style={styles.codeLang} numberOfLines={1}>
          {props.lang.length > 0 ? props.lang : "code"}
        </DynText>
        <TouchableOpacity
          onPress={onCopy}
          activeOpacity={press.activeOpacity}
          hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
          style={styles.codeCopy}
          accessibilityLabel={copied ? COPIED_CODE_LABEL : COPY_CODE_LABEL}
        >
          <Icon role="copy" size={type.caption.fontSize} color={colors.inkMute} />
          <DynText style={styles.codeCopyText}>{copied ? COPIED_CODE_LABEL : COPY_CODE_LABEL}</DynText>
        </TouchableOpacity>
      </View>
      {spans === null ? (
        <DynText style={styles.codeText} numberOfLines={0} selectable>
          {props.code}
        </DynText>
      ) : (
        <DynText style={styles.codeText} numberOfLines={0} selectable>
          {spans.map((span, index) => {
            const color = TOKEN_COLOR[span.kind];
            if (color === undefined) return props.code.slice(span.start, span.end);
            return (
              <DynText key={index} style={{ color }}>
                {props.code.slice(span.start, span.end)}
              </DynText>
            );
          })}
        </DynText>
      )}
    </View>
  );
}

/** Assistant text, rendered through the lightweight markdown grammar. */
export function MarkdownView(props: { text: string; style?: TextStyle }) {
  const blocks = useMemo(() => parseMarkdown(props.text), [props.text]);
  return (
    <View style={[styles.blockStack, props.style]}>
      {blocks.map((block, index) => {
        if (block.kind === "code") {
          return <CodeBlock key={index} code={block.text} lang={block.lang} />;
        }
        if (block.kind === "header") {
          return (
            <InlineLine
              key={index}
              text={block.text}
              style={block.level === 1 ? styles.headerLarge : styles.headerSmall}
            />
          );
        }
        if (block.kind === "bullet") {
          return (
            <View key={index} style={styles.bulletRow}>
              <DynText style={styles.bulletGlyph}>{`${glyph.bullet}  `}</DynText>
              <InlineLine text={block.text} style={styles.prose} />
            </View>
          );
        }
        return (
          <View key={index}>
            {block.text.split("\n").map((line, lineIndex) => (
              <InlineLine key={lineIndex} text={line} style={styles.prose} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  prose: { ...type.body, color: colors.ink },
  bold: { fontWeight: "700" },
  inlineCode: {
    ...type.mono,
    color: colors.ink,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.s,
    paddingHorizontal: space.xxs,
  },
  headerLarge: { ...type.title, color: colors.ink, marginTop: space.xs },
  headerSmall: { ...type.bodyStrong, color: colors.ink, marginTop: space.xs },
  bulletRow: { flexDirection: "row", paddingLeft: space.s },
  bulletGlyph: { ...type.body, color: colors.ink },
  // Uniform micro-rhythm between blocks (§3): headers and code cards add
  // their own margins; this gap only separates adjacent blocks.
  blockStack: { gap: space.xxs },
  codeCard: {
    backgroundColor: colors.surfaceAlt,
    // Nested surface: edge by hairline only — no elevation below the top
    // card level (depth ladder: bg < surface < surfaceAlt).
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    padding: space.s,
    marginTop: space.xs,
    marginBottom: space.xs,
  },
  // A single hairline under the header row separates chrome from code (§3).
  codeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    paddingBottom: space.xs,
    marginBottom: space.xs,
  },
  // Language readout: the §2 system-readout treatment (uppercase + tracking).
  codeLang: {
    ...type.caption,
    color: colors.inkFaint,
    textTransform: "uppercase",
    ...READOUT_STYLE,
    flexShrink: 1,
  },
  // Copy control: the icon mark and the label ride one quiet row.
  codeCopy: { minWidth: 32, flexDirection: "row", alignItems: "center", gap: space.xxs },
  codeCopyText: { ...type.caption, color: colors.inkMute },
  codeText: { ...type.mono, fontFamily: "Menlo", color: colors.ink, marginTop: space.xs },
});
