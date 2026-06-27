import type { Finding, Intent, Bravo, Severity } from "../schema.ts";

const TONE: Record<Severity, string> = {
  critical: "🔴 **Critical:**",
  bug: "🐛 **Bug:**",
  warning: "⚠️ **Warning:**",
  question: "❓ **Question:**",
  nit: "nit:",
  info: "note:",
};

// Tone tracks certainty — but an uncertain BUG is still flagged as a possible bug,
// never softened into a generic nit. Silence/soft-questions are only for non-correctness.
const ASSERT_THRESHOLD = 0.7;
function displayTag(f: Finding): string {
  if (f.severity === "critical") return TONE.critical;
  if (f.severity === "bug") return f.confidence >= ASSERT_THRESHOLD ? TONE.bug : "🐛 **Possible bug — verify:**";
  if (f.severity === "warning") return f.confidence >= ASSERT_THRESHOLD ? TONE.warning : "❓ **Worth checking:**";
  if (f.confidence < ASSERT_THRESHOLD) return "❓ **Worth checking:**";
  return TONE[f.severity];
}

export interface RenderInput {
  intent: Intent;
  findings: Finding[];
  bravo: Bravo | null;
  meta: { passes: number; toolsRun: string[]; toolsMissing: string[]; dropped: number; gateway: string; files: number };
}

export function renderReview(r: RenderInput): string {
  const out: string[] = ["## 🔎 Pensive review", ""];

  if (r.intent.clear) out.push(`**Intent:** ${r.intent.statement}`, "");
  else out.push(`**⚠️ Intent unclear:** ${r.intent.statement}`, "");
  if (r.intent.concerns.length) out.push("**Possible beyond-intent changes:**", ...r.intent.concerns.map((c) => `- ${c}`), "");

  if (r.bravo) {
    const who = r.bravo.authorIsAI
      ? `Authored by ${r.bravo.author} (AI contributor) — credit where it is due.`
      : `Authored by ${r.bravo.author}.`;
    out.push("> ## 🌟 Standout", `> **${r.bravo.what}**`, "> ", `> ${r.bravo.why}`, "> ", `> _${who}_`, "");
  }

  if (r.findings.length === 0) {
    out.push("✅ **LGTM — nothing material.**", "");
  } else {
    out.push("### Findings", "");
    for (const f of r.findings) {
      const loc = f.line ? `\`${f.file}:${f.line}\`` : `\`${f.file}\``;
      out.push(`- ${displayTag(f)} ${f.title} — ${loc}`);
      if (f.body) out.push(`  ${f.body.replace(/\n/g, "\n  ")}`);
    }
    out.push("");
  }

  const bits = [
    `${r.meta.files} file(s)`, `${r.meta.passes} passes`,
    r.meta.toolsRun.length ? `linters: ${r.meta.toolsRun.join(", ")}` : "linters: none",
    `${r.findings.length} shown`, r.meta.dropped ? `${r.meta.dropped} held back` : "", `engine: ${r.meta.gateway}`,
  ].filter(Boolean);
  out.push("---", `<sub>${bits.join(" · ")}</sub>`);
  return out.join("\n");
}
