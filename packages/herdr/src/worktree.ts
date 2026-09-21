import { isAbsolute, relative } from "node:path";

export function assertWorktreeInsideProject(projectRoot: string, worktree: string): void {
  if (!isAbsolute(projectRoot) || !isAbsolute(worktree)) {
    throw new Error("project and worktree paths must be absolute");
  }
  const path = relative(projectRoot, worktree);
  if (path.startsWith("..") || isAbsolute(path)) {
    throw new Error("worktree must remain inside the project");
  }
}
