import { z } from "zod";

// Severity ordered weakest -> strongest. Render tone is derived from this.
export const Severity = z.enum(["info", "nit", "question", "warning", "bug", "critical"]);
export type Severity = z.infer<typeof Severity>;

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  info: 0.2, nit: 0.4, question: 0.6, warning: 1.0, bug: 2.0, critical: 3.0,
};

// "This change is trying to X because Y" — or, if unclear, why it is unclear.
export const Intent = z.object({
  clear: z.boolean(),
  statement: z.string(),
  concerns: z.array(z.string()).default([]),
});
export type Intent = z.infer<typeof Intent>;

export const Finding = z.object({
  file: z.string(),
  line: z.number().int().nonnegative().default(0),
  severity: Severity,
  title: z.string(),
  body: z.string(),
  evidence: z.string().default(""),      // grounding: which lines/symbols justify this
  confidence: z.number().min(0).max(1),  // INTERNAL only — never rendered as a number
});
export type Finding = z.infer<typeof Finding>;

export const FindingList = z.object({ findings: z.array(Finding).default([]) });

export const Verdict = z.object({
  survives: z.boolean(),
  reason: z.string().default(""),
  adjustedConfidence: z.number().min(0).max(1).optional(),
});
export type Verdict = z.infer<typeof Verdict>;

// A finding with positive valence — same gauntlet, higher bar.
export const Bravo = z.object({
  file: z.string().default(""),
  line: z.number().int().nonnegative().default(0),
  what: z.string(),                       // specifically what is clever
  why: z.string(),                        // why it is exceptional FOR THIS REPO
  author: z.string().default("unknown"),
  authorIsAI: z.boolean().default(false),
  signal: z.string().default(""),         // deterministic signal that nominated it
  confidence: z.number().min(0).max(1),
});
export type Bravo = z.infer<typeof Bravo>;
