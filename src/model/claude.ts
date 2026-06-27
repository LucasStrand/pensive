import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { type ModelGateway, type ModelRequest, extractJson } from "./gateway.ts";

const MODELS = {
  fast: process.env.PENSIVE_MODEL_FAST ?? "claude-haiku-4-5-20251001",
  strong: process.env.PENSIVE_MODEL_STRONG ?? "claude-sonnet-4-6",
};

export class ClaudeGateway implements ModelGateway {
  readonly name = "claude";
  private client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    this.client = new Anthropic({ apiKey });
  }

  private async raw(req: ModelRequest): Promise<string> {
    const model = MODELS[req.tier ?? "strong"];
    const system = req.system
      ? [{
          type: "text" as const,
          text: req.system,
          ...(req.cacheSystem ? { cache_control: { type: "ephemeral" as const } } : {}),
        }]
      : undefined;
    const res = await this.client.messages.create({
      model,
      max_tokens: 4096,
      temperature: req.temperature ?? 0.2,
      system,
      messages: [{ role: "user", content: req.prompt }],
    });
    return res.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }

  async text(req: ModelRequest): Promise<string> {
    return this.raw(req);
  }

  async json<T>(req: ModelRequest & { schema: z.ZodType<T> }): Promise<T> {
    const base = `${req.prompt}\n\nRespond with ONLY valid JSON. No prose, no code fences.`;
    let last = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = attempt === 0
        ? base
        : `${base}\n\nYour previous reply was not valid JSON. Return only the JSON.`;
      last = await this.raw({ ...req, prompt });
      try {
        return req.schema.parse(JSON.parse(extractJson(last)));
      } catch { /* one retry */ }
    }
    throw new Error(`Claude did not return valid JSON: ${last.slice(0, 200)}`);
  }
}
