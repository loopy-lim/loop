import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import type { InteractiveLeadInvocation } from "./cli-shared";
import { configuration, type ParsedArguments } from "./args";

export async function startInteractiveLead(
  intent: string,
  parsed: ParsedArguments,
  runner: (input: InteractiveLeadInvocation) => Promise<number>,
  executablePath: string,
): Promise<number> {
  const config = configuration(parsed);
  return runner(
    buildInteractiveLeadInvocation({
      command: config.lead.command,
      provider: config.lead.provider,
      model: config.lead.model,
      intent,
      cwd: process.cwd(),
      executablePath,
      environment: process.env,
      configDirectory: config.configDirectory,
    }),
  );
}

export function buildInteractiveLeadInvocation(input: {
  command: string;
  provider: string;
  model: string;
  intent: string;
  cwd: string;
  executablePath: string;
  environment: Record<string, string | undefined>;
  configDirectory?: string;
}): InteractiveLeadInvocation {
  const adjacentExtension = join(dirname(input.executablePath), "loop-pi-extension.js");
  const developmentExtension = resolve(import.meta.dir, "../../../dist/loop-pi-extension.js");
  const extension =
    input.environment.LOOP_PI_EXTENSION ||
    (basename(input.executablePath) === "loop" ? adjacentExtension : developmentExtension);
  const args = [
    "--no-extensions",
    "--extension",
    extension,
    "--provider",
    input.provider,
    "--model",
    input.model,
  ];
  if (input.intent.trim()) args.push("--", input.intent.trim());
  return { command: input.command, args, cwd: input.cwd, configDirectory: input.configDirectory };
}

export function runInteractiveLead(input: InteractiveLeadInvocation): Promise<number> {
  return new Promise((fulfil, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.configDirectory
        ? { ...process.env, LOOP_CONFIG_DIR: input.configDirectory }
        : process.env,
      shell: false,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => fulfil(code ?? 1));
  });
}
