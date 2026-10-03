import { expect, test } from "bun:test";
import { NodeHerdrRunner } from "../src/client";

test("an unresponsive Herdr command has a deadline even when SIGTERM is ignored", async () => {
  const runner = new NodeHerdrRunner({ timeoutMs: 60, cancelGraceMs: 20 });
  const result = await runner.run(process.execPath, [
    "-e",
    "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 500);",
  ]);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("timed out");
});

test("a normal Herdr reply is returned without waiting for the deadline", async () => {
  const runner = new NodeHerdrRunner({ timeoutMs: 2000 });
  const result = await runner.run(process.execPath, [
    "-e",
    "console.log(JSON.stringify({ok:true}))",
  ]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ ok: true });
});
