import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { INSTALL_ROOT } from "./paths.ts";
import { selectGateway } from "../model/select.ts";

// ---------------------------------------------------------------------------
// Pensive as a honeypot brain.
//
// Pensive is a code reviewer with spare capacity and a model key, which makes it
// a perfectly good place to point a site's attack telemetry: strand.wf's guard
// flags a client and posts the fingerprint here, and this file names it in one
// sentence and keeps the case file. Nothing about the PR-review path changes.
//
// Two rules, both learned from what a honeypot is for:
//   1. never break the caller — a missing key or a model outage falls back to a
//      verdict assembled from the raw facts, so strand.wf always gets an answer;
//   2. never trust the caller's prose — the fingerprint is stored as received and
//      only the *model's* output is quoted as a verdict.
// ---------------------------------------------------------------------------

export interface Fingerprint {
  kind?: string;
  ip: string;
  class?: string;
  score?: number;
  conns?: number;
  entries?: number;
  usernames?: string[];
  clients?: string[];
  payloads?: string[];
  at?: string;
  site?: string;
}

export interface Observation {
  at: string;
  class: string;
  score: number;
  conns: number;
  entries: number;
}

export interface CaseFile {
  caseId: string;
  ip: string;
  site: string;
  firstSeen: string;
  lastSeen: string;
  /** Newest last, capped: the shape of the campaign, not a full transcript. */
  observations: Observation[];
  usernames: string[];
  clients: string[];
  payloads: string[];
  verdict: string;
  verdictBy: string; // "openrouter" | "claude" | "facts"
  hits: number;
}

const CASES_FILE =
  process.env.GUARD_CASES_FILE ?? join(INSTALL_ROOT, ".pensive", "guard", "cases.json");
const MAX_CASES = 200;
const MAX_OBSERVATIONS = 20;
const MAX_LIST = 8;
const VERDICT_TTL_MS = 10 * 60 * 1000;

let cases: CaseFile[] = load();
const verdictCache = new Map<string, { at: number; verdict: string; by: string }>();
let seq = 0;

function load(): CaseFile[] {
  try {
    const raw = JSON.parse(readFileSync(CASES_FILE, "utf8"));
    return Array.isArray(raw) ? (raw as CaseFile[]) : [];
  } catch {
    return [];
  }
}

function save(): void {
  try {
    mkdirSync(dirname(CASES_FILE), { recursive: true });
    writeFileSync(CASES_FILE, JSON.stringify(cases.slice(-MAX_CASES), null, 2));
  } catch (err: any) {
    console.log(`[guard] could not persist cases: ${err?.message ?? err}`);
  }
}

function tail(xs: string[] | undefined, have: string[]): string[] {
  const out = [...have];
  for (const x of xs ?? []) {
    if (!x) continue;
    const at = out.indexOf(x);
    if (at >= 0) out.splice(at, 1);
    out.push(x);
    if (out.length > MAX_LIST) out.shift();
  }
  return out;
}

function facts(f: Fingerprint): string {
  const bits: string[] = [];
  bits.push(`${f.class ?? "flagged"} with a guard score of ${f.score ?? 0}`);
  bits.push(`${f.conns ?? 0} ssh connections, ${f.entries ?? 0} guestbook signatures`);
  if (f.usernames?.length) bits.push(`usernames used: ${f.usernames.join(", ")}`);
  if (f.clients?.length) bits.push(`ssh clients: ${f.clients.join(", ")}`);
  if (f.payloads?.length) bits.push(`guestbook payloads: ${f.payloads.map((p) => JSON.stringify(p)).join(", ")}`);
  return bits.join("; ");
}

/** A verdict assembled from the telemetry alone — no model, no key, no network. */
function fallbackVerdict(f: Fingerprint): string {
  const cls = f.class ?? "flagged client";
  const n = f.usernames?.length ?? 0;
  const payloads = f.payloads?.length ?? 0;
  const parts = [`a ${cls} — ${f.conns ?? 0} connects`];
  if (n > 1) parts.push(`${n} different usernames`);
  if (payloads) parts.push(`${payloads} guestbook payloads`);
  if (f.clients?.length) parts.push(f.clients[0] ?? "");
  return parts.filter(Boolean).join(", ");
}

async function verdictFor(f: Fingerprint): Promise<{ verdict: string; by: string }> {
  // The cache key carries the shape, not just the IP: a client that keeps
  // escalating (more connects, a new class) gets re-named instead of being stuck
  // with the verdict from its first, quietest report.
  const key = `${f.ip}|${f.class ?? "?"}|${Math.floor((f.score ?? 0) / 10)}|${f.payloads?.length ?? 0}`;
  const cached = verdictCache.get(key);
  if (cached && Date.now() - cached.at < VERDICT_TTL_MS) {
    return { verdict: cached.verdict, by: cached.by };
  }

  let verdict = "";
  const by = "facts";
  try {
    const gateway = selectGateway();
    if (gateway.name !== "mock") {
      const raw = await gateway.text({
        system:
          "You are the honeypot brain for strand.wf, a personal site that is an SSH terminal with a " +
          "signable guestbook. You are given a fingerprint of one client its front-door guard flagged. " +
          "Name the client in ONE sentence of at most 22 words, lower case, no preamble, no quotes, no code fences. " +
          "Say what the behaviour most likely is (port scanner, fuzzer, bot, load test, someone with a script) " +
          "and which of the facts gives it away. Never use the phrase 'it appears'.",
        prompt: facts(f),
        tier: "fast",
        temperature: 0.3,
      });
      verdict = raw.trim().replace(/^["'`]|["'`]$/g, "").split("\n")[0]!.trim();
      if (verdict.length > 200) verdict = verdict.slice(0, 200) + "…";
      verdictCache.set(key, { at: Date.now(), verdict, by: gateway.name });
      return { verdict, by: gateway.name };
    }
  } catch (err: any) {
    console.log(`[guard] model verdict failed for ${f.ip}: ${err?.message ?? err}`);
  }
  verdict = fallbackVerdict(f);
  verdictCache.set(key, { at: Date.now(), verdict, by });
  return { verdict, by };
}

/** Store an incoming fingerprint and return the case file + verdict. */
export async function intake(f: Fingerprint): Promise<CaseFile> {
  const now = new Date().toISOString();
  const site = f.site ?? "unknown";

  let c = cases.find((x) => x.ip === f.ip && x.site === site);
  if (!c) {
    if (++seq > 1e6) seq = 1;
    c = {
      caseId: `${site}-${f.ip}-${Date.now().toString(36)}-${seq}`,
      ip: f.ip,
      site,
      firstSeen: now,
      lastSeen: now,
      observations: [],
      usernames: [],
      clients: [],
      payloads: [],
      verdict: "",
      verdictBy: "",
      hits: 0,
    };
    cases.push(c);
    if (cases.length > MAX_CASES) cases = cases.slice(-MAX_CASES);
  }

  c.lastSeen = now;
  c.hits += 1;
  c.observations.push({
    at: now,
    class: f.class ?? "unknown",
    score: f.score ?? 0,
    conns: f.conns ?? 0,
    entries: f.entries ?? 0,
  });
  if (c.observations.length > MAX_OBSERVATIONS) c.observations = c.observations.slice(-MAX_OBSERVATIONS);

  // Facts may only ever grow: a later, quieter report must not erase the file.
  c.usernames = tail(f.usernames, c.usernames);
  c.clients = tail(f.clients, c.clients);
  c.payloads = tail(f.payloads, c.payloads);

  const { verdict, by } = await verdictFor(f);
  c.verdict = verdict;
  c.verdictBy = by;
  save();
  return c;
}

export function list(): CaseFile[] {
  return [...cases].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
}

export function stats() {
  return {
    cases: cases.length,
    hits: cases.reduce((n, c) => n + c.hits, 0),
    payloads: cases.reduce((n, c) => n + c.payloads.length, 0),
    since: cases[0]?.firstSeen ?? null,
    lastAt: list()[0]?.lastSeen ?? null,
  };
}
