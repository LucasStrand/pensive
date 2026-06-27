import type { ModelGateway } from "./model/gateway.ts";
import { Intent } from "./schema.ts";
import type { DiffSet } from "./ingest/diff.ts";
import { renderFileDiff } from "./ingest/diff.ts";

// Step zero: reconstruct what the change is TRYING to do. If we cannot, that is
// itself the most valuable thing to say. Everything downstream judges against this.
export async function reconstructIntent(
  gw: ModelGateway,
  diff: DiffSet,
  opts: { title?: string; description?: string } = {},
): Promise<Intent> {
  const summary = diff.files.map((f) => `${f.path} (+${f.added} -${f.deleted})`).join("\n");
  const sample = diff.files.slice(0, 8).map(renderFileDiff).join("\n\n").slice(0, 12000);
  const meta = [opts.title && `PR title: ${opts.title}`, opts.description && `PR description: ${opts.description}`]
    .filter(Boolean).join("\n");

  const prompt = [
    "Reconstruct the intent of this change in ONE sentence: \"This change is trying to X because Y.\"",
    "If the intent genuinely cannot be determined from the diff and metadata, set clear=false and explain what is missing — that is a high-value review observation, not a failure.",
    "List at most 3 concerns ONLY if the change appears to do something beyond its apparent intent.",
    meta && `\nMetadata:\n${meta}`,
    `\nChanged files:\n${summary}`,
    `\nDiff sample:\n${sample}`,
    `\nReturn JSON: {"clear": boolean, "statement": string, "concerns": string[]}`,
  ].filter(Boolean).join("\n");

  return gw.json({ prompt, schema: Intent, tier: "fast", temperature: 0.1 });
}
