import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPOS_DIR } from "./paths.ts";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

interface SyncArgs { owner: string; name: string; token: string; prNumber: number; baseRef: string; }

// Ensure a local checkout exists with both the PR head and base commits present,
// so the pipeline's `range` diff (base...head) can run against real repo files —
// which is what lets the linters/context judge against the repo's own conventions.
export function syncRepo(a: SyncArgs): string {
  const dir = join(REPOS_DIR, a.owner, a.name);
  const url = `https://x-access-token:${a.token}@github.com/${a.owner}/${a.name}.git`;
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true });
    git(REPOS_DIR, ["clone", "--no-tags", url, dir]);
  }
  // refresh the embedded token each run (installation tokens rotate hourly)
  git(dir, ["remote", "set-url", "origin", url]);
  git(dir, [
    "fetch", "--no-tags", "--force", "origin",
    `+refs/heads/${a.baseRef}:refs/remotes/origin/${a.baseRef}`,
    `+refs/pull/${a.prNumber}/head:refs/pensive/pr/${a.prNumber}`,
  ]);
  return dir;
}
