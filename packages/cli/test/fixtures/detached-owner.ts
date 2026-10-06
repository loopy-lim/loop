import * as protocol from "@loop/protocol";
import { FakeProvider, ProviderRegistry } from "@loop/providers";
import { Orchestrator } from "@loop/orchestrator";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}
await protocol.rustra.ready();
const args = Bun.argv.slice(2);
const databasePath = must(args[args.indexOf("--database") + 1]);
const runId = must(args[1]);
await new Orchestrator({
  control: protocol,
  providers: new ProviderRegistry([new FakeProvider("fake", ["fast"], { delayMs: 500 })]),
  maxWorkers: 2,
}).execute({ databasePath, runId });
