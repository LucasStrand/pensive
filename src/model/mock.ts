import type { z } from "zod";
import type { ModelGateway, ModelRequest } from "./gateway.ts";

// Deterministic, key-free gateway for PLUMBING tests. It does not analyze code;
// it returns minimal well-formed fixtures so the full pipeline runs end-to-end.
// Real behavioral verification requires ANTHROPIC_API_KEY + ClaudeGateway.
export class MockGateway implements ModelGateway {
  readonly name = "mock";

  async text(_req: ModelRequest): Promise<string> {
    return "This change adjusts behavior in the touched files.";
  }

  async json<T>(req: ModelRequest & { schema: z.ZodType<T> }): Promise<T> {
    const p = req.prompt.toLowerCase();
    let fixture: unknown = {};
    if (p.includes("reconstruct the intent")) {
      fixture = { clear: true, statement: "This change modifies the touched code to fix or extend behavior.", concerns: [] };
    } else if (p.includes("try to refute")) {
      fixture = { survives: true, reason: "evidence is consistent with the claim", adjustedConfidence: 0.55 };
    } else if (p.includes("standout") || p.includes("exceptional")) {
      fixture = { file: "", line: 0, what: "", why: "", author: "unknown", authorIsAI: false, signal: "", confidence: 0.1 };
    } else if (p.includes("findings")) {
      fixture = { findings: [{ file: "(mock)", line: 0, severity: "nit", title: "Mock finding (plumbing only)", body: "MockGateway emits one finding to exercise the render path.", evidence: "mock", confidence: 0.5 }] };
    }
    return req.schema.parse(fixture);
  }
}
