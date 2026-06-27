import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function privateKey(): string {
  const path = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (path) return readFileSync(path, "utf8");
  const inline = process.env.GITHUB_APP_PRIVATE_KEY;
  if (inline) return inline.replace(/\n/g, "\n");
  throw new Error("set GITHUB_APP_PRIVATE_KEY_PATH (path to the .pem) or GITHUB_APP_PRIVATE_KEY");
}

// App-level JWT (RS256), valid ~9 min, used only to mint installation tokens.
function appJwt(): string {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new Error("set GITHUB_APP_ID");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 30, exp: now + 540, iss: appId }));
  const data = header + "." + payload;
  const sig = b64url(createSign("RSA-SHA256").update(data).sign(privateKey()));
  return data + "." + sig;
}

interface CachedToken { token: string; exp: number; }
const tokenCache = new Map<number, CachedToken>();

// Short-lived installation token (rotates hourly). Cached until ~1 min before expiry.
export async function installationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.exp - 60_000 > Date.now()) return cached.token;
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${appJwt()}`, Accept: "application/vnd.github+json", "User-Agent": "pensive" },
  });
  if (!res.ok) throw new Error(`installation token failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token: string; expires_at: string };
  tokenCache.set(installationId, { token: body.token, exp: Date.parse(body.expires_at) });
  return body.token;
}

// Thin GitHub REST helper bound to an installation token.
export async function gh(token: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "pensive",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
