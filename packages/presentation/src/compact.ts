export interface OutputLimits {
  statusLineLimit: number;
  attentionLineLimit: number;
  findingsLineLimit: number;
  listLineLimit: number;
  lineTextLimit: number;
}

export interface CompactLinesOptions {
  lineLimit: number;
  lineTextLimit: number;
  overflow(omitted: number): string;
}

export interface CompactedItems<T> {
  items: T[];
  omitted: number;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function singleLine(value: string, limit: number): string {
  const normalized = value.replace(/\r\n?|\n/g, " ");
  const graphemes = [...graphemeSegmenter.segment(normalized)].map((part) => part.segment);
  if (graphemes.length <= limit) return normalized;
  if (limit === 1) return "…";
  return `${graphemes.slice(0, limit - 1).join("")}…`;
}

export function compactLines(lines: string[], options: CompactLinesOptions): string[] {
  const compacted = compactItems(lines, options.lineLimit);
  const visible = compacted.items.map((line) => singleLine(line, options.lineTextLimit));
  if (compacted.omitted === 0) return visible;
  return [
    ...visible,
    singleLine(options.overflow(compacted.omitted), options.lineTextLimit),
  ];
}

export function compactItems<T>(items: T[], lineLimit: number): CompactedItems<T> {
  if (items.length <= lineLimit) return { items: [...items], omitted: 0 };
  const visibleCount = Math.max(0, lineLimit - 1);
  return {
    items: items.slice(0, visibleCount),
    omitted: items.length - visibleCount,
  };
}
