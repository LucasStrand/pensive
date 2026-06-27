import { gh } from "./githubApp.ts";
import type { ReviewResult } from "../pipeline.ts";

// One sticky status comment per PR. A hidden marker lets us find and EDIT our own
// comment in place across the review lifecycle (reviewing → result / error),
// instead of stacking a fresh comment on every push. This is also why we use the
// issue-comments API rather than the reviews API: review comments can't be edited.
const MARKER = "<!-- pensive:status -->";

export interface Target { owner: string; name: string; prNumber: number; token: string; }

async function findStatusComment(t: Target): Promise<number | null> {
  // PRs rarely exceed a page of comments; if ours ever lands past page 1 we just
  // create a new one (acceptable for the MVP — see post.ts header).
  const comments = (await gh(t.token, "GET",
    `/repos/${t.owner}/${t.name}/issues/${t.prNumber}/comments?per_page=100`)) as Array<{ id: number; body?: string }>;
  const mine = comments.filter((c) => c.body?.includes(MARKER));
  return mine.length ? mine[mine.length - 1].id : null; // newest wins if duplicates ever slipped in
}

// Create the status comment, or edit it in place if it already exists.
async function upsertStatus(t: Target, body: string): Promise<void> {
  const withMarker = `${body}\n\n${MARKER}`;
  const id = await findStatusComment(t);
  if (id == null) {
    await gh(t.token, "POST", `/repos/${t.owner}/${t.name}/issues/${t.prNumber}/comments`, { body: withMarker });
  } else {
    await gh(t.token, "PATCH", `/repos/${t.owner}/${t.name}/issues/comments/${id}`, { body: withMarker });
  }
}

const sha = (s: string) => s.slice(0, 7);

// Posted up front, before the slow clone + model passes, so the PR clearly shows
// the review is in flight rather than leaving the reader guessing.
export function postReviewing(t: Target, head: string): Promise<void> {
  return upsertStatus(t, `## 🔎 Pensive\n\n⏳ Reviewing \`${sha(head)}\`…`);
}

export function postReview(t: Target, result: ReviewResult): Promise<void> {
  return upsertStatus(t, result.markdown);
}

// Draft PRs aren't reviewed yet — say so, so the PR is never silently blank.
export function postDraft(t: Target, head: string): Promise<void> {
  return upsertStatus(t, `## 🔎 Pensive\n\n💤 Draft — \`${sha(head)}\` will be reviewed when marked ready for review.`);
}

// Surface a failure instead of leaving the comment stuck on "Reviewing…".
export function postError(t: Target, head: string): Promise<void> {
  return upsertStatus(t, `## 🔎 Pensive\n\n⚠️ Review of \`${sha(head)}\` failed — will retry on the next push.`);
}
