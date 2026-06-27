import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type LineKind = "add" | "del" | "ctx";
export type DiffMode = "working" | "staged" | "range" | "file";

export interface DiffLine { kind: LineKind; text: string; newLine?: number; oldLine?: number; }
export interface Hunk { header: string; oldStart: number; newStart: number; lines: DiffLine[]; }
export interface FileDiff {
  path: string; oldPath?: string; language: string;
  added: number; deleted: number; binary: boolean; isNew: boolean; isDeleted: boolean; hunks: Hunk[];
}
export interface DiffSet { repoRoot: string; files: FileDiff[]; totalAdded: number; totalDeleted: number; mode: DiffMode; }

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", go: "go", rs: "rust", java: "java", rb: "ruby", php: "php",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp", cs: "csharp",
  swift: "swift", kt: "kotlin", scala: "scala", sh: "shell", sql: "sql",
  json: "json", yaml: "yaml", yml: "yaml", md: "markdown",
};
export function languageOf(path: string): string {
  return EXT_LANG[path.split(".").pop()?.toLowerCase() ?? ""] ?? "unknown";
}

// Don't waste the budget reviewing generated / vendored / lock files.
const IGNORE_DIR = /(^|\/)(node_modules|dist|build|out|\.next|coverage|vendor|target|\.venv|__pycache__|\.git)\//i;
const IGNORE_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|go\.sum|composer\.lock|Gemfile\.lock)$|\.(min\.(js|css)|map|snap)$/i;
export function reviewable(p: string): boolean { return !IGNORE_DIR.test(p) && !IGNORE_FILE.test(p); }

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 96 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

export function getDiff(opts: { mode?: DiffMode; base?: string; head?: string; diffFile?: string; cwd?: string }): DiffSet {
  const cwd = opts.cwd ?? process.cwd();
  const mode: DiffMode = opts.mode ?? (opts.diffFile ? "file" : (opts.base || opts.head) ? "range" : "working");
  let raw = "";
  try {
    if (mode === "file") raw = readFileSync(opts.diffFile!, "utf8");
    else if (mode === "staged") raw = git(cwd, ["diff", "--no-color", "--cached"]);
    else if (mode === "range") raw = git(cwd, ["diff", "--no-color", `${opts.base ?? "HEAD~1"}...${opts.head ?? "HEAD"}`]);
    else raw = git(cwd, ["diff", "--no-color", "HEAD"]); // working tree vs HEAD (all uncommitted)
  } catch (e: any) {
    throw new Error(mode === "file" ? `cannot read diff file: ${opts.diffFile}` : `git diff failed (is this a git repo? does the ref exist?): ${e?.message ?? e}`);
  }
  let repoRoot = cwd;
  try { repoRoot = git(cwd, ["rev-parse", "--show-toplevel"]).trim() || cwd; } catch { /* file mode */ }

  const ds = parseUnifiedDiff(raw, repoRoot);
  ds.mode = mode;
  ds.files = ds.files.filter((f) => reviewable(f.path));
  ds.totalAdded = ds.files.reduce((s, f) => s + f.added, 0);
  ds.totalDeleted = ds.files.reduce((s, f) => s + f.deleted, 0);
  return ds;
}

export function parseUnifiedDiff(raw: string, repoRoot: string): DiffSet {
  const files: FileDiff[] = [];
  const lines = raw.split(/\r?\n/);
  let cur: FileDiff | null = null, hunk: Hunk | null = null, newLine = 0, oldLine = 0;
  const push = () => { if (cur) { if (hunk) cur.hunks.push(hunk); files.push(cur); } hunk = null; };

  for (const ln of lines) {
    if (ln.startsWith("diff --git")) {
      push();
      cur = { path: "", language: "unknown", added: 0, deleted: 0, binary: false, isNew: false, isDeleted: false, hunks: [] };
      const m = ln.match(/ b\/(.+)$/);
      if (m) { cur.path = m[1]; cur.language = languageOf(m[1]); }
      continue;
    }
    if (!cur) continue;
    if (ln.startsWith("new file")) { cur.isNew = true; continue; }
    if (ln.startsWith("deleted file")) { cur.isDeleted = true; continue; }
    if (ln.startsWith("Binary files")) { cur.binary = true; continue; }
    if (ln.startsWith("--- ")) { const m = ln.match(/^--- a\/(.+)$/); if (m) cur.oldPath = m[1]; continue; }
    if (ln.startsWith("+++ ")) { const m = ln.match(/^\+\+\+ b\/(.+)$/); if (m && !cur.path) { cur.path = m[1]; cur.language = languageOf(m[1]); } continue; }
    if (ln.startsWith("@@")) {
      if (hunk) cur.hunks.push(hunk);
      const m = ln.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = m ? parseInt(m[1], 10) : 0; newLine = m ? parseInt(m[2], 10) : 0;
      hunk = { header: ln, oldStart: oldLine, newStart: newLine, lines: [] };
      continue;
    }
    if (!hunk) continue;
    if (ln.startsWith("+")) { hunk.lines.push({ kind: "add", text: ln.slice(1), newLine }); cur.added++; newLine++; }
    else if (ln.startsWith("-")) { hunk.lines.push({ kind: "del", text: ln.slice(1), oldLine }); cur.deleted++; oldLine++; }
    else if (ln.startsWith(" ")) { hunk.lines.push({ kind: "ctx", text: ln.slice(1), newLine, oldLine }); newLine++; oldLine++; }
  }
  push();
  return { repoRoot, files, totalAdded: 0, totalDeleted: 0, mode: "range" };
}

export function renderFileDiff(f: FileDiff): string {
  const head = `### ${f.path} (+${f.added} -${f.deleted})`;
  const body = f.hunks.map((h) => {
    const ls = h.lines.map((l) => {
      const sign = l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ";
      const lineNo = l.newLine ?? l.oldLine ?? "";
      return `${String(lineNo).padStart(5)} ${sign}${l.text}`;
    }).join("\n");
    return `${h.header}\n${ls}`;
  }).join("\n");
  return `${head}\n${body}`;
}
