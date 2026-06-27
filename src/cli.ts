import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { selectGateway } from "./model/select.ts";
import { review, type ReviewOptions } from "./pipeline.ts";
import { SEVERITY_WEIGHT, type Severity } from "./schema.ts";
import { loadLedger, computeStats, markFate, type Fate } from "./ledger/store.ts";

for (const p of [join(process.cwd(), ".env"), join(dirname(fileURLToPath(import.meta.url)), "..", ".env")]) {
  try { (process as any).loadEnvFile(p); } catch { /* none */ }
}
function repoRoot(cwd = process.cwd()): string {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || cwd; } catch { return cwd; }
}

function parseArgs(rest: string[]) {
  const opts: ReviewOptions = {}; let json = false; let failOn: Severity | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]; const next = () => rest[++i];
    if (a === "--staged") opts.mode = "staged";
    else if (a === "--base") { opts.base = next(); opts.mode = "range"; }
    else if (a === "--head") { opts.head = next(); opts.mode = "range"; }
    else if (a === "--diff") { opts.diffFile = next(); opts.mode = "file"; }
    else if (a === "--cwd") opts.cwd = next();
    else if (a === "--title") opts.title = next();
    else if (a === "--desc") opts.description = next();
    else if (a === "--passes") opts.passes = parseInt(next() ?? "3", 10);
    else if (a === "--max-comments") opts.maxComments = parseInt(next() ?? "5", 10);
    else if (a === "--fail-on") failOn = next() as Severity;
    else if (a === "--json") json = true;
  }
  return { opts, json, failOn };
}

const HELP = `pensive — a code reviewer that is quiet on noise, never on bugs.

  pensive review [--staged | --base <ref> --head <ref> | --diff <file>]
                 [--cwd d] [--passes N] [--max-comments N] [--fail-on sev] [--json]
  pensive stats                      show evaluation stats (action-rate, severities)
  pensive feedback <hash> <resolved|ignored>   mark a comment fate

Env (.env works): ANTHROPIC_API_KEY or OPENROUTER_API_KEY; PENSIVE_GATEWAY.`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") { console.log(HELP); return; }
  const [cmd, ...rest] = argv;

  if (cmd === "stats") { console.log(JSON.stringify(computeStats(loadLedger(repoRoot())), null, 2)); return; }
  if (cmd === "feedback") {
    const [hash, fate] = rest;
    if (!hash || !["resolved", "ignored"].includes(fate)) { console.error("usage: pensive feedback <hash> <resolved|ignored>"); process.exitCode = 2; return; }
    console.log(markFate(repoRoot(), hash, fate as Fate) ? `marked ${hash} ${fate}` : `no comment with hash ${hash}`);
    return;
  }
  if (cmd !== "review") { console.error(`unknown command: ${cmd}\n`); console.log(HELP); process.exitCode = 2; return; }

  const { opts, json, failOn } = parseArgs(rest);
  const gw = selectGateway();
  if (gw.name === "mock") {
    console.error("⚠️  No API key found — running the MOCK engine (plumbing only, NOT a real review).");
    console.error("    Add ANTHROPIC_API_KEY or OPENROUTER_API_KEY to .env, then re-run.\n");
  }
  let result;
  try { result = await review(gw, opts); }
  catch (e: any) { console.error("pensive: error:", e?.message ?? e); process.exitCode = 1; return; }

  if (json) console.log(JSON.stringify({ intent: result.intent, findings: result.findings, bravo: result.bravo }, null, 2));
  else console.log(result.markdown);

  if (failOn && result.findings.some((f) => SEVERITY_WEIGHT[f.severity] >= SEVERITY_WEIGHT[failOn])) process.exitCode = 1;
}
main().catch((e) => { console.error("pensive: error:", e?.message ?? e); process.exitCode = 1; });
