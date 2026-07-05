import { selectGateway } from "../model/select.ts";
import { review } from "../pipeline.ts";
import { installationToken } from "./githubApp.ts";
import { syncRepo } from "./repo.ts";
import { postReviewing, postReview, postError, postDraft } from "./post.ts";
import { startCheckRun, completeCheckRun } from "./checks.ts";
import { lastReviewed, markReviewed } from "./state.ts";

// Review on open, on new pushes, on reopen, and when a draft is marked ready.
const ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

// Hard ceiling on a single review. A model call that hangs would otherwise pin the
// check on in_progress AND block the serial queue for every other PR — the exact
// "stuck waiting" failure we're guarding against. On timeout we throw → the catch
// path completes the check as failure and the next push retries.
const REVIEW_TIMEOUT_MS = parseInt(process.env.PENSIVE_REVIEW_TIMEOUT_MS ?? "600000", 10);

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export interface HandleOutcome { status: string; detail?: string; }

export async function handleEvent(event: string, payload: any): Promise<HandleOutcome> {
  if (event === "ping") return { status: "pong" };
  if (event !== "pull_request") return { status: "skipped", detail: `event:${event}` };

  const action = payload.action as string;
  if (!ACTIONS.has(action)) return { status: "skipped", detail: `action:${action}` };

  const pr = payload.pull_request;
  const repo = payload.repository;
  const owner = repo.owner.login as string;
  const name = repo.name as string;
  const prNumber = pr.number as number;
  const head = pr.head.sha as string;
  const base = pr.base.sha as string;
  const key = `${owner}/${name}#${prNumber}`;

  const installationId = payload.installation?.id as number | undefined;
  if (!installationId) return { status: "error", detail: "no installation id on payload" };

  const token = await installationToken(installationId);
  const target = { owner, name, prNumber, token };

  // Draft: say so on the PR instead of going silent, then wait for ready_for_review.
  if (pr.draft) { await postDraft(target, head).catch(() => {}); return { status: "skipped", detail: "draft" }; }

  // Same SHA already reviewed (webhook redelivery / duplicate event): the sticky
  // comment already shows that review's result, so leave it untouched.
  if (lastReviewed(key) === head) return { status: "skipped", detail: "already-reviewed-sha" };

  // Mark "reviewing" up front (best-effort) so the PR shows the review is in
  // flight before the slow clone + model passes — a failed marker post must not
  // abort the actual review.
  await postReviewing(target, head).catch(() => {});

  // Open the machine-readable in_progress check NEXT to the human comment, so other
  // agents/bots see a review is in flight and don't conclude the PR. Best-effort: if
  // the App lacks "Checks: write" we get null and simply skip checks (never a stuck
  // in_progress). The check is completed on EVERY exit below — that's what releases
  // anything waiting on it.
  const checkId = await startCheckRun(target, head).catch(() => null);

  try {
    const dir = syncRepo({ owner, name, token, prNumber, baseRef: pr.base.ref });
    const gw = selectGateway();
    const result = await withTimeout(review(gw, {
      mode: "range", base, head, cwd: dir,
      title: pr.title, description: pr.body ?? undefined,
      source: { provider: "github", repo: `${owner}/${name}`, pr: prNumber, author: pr.user?.login ?? null, head, base },
    }), REVIEW_TIMEOUT_MS, `review of ${key}`);

    await postReview(target, result);
    await completeCheckRun(target, checkId, "success",
      `Reviewed — ${result.findings.length} finding(s)`,
      `Pensive reviewed \`${head.slice(0, 7)}\`: ${result.findings.length} finding(s)${result.bravo ? ", bravo 👏" : ""}.`,
    ).catch(() => {});
    markReviewed(key, head); // only after a posted review — a failure must stay retryable
    return { status: "reviewed", detail: `${key} — ${result.findings.length} finding(s), bravo:${result.bravo ? "yes" : "no"}` };
  } catch (e: any) {
    // Don't leave the comment OR the check stuck on "Reviewing…"; surface the failure
    // and let the next push retry (note: we deliberately did NOT markReviewed above).
    await postError(target, head).catch(() => {});
    await completeCheckRun(target, checkId, "failure", "Review failed",
      `Pensive failed to review \`${head.slice(0, 7)}\` — will retry on the next push.`).catch(() => {});
    return { status: "error", detail: `${key} — ${e?.message ?? e}` };
  }
}
