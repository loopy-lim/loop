import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionCollector } from "../packages/gateway/src/session-collector";
import { SessionEventLog } from "../packages/gateway/src/session-events";

test("a second gateway cannot remove the first gateway's live tap socket", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-session-"));
  const socket = join(directory, "tap.sock");
  const first = new SessionCollector({ log: new SessionEventLog(1, 32), socketPath: socket });
  const second = new SessionCollector({ log: new SessionEventLog(2, 32), socketPath: socket });
  try {
    first.start();
    expect(() => second.start()).toThrow("Session socket already exists");
    expect(existsSync(socket)).toBe(true);
    const connection = await Bun.connect({
      unix: socket,
      socket: { data() {}, open(socket) { socket.end(); }, error() {} },
    });
    expect(connection).toBeDefined();
  } finally {
    second.stop();
    first.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
