export function normalizeLabel(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\S+/g, (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase());
}
