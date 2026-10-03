import { spawnOwner } from "../../src/dispatcher";
import { join } from "node:path";
const child = await spawnOwner({
  executable: process.execPath,
  sourceEntry: join(import.meta.dir, "detached-owner.ts"),
  runId: "detached",
  databasePath: Bun.argv[2]!,
  cwd: process.cwd(),
});
console.log(child.pid);
setInterval(() => {}, 1000);
