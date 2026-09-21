import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const library = process.platform === "darwin"
  ? "libloop_bridge.dylib"
  : process.platform === "win32"
    ? "loop_bridge.dll"
    : "libloop_bridge.so";
const profile = process.argv[2] === "release" ? "release" : "debug";
const root = resolve(import.meta.dir, "..");
mkdirSync(resolve(root, "dist"), { recursive: true });
copyFileSync(
  resolve(root, "target", profile, library),
  resolve(root, "dist", library),
);
