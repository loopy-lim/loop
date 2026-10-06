import { spawnOwner } from "../../src/dispatcher";
import { join } from "node:path";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}
const child = await spawnOwner({
  executable: process.execPath,
  sourceEntry: join(import.meta.dir, "detached-owner.ts"),
  runId: "detached",
  databasePath: must(Bun.argv[2]),
  cwd: process.cwd(),
});
console.log(child.pid);
setInterval(() => {}, 1000);
