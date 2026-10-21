/**
 * TerminalText — the one ANSI rendering surface (rebuild brief §5): parse
 * runs once per text change and render them as nested RN <Text> spans in a
 * monospace parent. The run budget in ansi.ts bounds the tree; very large
 * bodies are rendered from their tail only (a transcript is read from the
 * bottom).
 */

import { useMemo } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { ansiColorHex, parseAnsi } from "./ansi";
import { colors, type as typeScale } from "../ui/tokens";

/** Render budget in characters: beyond this, only the tail is rendered. */
const MAX_RENDER_CHARS = 120_000;

export function TerminalText(props: { text: string; style?: StyleProp<TextStyle> }) {
  const text = props.text.length > MAX_RENDER_CHARS ? props.text.slice(-MAX_RENDER_CHARS) : props.text;
  const runs = useMemo(() => parseAnsi(text), [text]);
  return (
    <Text style={[styles.mono, props.style]} selectable>
      {runs.map((run, index) => (
        <Text
          key={index}
          style={[
            run.bold && styles.bold,
            run.italic && styles.italic,
            run.underline && styles.underline,
            run.dim && styles.dim,
            run.fg !== null && { color: ansiColorHex(run.fg) },
            (run.inverse || run.bg !== null) && {
              backgroundColor: run.inverse
                ? run.fg !== null
                  ? ansiColorHex(run.fg)
                  : colors.ink
                : run.bg !== null
                  ? ansiColorHex(run.bg)
                  : colors.ink,
            },
            run.inverse && { color: colors.bg },
          ]}
        >
          {run.text}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  mono: {
    ...typeScale.mono,
    color: colors.ink,
    fontFamily: "Menlo",
  },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  underline: { textDecorationLine: "underline" },
  dim: { opacity: 0.55 },
});
