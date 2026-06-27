import type { z } from "zod";

export type ModelTier = "fast" | "strong";

export interface ModelRequest {
  system?: string;
  prompt: string;
  tier?: ModelTier;
  cacheSystem?: boolean;   // prompt-cache the system block (repo context)
  temperature?: number;
}

export interface ModelGateway {
  readonly name: string;
  text(req: ModelRequest): Promise<string>;
  json<T>(req: ModelRequest & { schema: z.ZodType<T> }): Promise<T>;
}

// Pull the first balanced JSON object/array out of a model response.
export function extractJson(raw: string): string {
  const start = raw.search(/[\[{]/);
  if (start === -1) throw new Error("no JSON found in model output");
  const open = raw[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return raw.slice(start, i + 1); }
  }
  throw new Error("unbalanced JSON in model output");
}
