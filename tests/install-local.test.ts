import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dir, "..");

test("local install keeps the Loop extension adjacent and links the Herdr agent plugin", () => {
  const script = readFileSync(resolve(root, "scripts/install-local.sh"), "utf8");

  expect(script).toContain('"$bin_dir/loop-pi-extension.js"');
  expect(script).toContain('legacy_pi_extension_dir="$user_home/.pi/agent/extensions/loop"');
  expect(script).toContain('herdr plugin link "$repo_root/plugins/loop-agent" --enabled');
  expect(script).not.toContain('pi_extension_dir=${LOOP_PI_EXTENSION_DIR');
  expect(script).not.toContain('"$pi_extension_dir/index.js"');
});

test("the adjacent Pi extension bundle has no external runtime dependency", () => {
  const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  expect(rootPackage.scripts["build:pi"]).not.toContain("--external typebox");
});

test("the Node-targeted Pi extension loads without Bun globals", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-pi-node-bundle-"));
  try {
    const build = await Bun.build({
      entrypoints: [resolve(root, "packages/pi-loop/src/extension.ts")],
      naming: "loop-pi-extension.js",
      outdir: directory,
      target: "node",
    });
    expect(build.success).toBe(true);

    const bundleUrl = pathToFileURL(join(directory, "loop-pi-extension.js")).href;
    const probe = [
      `const extension = await import(${JSON.stringify(bundleUrl)});`,
      "const noop = () => {};",
      "extension.default({ registerCommand: noop, registerTool: noop, on: noop });",
    ].join("\n");
    const loaded = spawnSync("node", ["--input-type=module", "-e", probe], {
      encoding: "utf8",
      env: { ...process.env, LOOP_CONFIG_DIR: resolve(root, "config") },
    });

    expect(loaded.stderr).toBe("");
    expect(loaded.status).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
