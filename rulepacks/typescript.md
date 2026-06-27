Review lens for TypeScript / JavaScript. Judge against THIS repo's existing patterns first.

Material things worth a comment:
- Real correctness bugs: unhandled null/undefined, off-by-one, await-less promises, unhandled rejections, incorrect narrowing.
- Type holes that defeat the point of types: stray `any`, unsafe `as` casts, non-null `!` hiding a real nullable.
- Resource/async hazards: missing cleanup, race conditions, unbounded concurrency, swallowed errors (empty catch).
- API/contract breaks: changed exported signatures, removed fields callers rely on.

Do NOT comment on (unless the repo clearly cares):
- Formatting, import order, quote style, semicolons — a linter owns these.
- Subjective style or micro-optimizations with no measured impact.

Tooling that may have already settled facts: eslint, tsc, biome. Never repeat their findings.
