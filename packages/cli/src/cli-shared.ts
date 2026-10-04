import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

import { ConfigError } from "@loop/orchestrator/config";

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface ProbeResult {
  exitCode: number;
  output: string;
}

export interface InteractiveLeadInvocation {
  command: string;
  args: string[];
  cwd: string;
  configDirectory?: string;
}

export interface RunCliOptions {
  io?: CliIo;
  probe?: (command: string, args: string[]) => Promise<ProbeResult>;
  leadRunner?: (input: InteractiveLeadInvocation) => Promise<number>;
  executablePath?: string;
  stdin?: string;
  providers?: import("@loop/providers").ProviderRegistry;
  nightlyLaunch?: (runId: string, cwd: string) => Promise<void>;
}

export const defaultIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export class UsageError extends Error {}

export function bounded(value: string): string {
  return value.slice(-4_000);
}

export function redact(value: string): string {
  return bounded(
    value
      .replace(
        /(?:authorization|proxy-authorization)\s*["']?\s*[:=]\s*["']?[^\r\n,"'}]+/gi,
        "[authorization]=[redacted]",
      )
      .replace(
        /(?:api[_-]?key|token|authorization|password)\s*[:=]\s*\S+/gi,
        "[credential]=[redacted]",
      ),
  );
}

export function print(value: unknown, json: boolean, io: CliIo): void {
  if (json) io.stdout(`${JSON.stringify(value)}\n`);
  else io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

export function probeCommand(command: string, args: string[]): Promise<ProbeResult> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output = bounded(output + String(chunk))));
    child.stderr.on("data", (chunk) => (output = bounded(output + String(chunk))));
    child.on("error", (error) => resolveResult({ exitCode: 1, output: error.message }));
    child.on("close", (code) => resolveResult({ exitCode: code ?? 1, output }));
  });
}

export async function loadProtocol(): Promise<typeof import("@loop/protocol")> {
  prepareBridgeEnvironment();
  return import("@loop/protocol");
}

function prepareBridgeEnvironment(): void {
  if (process.env.RUSTRA_BUN_LIBRARY) return;
  const library =
    process.platform === "darwin"
      ? "libloop_bridge.dylib"
      : process.platform === "win32"
        ? "loop_bridge.dll"
        : "libloop_bridge.so";
  const adjacent = join(dirname(process.execPath), library);
  if (existsSync(adjacent)) process.env.RUSTRA_BUN_LIBRARY = adjacent;
}

/** Maps a thrown error to the CLI's stable exit-code contract. */
export function handleCliError(error: unknown, io: CliIo): number {
  if (error instanceof UsageError) {
    io.stderr(`${error.message}\n`);
    return 2;
  }
  if (error instanceof ConfigError) {
    io.stderr(`${error.code}: ${error.message}\n`);
    return 78;
  }
  io.stderr(`${redact(error instanceof Error ? error.message : String(error))}\n`);
  return 1;
}

export function help(): string {
  return `Loop — dependency-aware engineering scheduler

Usage:
  loop                                Start the interactive Loop agent in this terminal
  loop doctor [--auth] [--json]
  loop runs [--json]                Find persisted runs after reopening
  loop nightly [--dry-run|--execute] [--json]  Resume eligible unfinished runs once
  loop status [run-id] [--json]
  loop graph <run-id>
  loop workers <run-id>
  loop attention <run-id>
  loop models [--json]
  loop pair [--host <tailscale-host>] [--json]
                                    Print the loop:// pairing URL and QR; spawns the gateway daemon first when none is running
  loop gateway status [--json]      Show whether the Loop gateway daemon is running
  loop gateway stop                Gracefully stop the gateway daemon loop started; stale pid records are cleaned up
  loop cancel <run-id>
  loop pause <run-id>               Finish active tasks, stop scheduling
  loop resume <run-id>              Continue the saved graph in the background
  loop watch [run-id] [--json]
  loop health [--json]             Check unfinished runs for missing execution owners
  loop reconcile <run-id> <task-id> stopped  Confirm an orphaned task stopped before retrying
  loop task <run-id> <task-id>       Show context, results and verification evidence
  loop guidance <run-id> <task-id>   Show recorded, delivered, and post-delivery checked guidance
  loop goal-ledger <run-id>          Show the goal criterion ledger with owning tasks, check evidence, and steer provenance
  loop add-task <run-id> --json      Read TaskSpecInput JSON from stdin and add it atomically
  loop add-goal-task <run-id> --json Read task and criteria JSON from stdin and add them atomically
  loop promote-steer <run-id> --json  Read message, dependent task, and criteria JSON from stdin and promote them atomically
  loop steer <run-id> <task-id|all> <message>
  loop resolve <run-id> <attention-id> <approved|retry|cancel|answer>
  loop cleanup [run-id] [--execute] [--keep <N>]
  loop benchmark run <config-path>    Compare workflow profiles (see config/persona-benchmark.example.toml)
  loop benchmark agents <manifest.json>  Compare configured agents on one clean Git commit
  loop run <intent>                 Start the interactive Loop agent with an initial request
  loop verify-install [--json]      Run the offline fake-provider acceptance

Options:
  --config <directory>              Configuration directory
  --database <path>                 SQLite database path
  --json                            Machine-readable output
  --auth                            Check native auth stores without exposing credentials
  --execute                         Actually delete artifacts (cleanup command)
  --dry-run                         Preview deletion without executing (default for cleanup)
  --keep <N>                        Keep the most recent <N> artifacts (default: 10)
`;
}
