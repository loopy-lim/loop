import { expect, test } from "bun:test";
import type { SandboxCapabilityDeclaration } from "@loop/protocol";

import {
  CodexProvider,
  FakeProvider,
  HookedProvider,
  MirroringProvider,
  PiProvider,
  UsageTrackingProvider,
  ZaiApiProvider,
  ZaiCliProvider,
  collectSandboxCapabilities,
  noSandboxDeclaration,
} from "../src";

/** noUncheckedIndexedAccess 아래에서 테스트 배열의 첫/n번째 요소를 좁힌다. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected item ${index} to be defined`);
  return item;
}

test("every adapter declares its sandbox capability honestly (G4a)", async () => {
  const codex = new CodexProvider({ cwd: "/project", computeClasses: ["fast"] });
  const codexDeclaration = await codex.sandboxDeclaration!();
  expect(codexDeclaration.adapterId).toBe("codex");
  expect(codexDeclaration.isolation).toBe("partial");
  expect(codexDeclaration.filesystemScoped).toBe(true);
  expect(codexDeclaration.networkIsolated).toBe(true);
  expect(codexDeclaration.detail).toContain("not a security boundary");

  // Approval mode launches without --sandbox: the declaration downgrades honestly.
  const approvalCodex = new CodexProvider({
    cwd: "/project",
    computeClasses: ["fast"],
    approveForMe: true,
  });
  expect((await approvalCodex.sandboxDeclaration!()).isolation).toBe("none");

  const fullAccess = new CodexProvider({
    cwd: "/project",
    computeClasses: ["fast"],
    sandbox: "danger-full-access",
  });
  expect((await fullAccess.sandboxDeclaration!()).isolation).toBe("none");

  const pi = new PiProvider({ cwd: "/project", computeClasses: ["fast"] });
  const piDeclaration = await pi.sandboxDeclaration!();
  expect(piDeclaration.isolation).toBe("none");
  expect(piDeclaration.filesystemScoped).toBe(false);
  expect(piDeclaration.detail).toContain("advisory");

  const zaiApi = new ZaiApiProvider({
    baseUrl: "https://api.example.com",
    apiKey: "key",
    model: "glm-5",
    mode: "general",
    computeClasses: ["fast"],
  });
  expect((await zaiApi.sandboxDeclaration!()).isolation).toBe("none");

  const zaiCli = new ZaiCliProvider({ cwd: "/project", computeClasses: ["fast"] });
  expect((await zaiCli.sandboxDeclaration!()).isolation).toBe("none");
});

test("collection declares absence as isolation none instead of omitting the adapter (G4a)", () => {
  const fake = new FakeProvider("fake", ["fast"]);
  const bare: { id: string } & Record<string, unknown> = { id: "bare" };
  const collected = collectSandboxCapabilities([fake, bare as never]);
  expect(collected).toHaveLength(2);
  const bareDeclaration = at(collected, 1);
  expect(bareDeclaration.adapterId).toBe("bare");
  expect(bareDeclaration).toEqual(noSandboxDeclaration("bare"));
  expect(bareDeclaration.isolation).toBe("none");
});

test("wrappers forward declarations so composition keeps the honest report", () => {
  const fake = new FakeProvider("fake", ["fast"]);
  const mirror = new MirroringProvider(fake, (workerId, line) => {
    void workerId;
    void line;
  });
  expect(mirror.sandboxDeclaration().isolation).toBe("none");
  expect(mirror.sandboxDeclaration().detail).toContain("fake provider");

  const hooked = new HookedProvider(fake, {
    run: async () => [],
    events: () => [],
    onEvent: () => () => {},
  } as never);
  expect(hooked.sandboxDeclaration().adapterId).toBe("fake");

  const tracking = new UsageTrackingProvider(fake);
  expect(tracking.sandboxDeclaration().adapterId).toBe("fake");
});

test("declaration detail is bounded and trimmed", () => {
  const declaration: SandboxCapabilityDeclaration = noSandboxDeclaration(
    "x",
    `  ${"very long detail".repeat(100)}  `,
  );
  expect(declaration.detail!.length).toBeLessThanOrEqual(300);
  expect(declaration.detail).not.toContain("  very");
});
