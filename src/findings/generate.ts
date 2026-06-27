import type { ModelGateway } from "../model/gateway.ts";
import { Finding, FindingList, type Intent, type Severity } from "../schema.ts";
import type { DiffSet } from "../ingest/diff.ts";
import { renderFileDiff } from "../ingest/diff.ts";
import { type FileContext, renderContext } from "../context/retrieve.ts";
import { type DeterministicResult, renderFacts } from "../deterministic/linters.ts";
import { loadRulePacks } from "../rulepacks.ts";

const SYSTEM = `You are Pensive, a code reviewer with the temperament of a senior engineer who will personally maintain this code.

Principles you hold absolutely:
- You review the change's INTENT and its risk to THIS repo — not the diff line by line.
- The repo's own conventions are the rulebook. Do not import opinions the team never agreed to.
- Silence is for NITS, never for bugs. If you suspect a real correctness problem you MUST raise it as a bug/critical, even when unsure — express doubt with lower confidence, never by staying silent.
- For non-correctness matters (style, taste, micro-opt), prefer silence. Only raise them if they would change what the author does.
- Deterministic linter facts are already settled; never repeat them.
- A long list of nits is a failure. A missed bug is a worse failure. Optimize for catching the bug while staying quiet on noise.`;

function severityRank(s: Severity): number {
  return ["info", "nit", "question", "warning", "bug", "critical"].indexOf(s);
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).slice(0, 6).join("-");
}

export async function generateFindings(
  gw: ModelGateway,
  diff: DiffSet,
  intent: Intent,
  ctx: FileContext[],
  det: DeterministicResult,
  passes = 3,
): Promise<Finding[]> {
  const languages = [...new Set(diff.files.map((f) => f.language))];
  const rulePacks = loadRulePacks(languages);
  const system = rulePacks ? `${SYSTEM}\n\n${rulePacks}` : SYSTEM;

  const diffText = diff.files.map(renderFileDiff).join("\n\n").slice(0, 24000);
  const ctxText = ctx.map(renderContext).join("\n\n").slice(0, 16000);
  const factsText = renderFacts(det);

  const user = [
    `Reconstructed intent: ${intent.statement}`,
    intent.concerns.length
      ? `The intent pass flagged these POSSIBLE problems. Verify each against the actual code and, if real, INCLUDE it as a finding with the right severity — a genuine correctness problem is a bug/critical, not a nit. Do not drop a real bug just because an inline comment claims it is intentional:\n${intent.concerns.map((c) => `- ${c}`).join("\n")}`
      : "",
    `\n${factsText}`,
    `\n--- DIFF ---\n${diffText}`,
    `\n--- CONTEXT ---\n${ctxText}`,
    `\nReturn findings as JSON: {"findings": [{"file","line","severity","title","body","evidence","confidence"}]}`,
    `severity is one of info|nit|question|warning|bug|critical. confidence is 0..1. evidence must cite the specific line/symbol that grounds the finding.`,
    `Raise every genuine correctness risk. Stay silent on style/nits. If nothing is material, return {"findings": []}.`,
  ].filter(Boolean).join("\n");

  const results = await Promise.all(
    Array.from({ length: passes }, (_, i) =>
      gw.json({ system, prompt: user, schema: FindingList, tier: "strong", cacheSystem: true, temperature: 0.2 + i * 0.2 })
        .then((r) => r.findings)
        .catch(() => [] as Finding[])
    )
  );
  return majorityMerge(results, passes);
}

// Agreement rations noise; a single-vote BUG/CRITICAL is always kept (we would rather
// verify a serious claim than silently drop it). Nits need majority agreement.
function majorityMerge(passes: Finding[][], n: number): Finding[] {
  const need = Math.max(1, Math.ceil(n / 2));
  const groups = new Map<string, { items: Finding[]; votes: number }>();
  for (const pass of passes) {
    const seenThisPass = new Set<string>();
    for (const f of pass) {
      const key = `${f.file}:${Math.round(f.line / 3)}:${slug(f.title)}`;
      if (!groups.has(key)) groups.set(key, { items: [], votes: 0 });
      const g = groups.get(key)!;
      g.items.push(f);
      if (!seenThisPass.has(key)) { g.votes++; seenThisPass.add(key); }
    }
  }
  const kept: Finding[] = [];
  for (const { items, votes } of groups.values()) {
    const rep = items.slice().sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence)[0];
    const serious = rep.severity === "bug" || rep.severity === "critical";
    if (votes < need && !serious) continue;
    const agreement = Math.min(1, votes / n);
    const avgConf = items.reduce((s, x) => s + x.confidence, 0) / items.length;
    kept.push({ ...rep, confidence: Math.min(1, avgConf * (0.5 + 0.5 * agreement)) });
  }
  return kept;
}
