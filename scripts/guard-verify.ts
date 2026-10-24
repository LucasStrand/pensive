// Honeypot plumbing check — model-free (PENSIVE_GATEWAY=mock), so it runs with
// no key and no network. It verifies the two rules the honeypot lives by:
// the caller always gets an answer, and facts may only ever accumulate.
process.env.PENSIVE_GATEWAY = "mock";

import { rmSync } from "node:fs";

// Its own case file, so a locally running server (which shares .pensive/guard)
// can't make the assertions flap. Env must be set before the module loads, hence
// the dynamic import below.
const CASES = "./.pensive/guard/test-cases.json";
process.env.GUARD_CASES_FILE = CASES;
rmSync(CASES, { force: true });

const { intake, list, stats } = await import("../src/server/guard.ts");

let pass = true;
function check(name: string, ok: boolean, detail = "") {
  pass = pass && ok;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

const fp = {
  kind: "strand.wf/fingerprint",
  ip: "203.0.113.9",
  class: "fuzzer",
  score: 41,
  conns: 38,
  entries: 6,
  usernames: ["aab", "a$B", "%s"],
  clients: ["SSH-2.0-OpenSSH_10.2"],
  payloads: ["PT6 drop: '; DROP TABLE guests;--"],
  site: "strand.wf",
};

const first = await intake(fp);
check("first report opens a case file", first.caseId.startsWith("strand.wf-203.0.113.9"), first.caseId);
check("a verdict is always produced", first.verdict.length > 0, JSON.stringify(first.verdict));
check("verdict falls back to facts with no model key", first.verdictBy === "facts", first.verdictBy);
check("facts are stored as received", first.usernames.join(",") === "aab,a$B,%s");

// A later, quieter report for the same ip must not erase what we already know.
const second = await intake({ ip: "203.0.113.9", class: "fuzzer", site: "strand.wf", payloads: ["PT7"] });
check("same ip reuses the case file", second.caseId === first.caseId);
check("hits count reports, not cases", second.hits === 2, `hits=${second.hits}`);
check("older facts survive a quiet report", second.usernames.length === 3, second.usernames.join(","));
check("new facts are appended", second.payloads.includes("PT7"));
check("observations accumulate in order", second.observations.length === 2);

const third = await intake({ ip: "198.51.100.7", class: "scanner", site: "strand.wf", conns: 2 });
check("a different ip is a different case", third.caseId !== first.caseId);
check("list is newest-first", list()[0]!.ip === "198.51.100.7");
check(
  "stats count cases and reports",
  stats().cases === 2 && stats().hits === 3,
  JSON.stringify(stats()),
);

// Two sites must not collide on the same ip.
const other = await intake({ ip: "203.0.113.9", class: "scanner", site: "other.site" });
check("the same ip on another site is a separate case", other.caseId !== first.caseId);

console.log(`\n${pass ? "ALL PASS" : "SOME FAILED"}: the honeypot answers even with no model key.`);
process.exit(pass ? 0 : 1);
