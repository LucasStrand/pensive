import { gh } from "./githubApp.ts";
import type { ReviewResult } from "../pipeline.ts";

interface PostArgs { owner: string; name: string; prNumber: number; token: string; result: ReviewResult; }

// MVP: post the rendered review as a single PR review comment. Inline per-line
// comments are a planned upgrade — findings already carry file+line, so the
// reviews API `comments: [{path, line, side}]` slots in here later.
export async function postReview(a: PostArgs): Promise<void> {
  await gh(a.token, "POST", `/repos/${a.owner}/${a.name}/pulls/${a.prNumber}/reviews`, {
    event: "COMMENT",
    body: a.result.markdown,
  });
}
