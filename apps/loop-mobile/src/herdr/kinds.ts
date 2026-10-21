/**
 * Agent kind display names. herdr's integration inventory carries official
 * labels; detected panes without an integration row fall back to this map
 * and then to the raw kind (which is already a sane identifier).
 */

const KIND_LABELS: Readonly<Record<string, string>> = {
  pi: "Pi",
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  cursor: "Cursor",
  devin: "Devin",
  agy: "Antigravity",
  cline: "Cline",
  omp: "OMP",
  mastracode: "Mastracode",
  opencode: "OpenCode",
  copilot: "Copilot",
  kimi: "Kimi",
  kiro: "Kiro",
  droid: "Droid",
  amp: "Amp",
  grok: "Grok",
  hermes: "Hermes",
  kilo: "Kilo",
  qodercli: "Qoder",
  qwen: "Qwen Code",
  letta: "Letta",
  maki: "Maki",
  muse: "Muse Code",
};

export function kindLabel(kind: string | null): string {
  if (kind === null) return "";
  return KIND_LABELS[kind] ?? kind;
}
