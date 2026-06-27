import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Finding } from "../schema.ts";

export type Fate = "open" | "resolved" | "ignored";
export interface Ledger {
  version: number;
  runs: number;
  praise: { tokens: number; lastPraiseAt: string | null; lastAuthors: string[] };
  comments: Record<string, { file: string; title: string; severity: string; firstSeenRun: number; fate: Fate }>;
  stats: { findingsTotal: number; bySeverity: Record<string, number>; bravos: number; downgraded: number };
}

const MAX_TOKENS = 1, REGEN_DAYS = 7, AUTHOR_COOLDOWN = 3;
function dir(r: string) { return join(r, ".pensive"); }
function file(r: string) { return join(dir(r), "ledger.json"); }
function fresh(): Ledger {
  return { version: 1, runs: 0, praise: { tokens: MAX_TOKENS, lastPraiseAt: null, lastAuthors: [] }, comments: {}, stats: { findingsTotal: 0, bySeverity: {}, bravos: 0, downgraded: 0 } };
}

export function loadLedger(repoRoot: string): Ledger {
  const p = file(repoRoot);
  if (!existsSync(p)) return fresh();
  try { return { ...fresh(), ...JSON.parse(readFileSync(p, "utf8")) }; } catch { return fresh(); }
}
export function saveLedger(repoRoot: string, l: Ledger): void {
  mkdirSync(dir(repoRoot), { recursive: true });
  writeFileSync(file(repoRoot), JSON.stringify(l, null, 2));
}
export function hashFinding(f: Pick<Finding, "file" | "title">): string {
  return createHash("sha1").update(`${f.file}::${f.title}`).digest("hex").slice(0, 12);
}

export function refreshPraise(l: Ledger): void {
  if (l.praise.tokens >= MAX_TOKENS || !l.praise.lastPraiseAt) return;
  if ((Date.now() - new Date(l.praise.lastPraiseAt).getTime()) / 86_400_000 >= REGEN_DAYS) l.praise.tokens = MAX_TOKENS;
}
export function canPraise(l: Ledger, author: string): boolean {
  refreshPraise(l);
  if (l.praise.tokens <= 0) return false;
  if (author !== "unknown" && l.praise.lastAuthors.includes(author)) return false;
  return true;
}
export function spendPraise(l: Ledger, author: string): void {
  l.praise.tokens = Math.max(0, l.praise.tokens - 1);
  l.praise.lastPraiseAt = new Date().toISOString();
  l.praise.lastAuthors = [author, ...l.praise.lastAuthors.filter((a) => a !== author)].slice(0, AUTHOR_COOLDOWN);
}
export function recordFindings(l: Ledger, findings: Finding[], runId: number): void {
  for (const f of findings) {
    const h = hashFinding(f);
    if (!l.comments[h]) l.comments[h] = { file: f.file, title: f.title, severity: f.severity, firstSeenRun: runId, fate: "open" };
  }
}
export function recordRun(l: Ledger, findings: Finding[], bravoFired: boolean, downgraded: number): void {
  l.stats.findingsTotal += findings.length;
  l.stats.bravos += bravoFired ? 1 : 0;
  l.stats.downgraded += downgraded;
  for (const f of findings) l.stats.bySeverity[f.severity] = (l.stats.bySeverity[f.severity] ?? 0) + 1;
}
export function appendRunLog(repoRoot: string, record: unknown): void {
  mkdirSync(dir(repoRoot), { recursive: true });
  appendFileSync(join(dir(repoRoot), "runs.jsonl"), JSON.stringify(record) + "\n");
}
export function markFate(repoRoot: string, hash: string, fate: Fate): boolean {
  const l = loadLedger(repoRoot);
  if (!l.comments[hash]) return false;
  l.comments[hash].fate = fate;
  saveLedger(repoRoot, l);
  return true;
}
export function computeStats(l: Ledger) {
  const fates = { open: 0, resolved: 0, ignored: 0 };
  for (const c of Object.values(l.comments)) fates[c.fate]++;
  const acted = fates.resolved + fates.ignored;
  return { runs: l.runs, comments: Object.keys(l.comments).length, fates, actionRate: acted ? fates.resolved / acted : null, ...l.stats };
}
