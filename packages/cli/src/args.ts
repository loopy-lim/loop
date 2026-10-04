import { loadLoopConfig, type LoopConfig } from "@loop/orchestrator/config";

import { UsageError } from "./cli-shared";

export interface ParsedArguments {
  command?: string;
  operands: string[];
  configDirectory?: string;
  databasePath?: string;
  json: boolean;
  stream: boolean;
  detach: boolean;
  auth: boolean;
  host?: string;
  help: boolean;
  execute: boolean;
  dryRun: boolean;
  keep?: number;
}

export function parse(argv: string[]): ParsedArguments {
  const operands: string[] = [];
  let configDirectory: string | undefined;
  let databasePath: string | undefined;
  let json = false;
  let stream = false;
  let detach = false;
  let auth = false;
  let host: string | undefined;
  let helpRequested = false;
  let execute = false;
  let dryRun = true;
  let keep: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) break; // index < argv.length 가 범위를 보장한다
    if (argument === "--help" || argument === "-h") {
      helpRequested = true;
    } else if (argument === "--json") {
      json = true;
    } else if (argument === "--stream") {
      stream = true;
    } else if (argument === "--detach") {
      detach = true;
    } else if (argument === "--auth") {
      auth = true;
    } else if (argument === "--host") {
      const value = argv[index + 1];
      if (!value) throw new UsageError(`${argument} requires a value`);
      host = value;
      index += 1;
    } else if (argument === "--execute") {
      execute = true;
      dryRun = false;
    } else if (argument === "--dry-run") {
      dryRun = true;
      execute = false;
    } else if (argument === "--keep") {
      const value = argv[index + 1];
      if (!value) throw new UsageError(`${argument} requires a value`);
      keep = parseInt(value, 10);
      if (isNaN(keep)) throw new UsageError(`${argument} must be a number`);
      index += 1;
    } else if (argument === "--config" || argument === "--database") {
      const value = argv[index + 1];
      if (!value) throw new UsageError(`${argument} requires a value`);
      if (argument === "--config") configDirectory = value;
      else databasePath = value;
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new UsageError(`unknown option: ${argument}`);
    } else {
      operands.push(argument);
    }
  }
  return {
    command: operands.shift(),
    operands,
    configDirectory,
    databasePath,
    json,
    stream,
    detach,
    auth,
    host,
    help: helpRequested,
    execute,
    dryRun,
    keep,
  };
}

export function configuration(parsed: ParsedArguments): LoopConfig {
  return loadLoopConfig({
    configDirectory: parsed.configDirectory,
    databasePath: parsed.databasePath,
  });
}
