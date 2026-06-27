import { getDiff } from "../src/ingest/diff.ts";
import { computeSignals } from "../src/standout/nominate.ts";

const fixtures = ["nitbait", "bug", "deletion"];
let pass = true;

console.log("=== Standout nomination gate (deterministic, model-free) ===\n");
for (const name of fixtures) {
  const diff = getDiff({ diffFile: `test/fixtures/${name}.diff` });
  const signals = computeSignals(diff);
  const nominated = signals.length > 0;
  const expected = name === "deletion"; // only the 10x deletion should be eligible for praise
  const ok = nominated === expected;
  pass = pass && ok;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(9)} files=${diff.files.length} (+${diff.totalAdded}/-${diff.totalDeleted})  nominated=${nominated} expected=${expected}`);
  for (const s of signals) console.log(`        signal: ${s.kind} in ${s.file} — ${s.detail} (strength ${s.strength.toFixed(2)})`);
}

console.log(`\n${pass ? "ALL PASS" : "SOME FAILED"}: praise is only ever *considered* on exceptional diffs.`);
process.exit(pass ? 0 : 1);
