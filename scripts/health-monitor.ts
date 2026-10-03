/** One read-only health scan for launchd. Never starts workers or resolves attention. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

type FindingState = Record<string, { count: number; alerted: boolean }>;

export function advanceFindings(previous: FindingState, current: readonly string[]): { state: FindingState; alerts: string[] } {
  const state: FindingState = {};
  const alerts: string[] = [];
  for (const key of new Set(current)) {
    const old = previous[key];
    const count = Math.min(2, (old?.count ?? 0) + 1);
    const alerted = old?.alerted === true || count >= 2;
    state[key] = { count, alerted };
    if (count >= 2 && old?.alerted !== true) alerts.push(key);
  }
  return { state, alerts };
}

const repository = resolve(import.meta.dir, '..');
const binary = join(repository, 'dist', 'loop');
const statePath = join(homedir(), '.loop', 'health-monitor', 'state.json');
const defaultDatabases = [
  join(homedir(), '.config', 'loop', 'loop.sqlite'),
  join(homedir(), '.loop', 'gateway', 'loop.db'),
];

function readState(): FindingState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as FindingState;
  } catch { return {}; }
}

function writeState(state: FindingState): void {
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporary, statePath);
}

function scanDatabase(database: string): string[] {
  const result = spawnSync(binary, ['health', '--database', database, '--json'], { encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`health scan failed for ${database}: ${result.error?.message ?? result.stderr.trim()}`);
  const parsed = JSON.parse(result.stdout) as { findings: { runId: string; kind: string }[] };
  return parsed.findings.map(item => `${database}:${item.runId}:${item.kind}`);
}

function notify(count: number): void {
  const message = count === 1 ? '중단 가능성이 있는 작업 1개를 확인하세요.' : `중단 가능성이 있는 작업 ${count}개를 확인하세요.`;
  const result = spawnSync('osascript', ['-e', `display notification "${message}" with title "Loop 상태 점검"`], { encoding: 'utf8', timeout: 5000 });
  if (result.error || result.status !== 0) throw new Error('macOS notification was not delivered');
}

export function runHealthMonitor(): { scanned: number; findings: number; alerted: number } {
  if (!existsSync(binary)) throw new Error('Loop CLI is not built');
  const configured = process.env.LOOP_MONITOR_DATABASE_PATHS?.split(':').filter(Boolean);
  const databases = [...new Set(configured?.length ? configured : defaultDatabases)].filter(existsSync);
  const findings = databases.flatMap(scanDatabase);
  const next = advanceFindings(readState(), findings);
  writeState(next.state);
  if (next.alerts.length > 0) notify(next.alerts.length);
  return { scanned: databases.length, findings: findings.length, alerted: next.alerts.length };
}

if (import.meta.main) {
  try { console.log(JSON.stringify(runHealthMonitor())); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
