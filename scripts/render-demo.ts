import { renderReview } from "../src/render/markdown.ts";

const meta = { passes: 3, toolsRun: ["ruff"], toolsMissing: [], dropped: 0, gateway: "claude" };

console.log("############ CASE A: nothing material (silence is a feature) ############\n");
console.log(renderReview({
  intent: { clear: true, statement: "This change is trying to rename an internal helper because the old name was misleading.", concerns: [] },
  findings: [], bravo: null, meta,
}));

console.log("\n\n############ CASE B: a genuine Standout (10x deletion, AI author) ############\n");
console.log(renderReview({
  intent: { clear: true, statement: "This change is trying to simplify CSV parsing because the hand-rolled scanner was hard to maintain.", concerns: [] },
  findings: [],
  bravo: {
    file: "src/parse.ts", line: 1,
    what: "Replaced a 25-line hand-rolled character scanner with a single, readable split+map.",
    why: "Same behavior, a quarter of the surface area, and it reads at a glance — exactly the kind of deletion this codebase rewards.",
    author: "Claude", authorIsAI: true, signal: "net-deletion: removed 23, added 3", confidence: 0.9,
  },
  meta: { ...meta, dropped: 1 },
}));

console.log("\n\n############ CASE C: unclear intent + a real bug + a held-back finding ############\n");
console.log(renderReview({
  intent: { clear: false, statement: "The diff changes loop bounds but neither the title nor description say why; can't tell if skipping the first row is intended.", concerns: ["Loop now starts at index 1, silently dropping the first item"] },
  findings: [
    { file: "app/cart.py", line: 11, severity: "bug", title: "Total now skips the first item", body: "`range(1, len(items))` starts at 1, so `items[0]` is never summed. If a header row was meant to be skipped, slice the input instead so the intent is explicit.", evidence: "line 11: for i in range(1, len(items))", confidence: 0.86 },
  ],
  bravo: null,
  meta: { ...meta, dropped: 2 },
}));
