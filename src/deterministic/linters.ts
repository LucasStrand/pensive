import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { DiffSet } from "../ingest/diff.ts";

// A deterministic FACT from a tool — not an opinion. The model is told these are
// already settled so it does not waste its comment budget re-litigating them.
export interface LinterFact {
  tool: string;
  file: string;
  line: number;
  code: string;
  message: string;
}

const cache = new Map<string, boolean>();
function has(cmd: string): boolean {
  if (cache.has(cmd)) return cache.get(cmd)!;
  let ok = false;
  try { execFileSync(cmd, ["--version"], { encoding: "utf8", timeout: 5000 }); ok = true; }
  catch { ok = false; }
  cache.set(cmd, ok);
  return ok;
}

function run(cmd: string, args: string[], cwd: string): string {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
  } catch (e: any) {
    // Most linters exit non-zero when they find issues; stdout still holds the report.
    return e?.stdout?.toString?.() ?? "";
  }
}

function ruff(repoRoot: string, files: string[]): LinterFact[] {
  if (!has("ruff") || files.length === 0) return [];
  const out = run("ruff", ["check", "--output-format", "json", ...files], repoRoot);
  try {
    const arr = JSON.parse(out);
    return (Array.isArray(arr) ? arr : []).map((d: any) => ({
      tool: "ruff",
      file: d.filename ?? "",
      line: d.location?.row ?? 0,
      code: d.code ?? "",
      message: d.message ?? "",
    }));
  } catch { return []; }
}

function eslint(repoRoot: string, files: string[]): LinterFact[] {
  if (!has("eslint") || files.length === 0) return [];
  const out = run("eslint", ["--format", "json", ...files], repoRoot);
  try {
    const arr = JSON.parse(out);
    const facts: LinterFact[] = [];
    for (const file of arr ?? []) for (const m of file.messages ?? []) {
      facts.push({ tool: "eslint", file: file.filePath ?? "", line: m.line ?? 0, code: m.ruleId ?? "", message: m.message ?? "" });
    }
    return facts;
  } catch { return []; }
}

export interface DeterministicResult { facts: LinterFact[]; toolsRun: string[]; toolsMissing: string[]; }

export function runLinters(diff: DiffSet): DeterministicResult {
  const byLang = (langs: string[]) =>
    diff.files.filter((f) => langs.includes(f.language) && !f.isDeleted && existsSync(join(diff.repoRoot, f.path)))
      .map((f) => f.path);

  const py = byLang(["python"]);
  const js = byLang(["javascript", "typescript"]);

  const facts: LinterFact[] = [];
  const toolsRun: string[] = [];
  const toolsMissing: string[] = [];

  if (py.length) (has("ruff") ? toolsRun : toolsMissing).push("ruff");
  if (js.length) (has("eslint") ? toolsRun : toolsMissing).push("eslint");

  facts.push(...ruff(diff.repoRoot, py));
  facts.push(...eslint(diff.repoRoot, js));
  return { facts, toolsRun, toolsMissing };
}

export function renderFacts(r: DeterministicResult): string {
  if (r.facts.length === 0) {
    return r.toolsRun.length
      ? `Linters run (${r.toolsRun.join(", ")}): no issues.`
      : "No linters available for the changed languages.";
  }
  const lines = r.facts.slice(0, 50).map((f) => `- ${f.file}:${f.line} [${f.tool} ${f.code}] ${f.message}`);
  return `Deterministic linter facts (already settled — do NOT repeat these):\n${lines.join("\n")}`;
}
