import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startServer } from "./http.ts";

// Load .env from the cwd and from the install root (mirrors src/cli.ts).
const here = dirname(fileURLToPath(import.meta.url));
for (const p of [join(process.cwd(), ".env"), join(here, "..", "..", ".env")]) {
  try { (process as any).loadEnvFile(p); } catch { /* none */ }
}

const port = parseInt(process.env.PENSIVE_PORT ?? "3000", 10);
const secret = process.env.GITHUB_WEBHOOK_SECRET;

if (!secret) { console.error("set GITHUB_WEBHOOK_SECRET in .env (must match the GitHub App's webhook secret)"); process.exit(1); }
if (!process.env.GITHUB_APP_ID) { console.error("set GITHUB_APP_ID in .env"); process.exit(1); }
if (!process.env.GITHUB_APP_PRIVATE_KEY_PATH && !process.env.GITHUB_APP_PRIVATE_KEY) {
  console.error("set GITHUB_APP_PRIVATE_KEY_PATH (path to the App .pem) in .env"); process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENROUTER_API_KEY && process.env.PENSIVE_GATEWAY !== "mock") {
  console.warn("⚠️  no model key (ANTHROPIC_API_KEY / OPENROUTER_API_KEY) — reviews will use the MOCK engine");
}

startServer(port, secret);
