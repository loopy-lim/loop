// "Open Loop Agent" pane entrypoint.
//
// Herdr starts first and owns workspaces, panes, and attachment. This plugin
// never creates a workspace or attaches an agent; it only launches `loop` in
// the pane the action was invoked from. argv-only, never a shell.

interface SpawnLike {
  (command: string, args: string[]): void;
}

export function openAgentInvocation(paneId: string): { command: string; args: string[] } {
  return { command: "herdr", args: ["pane", "run", "--pane", paneId, "loop"] };
}

async function main(spawn: SpawnLike = ((command, args) => {
  const child = Bun.spawn([command, ...args], {
    stdio: ["inherit", "inherit", "inherit"],
    stdin: "inherit",
  });
  void child.exited;
}) as SpawnLike): Promise<void> {
  const paneId = process.env.HERDR_PANE_ID;
  if (!paneId) {
    console.error("Open Loop Agent must run inside a Herdr pane (HERDR_PANE_ID missing).");
    process.exit(1);
  }
  const invocation = openAgentInvocation(paneId);
  spawn(invocation.command, invocation.args);
}

const isDirectRun = process.argv[1] && import.meta.path === (await import("node:path")).resolve(process.argv[1]);
if (isDirectRun) {
  await main();
}

export { main as runOpenAgent };
