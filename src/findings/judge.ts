import type { ModelGateway } from "../model/gateway.ts";
import { type Finding, Verdict } from "../schema.ts";
import type { FileContext } from "../context/retrieve.ts";
import { renderContext } from "../context/retrieve.ts";

const CORRECTNESS = new Set(["bug", "critical"]);

// Verify before speaking — but NEVER silence a correctness concern. A nit that fails
// refutation is dropped (that is noise). A *possible bug* that fails refutation is
// downgraded to a "verify this" question and KEPT. Silence is only ever for nits.
export async function judgeFindings(
  gw: ModelGateway,
  findings: Finding[],
  ctx: FileContext[],
): Promise<Finding[]> {
  const ctxByFile = new Map(ctx.map((c) => [c.path, c]));
  const judged = await Promise.all(findings.map(async (f) => {
    const c = ctxByFile.get(f.file);
    const prompt = [
      "Try to refute the following review finding. Assume it may be a false positive caused by missing context.",
      "Look hard for a reason it is WRONG: is the concern actually handled elsewhere? does the evidence really support it?",
      "IMPORTANT: an inline code comment claiming an odd behavior is intentional is NOT proof it is correct — judge the behavior, not the comment.",
      "Default to survives=false ONLY for style/taste matters. For a genuine correctness risk, keep survives=true unless you are confident it is handled.",
      `\nFinding: [${f.severity}] ${f.title}\n${f.body}\nEvidence: ${f.evidence}\nLocation: ${f.file}:${f.line}`,
      c ? `\nContext:\n${renderContext(c)}` : "",
      `\nReturn JSON: {"survives": boolean, "reason": string, "adjustedConfidence": number}`,
    ].filter(Boolean).join("\n");

    try {
      const v = await gw.json({ prompt, schema: Verdict, tier: "strong", temperature: 0.1 });
      if (v.survives) return { ...f, confidence: v.adjustedConfidence ?? f.confidence };
      // Refuted. A possible bug is NEVER dropped — surface it for human verification.
      if (CORRECTNESS.has(f.severity)) {
        return {
          ...f,
          confidence: Math.min(f.confidence, 0.5),
          body: `${f.body}\n\n_(Pensive tried to refute this and could not fully confirm it — surfacing for you to verify rather than stay silent on a possible bug.)_`,
        };
      }
      return null; // non-correctness noise: drop
    } catch {
      return f; // judge error: keep rather than silently drop
    }
  }));
  return judged.filter((f): f is Finding => f !== null);
}
