export function redactProviderText(value: string, limit = 4_000): string {
  return value
    .replace(
      /(?:--)?(?:api[_-]?key|token|authorization|password)\s*["']?\s*(?:[:=]\s*["']?|\s+)(?:(?:basic|bearer)\s+)?[^\s,;}"']+/gi,
      "[credential]=[redacted]",
    )
    .replace(/\bbearer\s+[^\s,;}"']+/gi, "[credential]=[redacted]")
    .slice(0, limit);
}
