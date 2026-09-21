import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
