import type { z } from "zod";
import { type ModelGateway, type ModelRequest, extractJson } from "./gateway.ts";

// OpenRouter is OpenAI-compatible and can route to Claude (and many others).
// Models read at call time so .env overrides apply.
function modelFor(tier: "fast" | "strong"): string {
  return tier === "fast"
    ? (process.env.PENSIVE_MODEL_FAST ?? "anthropic/claude-sonnet-4")
    : (process.env.PENSIVE_MODEL_STRONG ?? "anthropic/claude-sonnet-4");
}

export class OpenRouterGateway implements ModelGateway {
  readonly name = "openrouter";
  private key: string;
  constructor(apiKey = process.env.OPENROUTER_API_KEY) {
    if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
    this.key = apiKey;
  }

  private async raw(req: ModelRequest): Promise<string> {
    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.prompt });
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/pensive-review",
        "X-Title": "Pensive code reviewer",
      },
      body: JSON.stringify({ model: modelFor(req.tier ?? "strong"), messages, temperature: req.temperature ?? 0.2, max_tokens: 4096 }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }

  async text(req: ModelRequest): Promise<string> { return this.raw(req); }

  async json<T>(req: ModelRequest & { schema: z.ZodType<T> }): Promise<T> {
    const base = `${req.prompt}\n\nRespond with ONLY valid JSON. No prose, no code fences.`;
    let last = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      last = await this.raw({ ...req, prompt: attempt === 0 ? base : `${base}\n\nYour previous reply was not valid JSON. Return only the JSON.` });
      try { return req.schema.parse(JSON.parse(extractJson(last))); } catch { /* one retry */ }
    }
    throw new Error(`OpenRouter did not return valid JSON: ${last.slice(0, 200)}`);
  }
}
