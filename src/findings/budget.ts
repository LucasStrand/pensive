import { type Finding, SEVERITY_WEIGHT } from "../schema.ts";

export interface Budgeted { kept: Finding[]; dropped: Finding[]; }

const ALWAYS_SURFACE = new Set(["bug", "critical"]);

// Scarcity manufactures signal — but the budget rations NOISE, never correctness.
// Bugs and criticals always surface (exempt from the cap and the confidence floor).
// Only style/question/nit/info findings compete for the remaining comment slots.
export function applyBudget(findings: Finding[], maxComments = 5, confidenceFloor = 0.45): Budgeted {
  const score = (f: Finding) => SEVERITY_WEIGHT[f.severity] * f.confidence;
  const must = findings.filter((f) => ALWAYS_SURFACE.has(f.severity)).sort((a, b) => score(b) - score(a));
  const optional = findings
    .filter((f) => !ALWAYS_SURFACE.has(f.severity) && f.confidence >= confidenceFloor)
    .sort((a, b) => score(b) - score(a));

  const slots = Math.max(0, maxComments - must.length);
  const kept = [...must, ...optional.slice(0, slots)];
  const keptSet = new Set(kept);
  const dropped = findings.filter((f) => !keptSet.has(f));
  return { kept, dropped };
}
