import { execFileSync } from "node:child_process";
import type { ModelGateway } from "./model/gateway.ts";
import { getDiff, type DiffSet, type DiffMode } from "./ingest/diff.ts";
import { reconstructIntent } from "./intent.ts";
import { runLinters } from "./deterministic/linters.ts";
import { retrieveContext } from "./context/retrieve.ts";
import { generateFindings } from "./findings/generate.ts";
import { judgeFindings } from "./findings/judge.ts";
import { applyBudget } from "./findings/budget.ts";
import { nominateBravo } from "./standout/nominate.ts";
import { loadLedger, saveLedger, recordFindings, recordRun, appendRunLog, canPraise, spendPraise, hashFinding } from "./ledger/store.ts";
import { renderReview } from "./render/markdown.ts";
import type { Finding, Intent, Bravo } from "./schema.ts";

export interface ReviewOptions {
  mode?: DiffMode; base?: string; head?: string; diffFile?: string; cwd?: string;
  title?: string; description?: string; passes?: number; maxComments?: number;
}
export interface ReviewResult { markdown: string; intent: Intent; findings: Finding[]; bravo: Bravo | null; diff: DiffSet; }

function commitContext(diff: DiffSet, opts: ReviewOptions): string | undefined {
  if (opts.description) return opts.description;
  if (diff.mode !== "range") return undefined;
  try {
    const log = execFileSync("git", ["log", `${opts.base ?? "HEAD~1"}..${opts.head ?? "HEAD"}`, "--format=%s"],
      { cwd: diff.repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return log ? `Commit messages in range:\n${log}` : undefined;
  } catch { return undefined; }
}

export async function review(gw: ModelGateway, opts: ReviewOptions): Promise<ReviewResult> {
  const passes = opts.passes ?? 3;
  const diff = getDiff(opts);

  if (diff.files.length === 0) {
    const intent: Intent = { clear: true, statement: "No reviewable changes.", concerns: [] };
    const markdown = renderReview({ intent, findings: [], bravo: null, meta: { passes: 0, toolsRun: [], toolsMissing: [], dropped: 0, gateway: gw.name, files: 0 } });
    return { markdown, intent, findings: [], bravo: null, diff };
  }

  const det = runLinters(diff);
  const ctx = retrieveContext(diff);
  const intent = await reconstructIntent(gw, diff, { title: opts.title, description: commitContext(diff, opts) });

  const [rawFindings, bravoCandidate] = await Promise.all([
    generateFindings(gw, diff, intent, ctx, det, passes),
    nominateBravo(gw, diff),
  ]);

  const judged = await judgeFindings(gw, rawFindings, ctx);
  const { kept, dropped } = applyBudget(judged, opts.maxComments ?? 5);

  const ledger = loadLedger(diff.repoRoot);
  ledger.runs += 1;
  let bravo: Bravo | null = null;
  if (bravoCandidate && canPraise(ledger, bravoCandidate.author)) { bravo = bravoCandidate; spendPraise(ledger, bravo.author); }

  const downgraded = kept.filter((f) => (f.severity === "bug" || f.severity === "critical") && f.confidence < 0.7).length;
  recordFindings(ledger, kept, ledger.runs);
  recordRun(ledger, kept, !!bravo, downgraded);
  saveLedger(diff.repoRoot, ledger);
  appendRunLog(diff.repoRoot, {
    ts: new Date().toISOString(), run: ledger.runs, mode: diff.mode, files: diff.files.length, gateway: gw.name,
    findings: kept.map((f) => ({ hash: hashFinding(f), severity: f.severity, file: f.file, line: f.line, confidence: Number(f.confidence.toFixed(2)), title: f.title })),
    bravo: bravo ? { what: bravo.what, author: bravo.author } : null, downgraded, dropped: dropped.length,
  });

  const markdown = renderReview({
    intent, findings: kept, bravo,
    meta: { passes, toolsRun: det.toolsRun, toolsMissing: det.toolsMissing, dropped: dropped.length, gateway: gw.name, files: diff.files.length },
  });
  return { markdown, intent, findings: kept, bravo, diff };
}
