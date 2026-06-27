import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { STATE_FILE } from "./paths.ts";

// "owner/repo#prNumber" -> last reviewed head sha. Skips re-reviewing the same
// commit when GitHub redelivers or fires duplicate events.
type State = Record<string, string>;

function load(): State {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State; } catch { return {}; }
}
export function lastReviewed(key: string): string | undefined {
  return load()[key];
}
export function markReviewed(key: string, sha: string): void {
  const s = load();
  s[key] = sha;
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
