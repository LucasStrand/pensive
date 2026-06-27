import { selectGateway } from "../model/select.ts";
import { review } from "../pipeline.ts";
import { installationToken } from "./githubApp.ts";
import { syncRepo } from "./repo.ts";
import { postReview } from "./post.ts";
import { lastReviewed, markReviewed } from "./state.ts";

// Review on open, on new pushes, on reopen, and when a draft is marked ready.
const ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

export interface HandleOutcome { status: string; detail?: string; }

export async function handleEvent(event: string, payload: any): Promise<HandleOutcome> {
  if (event === "ping") return { status: "pong" };
  if (event !== "pull_request") return { status: "skipped", detail: `event:${event}` };

  const action = payload.action as string;
  if (!ACTIONS.has(action)) return { status: "skipped", detail: `action:${action}` };

  const pr = payload.pull_request;
  if (pr.draft) return { status: "skipped", detail: "draft" };

  const repo = payload.repository;
  const owner = repo.owner.login as string;
  const name = repo.name as string;
  const prNumber = pr.number as number;
  const head = pr.head.sha as string;
  const base = pr.base.sha as string;
  const key = `${owner}/${name}#${prNumber}`;

  if (lastReviewed(key) === head) return { status: "skipped", detail: "already-reviewed-sha" };

  const installationId = payload.installation?.id as number | undefined;
  if (!installationId) return { status: "error", detail: "no installation id on payload" };

  const token = await installationToken(installationId);
  const dir = syncRepo({ owner, name, token, prNumber, baseRef: pr.base.ref });

  const gw = selectGateway();
  const result = await review(gw, {
    mode: "range", base, head, cwd: dir,
    title: pr.title, description: pr.body ?? undefined,
  });

  await postReview({ owner, name, prNumber, token, result });
  markReviewed(key, head);
  return { status: "reviewed", detail: `${key} — ${result.findings.length} finding(s), bravo:${result.bravo ? "yes" : "no"}` };
}
