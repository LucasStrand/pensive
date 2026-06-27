import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Finding, Bravo, Severity } from "../schema.ts";
import {
  type Fate, type Ledger, freshLedger, recordFindings, recordRun, markFate,
  AUTHOR_COOLDOWN, MAX_PRAISE_TOKENS, refreshPraise,
} from "./store.ts";

// ---------------------------------------------------------------------------
// The event log (.pensive/runs.jsonl) is the SOURCE OF TRUTH. Every line is a
// self-contained, schema-versioned, uniquely-identified event — no joins back
// to ledger.json required to interpret it. ledger.json is a derived cache that
// rebuildLedger() can regenerate from this log alone. Designed so a future
// database migration is a replay script, not a rewrite: stable ids make
// re-imports idempotent, `v` lets an importer handle old lines, and flat
// `source`/`model` blocks map cleanly onto reviews + findings tables (or any
// document/KV store).
// ---------------------------------------------------------------------------

export const EVENT_SCHEMA_VERSION = 1;

// Where the reviewed change came from. Local CLI runs leave repo/pr/author null.
export interface ReviewSource {
  provider: string;            // "github" | "local"
  repo: string | null;        // "owner/name"
  pr: number | null;
  author: string | null;      // PR author login
  head: string | null;        // reviewed commit sha
  base: string | null;        // base commit sha
}

export interface FindingRecord {
  hash: string;
  severity: Severity;
  file: string;
  line: number;
  confidence: number;
  title: string;
  body: string;               // full rendered finding — needed for fine-tuning
  evidence: string;           // grounding lines/symbols
}

export interface ReviewEvent {
  v: number;
  id: string;
  kind: "review";
  ts: string;
  run: number;
  source: ReviewSource;
  model: { gateway: string };
  mode: string;
  files: number;
  findings: FindingRecord[];
  bravo: { what: string; why: string; author: string; file: string; line: number } | null;
  downgraded: number;
  dropped: number;
}

// The human outcome of a finding — the supervision label for tuning/eval.
export interface FeedbackEvent {
  v: number;
  id: string;
  kind: "feedback";
  ts: string;
  hash: string;
  fate: Fate;
  source: { repo: string | null };
}

export type Event = ReviewEvent | FeedbackEvent;

function logPath(repoRoot: string): string {
  return join(repoRoot, ".pensive", "runs.jsonl");
}
function append(repoRoot: string, event: Event): void {
  const dir = join(repoRoot, ".pensive");
  mkdirSync(dir, { recursive: true });
  appendFileSync(logPath(repoRoot), JSON.stringify(event) + "\n");
}

export interface ReviewEventInput {
  run: number;
  source: Partial<ReviewSource>;
  gateway: string;
  mode: string;
  files: number;
  findings: Finding[];
  findingHash: (f: Finding) => string;
  bravo: Bravo | null;
  downgraded: number;
  dropped: number;
}

export function appendReviewEvent(repoRoot: string, input: ReviewEventInput): ReviewEvent {
  const source: ReviewSource = {
    provider: input.source.provider ?? "local",
    repo: input.source.repo ?? null,
    pr: input.source.pr ?? null,
    author: input.source.author ?? null,
    head: input.source.head ?? null,
    base: input.source.base ?? null,
  };
  const event: ReviewEvent = {
    v: EVENT_SCHEMA_VERSION,
    id: randomUUID(),
    kind: "review",
    ts: new Date().toISOString(),
    run: input.run,
    source,
    model: { gateway: input.gateway },
    mode: input.mode,
    files: input.files,
    findings: input.findings.map((f) => ({
      hash: input.findingHash(f),
      severity: f.severity,
      file: f.file,
      line: f.line,
      confidence: Number(f.confidence.toFixed(2)),
      title: f.title,
      body: f.body,
      evidence: f.evidence,
    })),
    bravo: input.bravo
      ? { what: input.bravo.what, why: input.bravo.why, author: input.bravo.author, file: input.bravo.file, line: input.bravo.line }
      : null,
    downgraded: input.downgraded,
    dropped: input.dropped,
  };
  append(repoRoot, event);
  return event;
}

// Record a fate change in BOTH the cache (for fast reads) and the log (so the
// outcome label survives a rebuild / migration).
export function recordFeedback(repoRoot: string, hash: string, fate: Fate, repo: string | null = null): boolean {
  if (!markFate(repoRoot, hash, fate)) return false;
  const event: FeedbackEvent = {
    v: EVENT_SCHEMA_VERSION,
    id: randomUUID(),
    kind: "feedback",
    ts: new Date().toISOString(),
    hash,
    fate,
    source: { repo },
  };
  append(repoRoot, event);
  return true;
}

export function readEvents(repoRoot: string): Event[] {
  const p = logPath(repoRoot);
  if (!existsSync(p)) return [];
  const out: Event[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s) as Event); } catch { /* skip a corrupt line, keep the rest */ }
  }
  return out;
}

// Replay the log into a fresh Ledger — proof that the log is self-sufficient and
// the migration/repair path. Findings stats and comment fates reconstruct
// exactly; praise-token state is operational (time-window dependent) and is
// reconstructed best-effort, then refreshed against the current clock.
export function rebuildLedger(repoRoot: string): Ledger {
  const l = freshLedger();
  for (const raw of readEvents(repoRoot)) {
    // Legacy (pre-v1) lines had no `kind`/`v` but carried `findings` + `run`.
    // Treat them as review events so the log replays cleanly across versions.
    const ev = (!("kind" in raw) && "findings" in (raw as any)) ? { ...(raw as any), kind: "review" } as ReviewEvent : raw;
    if (ev.kind === "review") {
      l.runs = Math.max(l.runs, ev.run);
      const findings = ev.findings.map((f) => ({
        file: f.file, line: f.line ?? 0, severity: f.severity, title: f.title,
        body: f.body ?? "", evidence: f.evidence ?? "", confidence: f.confidence,
      })) as Finding[];
      recordFindings(l, findings, ev.run);
      recordRun(l, findings, !!ev.bravo, ev.downgraded);
      if (ev.bravo) {
        const author = ev.bravo.author;
        l.praise.tokens = Math.max(0, l.praise.tokens - 1);
        l.praise.lastPraiseAt = ev.ts;
        l.praise.lastAuthors = [author, ...l.praise.lastAuthors.filter((a) => a !== author)].slice(0, AUTHOR_COOLDOWN);
      }
    } else if (ev.kind === "feedback") {
      const c = l.comments[ev.hash];
      if (c) c.fate = ev.fate;
    }
  }
  if (l.praise.tokens <= 0 && !l.praise.lastPraiseAt) l.praise.tokens = MAX_PRAISE_TOKENS;
  refreshPraise(l);
  return l;
}
