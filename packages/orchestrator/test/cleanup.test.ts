import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as protocol from "@loop/protocol";
import { ProviderRegistry, FakeProvider } from "@loop/providers";
import type { HerdrWorkerRuntime, CloseWorkspaceResult } from "@loop/herdr";
import { Orchestrator } from "../src/coordinator";

class FakeHerdr implements Partial<HerdrWorkerRuntime> {
  closedWorkspaces: string[] = [];
  closedTabs: string[] = [];
  
  async closeWorkspace(runId: string): Promise<CloseWorkspaceResult> {
    if (runId === "already-gone") {
      return { closed: true, reason: "already_gone" };
    }
    if (runId === "fail") {
      throw new Error("simulated failure");
    }
    this.closedWorkspaces.push(runId);
    return { closed: true };
  }
}

test("cleanupRun purges store, tears down herdr, and removes worktree safely", async () => {
  await protocol.rustra.ready();
  const projectRoot = mkdtempSync(join(tmpdir(), "loop-cleanup-test-"));
  const worktreePath = join(projectRoot, "worktree-1");
  mkdirSync(worktreePath, { recursive: true });
  writeFileSync(join(worktreePath, "file.txt"), "hello");

  const databasePath = join(projectRoot, "loop.sqlite");
  const runId = "test-run";
  await protocol.createRun({ databasePath, runId });
  // Add a task to make the run have a valid structure if needed, then we cancel it to make it terminal.
  await protocol.cancelRun({ databasePath, runId });

  const fakeHerdr = new FakeHerdr() as unknown as HerdrWorkerRuntime;
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new FakeProvider("fake", ["fast"])]),
    maxWorkers: 1,
    herdr: fakeHerdr,
  });

  // Dry run first
  const dryReport = await orchestrator.cleanupRun({
    databasePath,
    runId,
    projectRoot,
    worktree: worktreePath,
    isMerged: true,
    isClean: true,
    dryRun: true,
  });

  expect(dryReport.skippedArtifacts).toBeEmpty();
  expect(dryReport.removedArtifacts).toContain(runId); // store run record
  expect(dryReport.removedArtifacts).toContain(`loop-${runId}`); // herdr surface
  expect(dryReport.removedArtifacts).toContain(worktreePath);
  expect(dryReport.reasons[worktreePath]).toBe("dry_run");

  // Execute
  const executeReport = await orchestrator.cleanupRun({
    databasePath,
    runId,
    projectRoot,
    worktree: worktreePath,
    isMerged: true,
    isClean: true,
    dryRun: false,
  });

  expect(executeReport.skippedArtifacts).toBeEmpty();
  expect(executeReport.removedArtifacts).toContain(runId);
  expect(executeReport.removedArtifacts).toContain(`loop-${runId}`);
  expect(executeReport.removedArtifacts).toContain(worktreePath);
  
  // Verify fake herdr was called
  expect((fakeHerdr as any).closedWorkspaces).toContain(runId);
  
  // Verify worktree is removed
  const { existsSync } = await import("node:fs");
  expect(existsSync(worktreePath)).toBe(false);
});

test("cleanupRun refuses unmerged/dirty worktrees and non-owned surfaces", async () => {
  await protocol.rustra.ready();
  const projectRoot = mkdtempSync(join(tmpdir(), "loop-cleanup-refusal-"));
  const worktreePath = join(projectRoot, "worktree-2");
  mkdirSync(worktreePath, { recursive: true });

  const databasePath = join(projectRoot, "loop.sqlite");
  const runId = "test-refusal";
  await protocol.createRun({ databasePath, runId });
  await protocol.cancelRun({ databasePath, runId });

  const fakeHerdr = new FakeHerdr() as unknown as HerdrWorkerRuntime;
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new FakeProvider("fake", ["fast"])]),
    maxWorkers: 1,
    herdr: fakeHerdr,
  });

  const report = await orchestrator.cleanupRun({
    databasePath,
    runId,
    projectRoot,
    worktree: worktreePath,
    isMerged: false, // Refusal 1
    caller: { workspaceId: "w1", paneId: "w1:p1" }, // Refusal 2
    dryRun: false,
  });

  expect(report.skippedArtifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ artifact: "w1:p1", reason: expect.stringContaining("caller-owned surface cannot be removed") }),
      expect.objectContaining({ artifact: worktreePath, reason: expect.stringContaining("unmerged") })
    ])
  );
  expect(report.removedArtifacts).toContain(runId);
});

test("cleanupRun treats already-gone surfaces as success", async () => {
  await protocol.rustra.ready();
  const projectRoot = mkdtempSync(join(tmpdir(), "loop-cleanup-gone-"));
  const databasePath = join(projectRoot, "loop.sqlite");
  const runId = "already-gone";
  await protocol.createRun({ databasePath, runId });
  await protocol.cancelRun({ databasePath, runId });

  const fakeHerdr = new FakeHerdr() as unknown as HerdrWorkerRuntime;
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new FakeProvider("fake", ["fast"])]),
    maxWorkers: 1,
    herdr: fakeHerdr,
  });

  const report = await orchestrator.cleanupRun({
    databasePath,
    runId,
    projectRoot,
    dryRun: false,
  });

  expect(report.skippedArtifacts).toBeEmpty();
  expect(report.removedArtifacts).toContain(`loop-${runId}`);
  expect(report.reasons[`loop-${runId}`]).toBe("already_gone");
});

test("cleanupRun reports partial failure if herdr fails to close workspace", async () => {
  await protocol.rustra.ready();
  const projectRoot = mkdtempSync(join(tmpdir(), "loop-cleanup-partial-"));
  const worktreePath = join(projectRoot, "worktree-partial");
  mkdirSync(worktreePath, { recursive: true });

  const databasePath = join(projectRoot, "loop.sqlite");
  const runId = "fail";
  await protocol.createRun({ databasePath, runId });
  await protocol.cancelRun({ databasePath, runId });

  const fakeHerdr = new FakeHerdr() as unknown as HerdrWorkerRuntime;
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new FakeProvider("fake", ["fast"])]),
    maxWorkers: 1,
    herdr: fakeHerdr,
  });

  const report = await orchestrator.cleanupRun({
    databasePath,
    runId,
    projectRoot,
    worktree: worktreePath,
    isMerged: true,
    isClean: true,
    dryRun: false,
  });

  // store is purged, worktree is removed, but herdr failed.
  expect(report.removedArtifacts).toContain(runId);
  expect(report.removedArtifacts).toContain(worktreePath);
  expect(report.skippedArtifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        artifact: `loop-${runId}`,
        reason: expect.stringContaining("failed to close surface: simulated failure"),
      })
    ])
  );
});
