import { execFileSync } from "node:child_process";
import type { ModelGateway } from "../model/gateway.ts";
import { Bravo } from "../schema.ts";
import type { DiffSet, FileDiff } from "../ingest/diff.ts";
import { renderFileDiff } from "../ingest/diff.ts";

// Praise must be EARNED, not volunteered. Deterministic signals nominate first;
// only then does the model judge whether it is genuinely top-percentile for THIS repo.
export interface Signal { file: string; kind: string; detail: string; strength: number; }

export function computeSignals(diff: DiffSet): Signal[] {
  const signals: Signal[] = [];
  for (const f of diff.files) {
    if (f.binary || f.isDeleted || f.isNew) continue;
    const net = f.deleted - f.added;

    // Big safe deletion: removed a lot, added little (same job, far less code).
    if (net >= 15 && f.added <= f.deleted * 0.5) {
      signals.push({ file: f.path, kind: "net-deletion", detail: `removed ${f.deleted}, added ${f.added} (net -${net})`, strength: Math.min(1, net / 60) });
    }
    // Sprawl collapsed: a hunk replacing many lines with one or two.
    for (const h of f.hunks) {
      const del = h.lines.filter((l) => l.kind === "del").length;
      const add = h.lines.filter((l) => l.kind === "add").length;
      if (del >= 8 && add > 0 && add <= 2) {
        signals.push({ file: f.path, kind: "collapse", detail: `${del} lines -> ${add} line(s) in one hunk`, strength: Math.min(1, del / 25) });
      }
    }
  }
  return signals.sort((a, b) => b.strength - a.strength);
}

function git(repoRoot: string, args: string[]): string {
  try { return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore","pipe","ignore"] }).trim(); }
  catch { return ""; }
}

function authorInfo(repoRoot: string): { author: string; isAI: boolean } {
  const name = git(repoRoot, ["log", "-1", "--format=%an"]);
  const body = git(repoRoot, ["log", "-1", "--format=%B"]);
  if (!name) return { author: "unknown", isAI: false };
  const blob = `${name}\n${body}`;
  const isAI = /\b(claude|copilot|gpt-?\d|chatgpt|cursor|aider)\b/i.test(blob)
    || /co-authored-by:.*(claude|\bai\b|bot|anthropic)/i.test(blob)
    || /\bbot\b/i.test(name);
  return { author: name, isAI };
}

const HIGH_BAR = 0.85;

export async function nominateBravo(gw: ModelGateway, diff: DiffSet): Promise<Bravo | null> {
  const signals = computeSignals(diff);
  if (signals.length === 0) return null; // model never volunteers praise from a blank slate

  const top = signals[0];
  const f = diff.files.find((x) => x.path === top.file) as FileDiff;
  const { author, isAI } = authorInfo(diff.repoRoot);

  const prompt = [
    "A deterministic signal nominated a possibly STANDOUT (exceptional) piece of work. Decide if it is genuinely top-percentile FOR THIS REPO — the kind of 10x simplification a strong senior would stop and admire.",
    "Be extremely strict. Ordinary good code is NOT standout. Only real, rare excellence qualifies. If in doubt, score low.",
    `Nominating signal: ${top.kind} in ${top.file} — ${top.detail}`,
    `\nChange:\n${renderFileDiff(f).slice(0, 8000)}`,
    `\nReturn JSON: {"file","line","what","why","confidence"} where confidence is 0..1 that this is truly exceptional. 'what' names the specific clever move; 'why' says why it is exceptional for this codebase.`,
  ].join("\n");

  try {
    const b = await gw.json({ prompt, schema: Bravo, tier: "strong", temperature: 0.2 });
    if (b.confidence < HIGH_BAR) return null;
    return { ...b, file: b.file || top.file, author, authorIsAI: isAI, signal: `${top.kind}: ${top.detail}` };
  } catch {
    return null;
  }
}
