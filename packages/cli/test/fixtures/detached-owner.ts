import * as protocol from "@loop/protocol";
import { FakeProvider, ProviderRegistry } from "@loop/providers";
import { Orchestrator } from "@loop/orchestrator";
await protocol.rustra.ready();
const args = Bun.argv.slice(2);
const databasePath = args[args.indexOf("--database") + 1]!;
const runId = args[1]!;
await new Orchestrator({
  control: protocol,
  providers: new ProviderRegistry([new FakeProvider("fake", ["fast"], { delayMs: 500 })]),
  maxWorkers: 2,
}).execute({ databasePath, runId });
