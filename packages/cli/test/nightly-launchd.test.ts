import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const installer = resolve(import.meta.dir, "../../../scripts/nightly-launchd-install.sh");

test("nightly LaunchAgent preview schedules one local pass and no immediate run", () => {
  const preview = spawnSync("bash", [installer, "preview", "02:00"], { encoding: "utf8" });
  expect(preview.status).toBe(0);
  expect(preview.stdout).toContain("<key>StartCalendarInterval</key>");
  expect(preview.stdout).toContain("<key>Hour</key><integer>2</integer>");
  expect(preview.stdout).toContain("<key>Minute</key><integer>0</integer>");
  expect(preview.stdout).not.toContain("RunAtLoad");
  expect(preview.stdout).not.toContain("KeepAlive");
  expect(preview.stdout).not.toContain("API_KEY");
  const invalid = spawnSync("bash", [installer, "preview", "25:00"], { encoding: "utf8" });
  expect(invalid.status).toBe(2);
});
