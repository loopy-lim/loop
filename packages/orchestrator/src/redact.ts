export function redact(value: unknown, limit = 16000): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/(?:authorization|proxy-authorization)\s*["']?\s*[:=]\s*["']?[^\r\n,"'}]+/gi, "[authorization]=[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:api[_-]?key|token|authorization|password|secret)\s*["']?\s*[:=]\s*["']?[^\s,"'}]+/gi, "[credential]=[redacted]")
    .slice(-limit);
}
