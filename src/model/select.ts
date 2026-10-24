import type { ModelGateway } from "./gateway.ts";
import { ClaudeGateway } from "./claude.ts";
import { OpenRouterGateway } from "./openrouter.ts";
import { VeniceGateway } from "./venice.ts";
import { MockGateway } from "./mock.ts";

// PENSIVE_GATEWAY forces a backend; otherwise pick by which key is present.
// Venice is checked before OpenRouter because it is the key that actually works
// for this deployment (the OpenRouter one is revoked).
export function selectGateway(): ModelGateway {
  const forced = process.env.PENSIVE_GATEWAY;
  if (forced === "mock") return new MockGateway();
  if (forced === "claude") return new ClaudeGateway();
  if (forced === "openrouter") return new OpenRouterGateway();
  if (forced === "venice") return new VeniceGateway();
  if (process.env.ANTHROPIC_API_KEY) return new ClaudeGateway();
  if (process.env.VENICE_API_KEY) return new VeniceGateway();
  if (process.env.OPENROUTER_API_KEY) return new OpenRouterGateway();
  return new MockGateway();
}
