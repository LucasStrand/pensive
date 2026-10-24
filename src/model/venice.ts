import type { z } from "zod";
import { type ModelGateway, type ModelRequest, extractJson } from "./gateway.ts";

// Venice is OpenAI-compatible, so this is the same shape as the OpenRouter
// gateway with a different host and auth. It exists because the honeypot needs
// *some* live model: the OpenRouter key shipped with the project turned out to be
// revoked ("User not found"), and a honeypot that can only echo facts back is
// only half a honeypot.
//
// Default model is a cheap flash tier with room for reasoning tokens — the
// task is one sentence and the reasoning is what stops it becoming generic.
function modelFor(tier: "fast" | "strong"): string {
  return tier === "fast"
    ? (process.env.PENSIVE_VENICE_MODEL ?? "gemini-3-6-flash")
    : (process.env.PENSIVE_VENICE_MODEL_STRONG ?? process.env.PENSIVE_VENICE_MODEL ?? "gemini-3-6-flash");
}

const BASE = process.env.PENSIVE_VENICE_BASE ?? "https://api.venice.ai/api/v1";

export class VeniceGateway implements ModelGateway {
  readonly name = "venice";
  private key: string;
  constructor(apiKey = process.env.VENICE_API_KEY) {
    if (!apiKey) throw new Error("VENICE_API_KEY not set");
    this.key = apiKey;
  }

  private async raw(req: ModelRequest): Promise<string> {
    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.prompt });
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelFor(req.tier ?? "strong"),
        messages,
        temperature: req.temperature ?? 0.2,
        // Reasoning models here spend tokens before writing anything, so the cap
        // has to leave room for the thought as well as the sentence.
        max_tokens: 900,
      }),
    });
    if (!res.ok) throw new Error(`Venice ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }

  async text(req: ModelRequest): Promise<string> {
    return this.raw(req);
  }

  async json<T>(req: ModelRequest & { schema: z.ZodType<T> }): Promise<T> {
    const base = `${req.prompt}\n\nRespond with ONLY valid JSON. No prose, no code fences.`;
    let last = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      last = await this.raw({ ...req, prompt: attempt === 0 ? base : `${base}\n\nYour previous reply was not valid JSON. Return only the JSON.` });
      try { return req.schema.parse(JSON.parse(extractJson(last))); } catch { /* one retry */ }
    }
    throw new Error(`Venice did not return valid JSON: ${last.slice(0, 200)}`);
  }
}
