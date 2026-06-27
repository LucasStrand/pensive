import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK_DIR = join(HERE, "..", "rulepacks");

// Per-language review lens loaded as DATA, not code. Reviewability is a property
// of the reviewed language; we manage it by which packs exist.
export function loadRulePacks(languages: string[]): string {
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const lang of languages) {
    if (seen.has(lang)) continue;
    seen.add(lang);
    const p = join(PACK_DIR, `${lang}.md`);
    if (existsSync(p)) {
      try { blocks.push(`## Rule pack: ${lang}\n${readFileSync(p, "utf8").trim()}`); } catch { /* ignore */ }
    }
  }
  return blocks.join("\n\n");
}
