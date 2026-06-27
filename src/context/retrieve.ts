import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DiffSet, FileDiff } from "../ingest/diff.ts";

export interface FileContext {
  path: string;
  enclosing: string;       // nearest enclosing declaration line(s)
  window: string;          // source window around the change with line numbers
  related: string[];       // ripgrep hits for touched symbols elsewhere in repo
}

const DECL = /\b(function|def|class|interface|type|const|let|var|fn|func|public|private|protected|export|impl|struct|module)\b/;

function readWindow(repoRoot: string, f: FileDiff): { enclosing: string; window: string } {
  const abs = join(repoRoot, f.path);
  if (!existsSync(abs) || f.binary) return { enclosing: "", window: "" };
  let src: string[];
  try { src = readFileSync(abs, "utf8").split(/\r?\n/); } catch { return { enclosing: "", window: "" }; }

  const touched = f.hunks.flatMap((h) => h.lines.filter((l) => l.newLine).map((l) => l.newLine!));
  if (touched.length === 0) return { enclosing: "", window: "" };
  const lo = Math.max(1, Math.min(...touched) - 8);
  const hi = Math.min(src.length, Math.max(...touched) + 8);

  // Nearest enclosing declaration scanning upward from the first touched line.
  let enclosing = "";
  for (let i = Math.min(...touched) - 1; i >= 0 && i > lo - 40; i--) {
    const line = src[i] ?? "";
    if (DECL.test(line) && line.trim().length > 0) { enclosing = `${i + 1}: ${line.trim()}`; break; }
  }
  const window = src.slice(lo - 1, hi)
    .map((t, i) => `${String(lo + i).padStart(5)}  ${t}`)
    .join("\n");
  return { enclosing, window };
}

// Touched identifiers, used to find definitions/callers elsewhere via ripgrep.
function touchedSymbols(f: FileDiff): string[] {
  const ids = new Set<string>();
  for (const h of f.hunks) for (const l of h.lines) {
    if (l.kind === "ctx") continue;
    for (const m of l.text.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) ids.add(m[0]);
  }
  return [...ids].slice(0, 12);
}

function ripgrepRelated(repoRoot: string, symbols: string[], selfPath: string): string[] {
  if (symbols.length === 0) return [];
  const out: string[] = [];
  for (const sym of symbols.slice(0, 6)) {
    try {
      const res = execFileSync("rg", ["-n", "--max-count", "3", "-w", sym, "--glob", `!${selfPath}`],
        { cwd: repoRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 4000 });
      const hits = res.split(/\r?\n/).filter(Boolean).slice(0, 3);
      if (hits.length) out.push(`# ${sym}\n${hits.join("\n")}`);
    } catch { /* rg missing or no hits */ }
    if (out.length >= 6) break;
  }
  return out;
}

let rgAvailable: boolean | null = null;
function hasRg(): boolean {
  if (rgAvailable !== null) return rgAvailable;
  try { execFileSync("rg", ["--version"], { encoding: "utf8" }); rgAvailable = true; }
  catch { rgAvailable = false; }
  return rgAvailable;
}

export function retrieveContext(diff: DiffSet): FileContext[] {
  const useRg = hasRg();
  return diff.files.map((f) => {
    const { enclosing, window } = readWindow(diff.repoRoot, f);
    const related = useRg ? ripgrepRelated(diff.repoRoot, touchedSymbols(f), f.path) : [];
    return { path: f.path, enclosing, window, related };
  });
}

export function renderContext(ctx: FileContext): string {
  const parts: string[] = [`### context: ${ctx.path}`];
  if (ctx.enclosing) parts.push(`enclosing: ${ctx.enclosing}`);
  if (ctx.window) parts.push("source window:\n" + ctx.window);
  if (ctx.related.length) parts.push("related (other files):\n" + ctx.related.join("\n"));
  return parts.join("\n");
}
