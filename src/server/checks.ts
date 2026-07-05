import { gh } from "./githubApp.ts";
import type { Target } from "./post.ts";

// A GitHub Check Run is the MACHINE-READABLE "I'm on it" signal — the thing other
// bots/agents (CodeRabbit, merge queues, CI gates) actually poll. The sticky
// comment in post.ts is for humans; this is for machines. A check that sits in
// `in_progress` tells everyone else "a review is in flight, don't conclude yet";
// flipping it to `completed` is what releases anything waiting on it.
//
// Requires the App to hold the "Checks: Read & write" permission. If it doesn't,
// startCheckRun throws and the caller treats checks as best-effort (no dangling
// in_progress is ever created, so nothing can wait forever on a missing perm).
const CHECK_NAME = "pensive";

export type CheckConclusion = "success" | "failure" | "neutral";

// Open an in_progress check on the head commit. Returns the check-run id needed
// to complete it later, or null if we couldn't open one (missing perm, etc.) —
// null means "no check exists", so completeCheckRun becomes a safe no-op.
export async function startCheckRun(t: Target, head: string): Promise<number | null> {
  const startedAt = new Date().toISOString();
  const res = (await gh(t.token, "POST", `/repos/${t.owner}/${t.name}/check-runs`, {
    name: CHECK_NAME,
    head_sha: head,
    status: "in_progress",
    started_at: startedAt,
    output: { title: "Reviewing…", summary: "Pensive is reviewing this commit." },
  })) as { id: number };
  return res.id;
}

// Close the check out. MUST be called on BOTH the success and failure paths so no
// agent is left waiting on an in_progress check. Best-effort + retried: a dangling
// in_progress is the one outcome we must avoid, so we try twice before giving up.
export async function completeCheckRun(
  t: Target,
  id: number | null,
  conclusion: CheckConclusion,
  title: string,
  summary: string,
): Promise<void> {
  if (id == null) return; // nothing was opened — nothing to close
  const body = {
    status: "completed" as const,
    conclusion,
    completed_at: new Date().toISOString(),
    output: { title, summary },
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await gh(t.token, "PATCH", `/repos/${t.owner}/${t.name}/check-runs/${id}`, body);
      return;
    } catch (e: any) {
      if (attempt === 2) {
        // Loud on purpose: a stuck in_progress check is exactly the "agents wait
        // forever" failure we're guarding against — it needs to be visible in logs.
        console.error(`[checks] FAILED to complete check ${id} on ${t.owner}/${t.name} — it may be stuck in_progress:`, e?.message ?? e);
        return;
      }
    }
  }
}
