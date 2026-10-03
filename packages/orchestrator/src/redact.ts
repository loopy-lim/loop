export function redact(value: unknown, limit = 16000): string {
  const text = value instanceof Error ? value.message : String(value);
  let safe = text
    .replace(
      /(?:authorization|proxy-authorization)\s*["']?\s*[:=]\s*["']?[^\r\n,"'}]+/gi,
      "[authorization]=[redacted]",
    )
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /(?:api[_-]?key|token|authorization|password|secret)\s*["']?\s*[:=]\s*["']?[^\s,"'}]+/gi,
      "[credential]=[redacted]",
    );
  for (const [name, secret] of Object.entries(process.env)) {
    if (
      !/(?:^|_)(?:API_KEY|TOKEN|PASSWORD|SECRET|AUTH_TOKEN|ACCESS_KEY|PRIVATE_KEY)(?:$|_)/i.test(
        name,
      )
    )
      continue;
    if (secret && secret.length >= 8) safe = safe.split(secret).join("[redacted]");
  }
  return safe.slice(-limit);
}
