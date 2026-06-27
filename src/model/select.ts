import type { ModelGateway } from "./gateway.ts";
import { ClaudeGateway } from "./claude.ts";
import { OpenRouterGateway } from "./openrouter.ts";
import { MockGateway } from "./mock.ts";

// PENSIVE_GATEWAY forces a backend; otherwise pick by which key is present.
export function selectGateway(): ModelGateway {
  const forced = process.env.PENSIVE_GATEWAY;
  if (forced === "mock") return new MockGateway();
  if (forced === "claude") return new ClaudeGateway();
  if (forced === "openrouter") return new OpenRouterGateway();
  if (process.env.ANTHROPIC_API_KEY) return new ClaudeGateway();
  if (process.env.OPENROUTER_API_KEY) return new OpenRouterGateway();
  return new MockGateway();
}
