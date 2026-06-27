# Pensive

An open-source, self-hostable AI code reviewer with the temperament of a good senior
engineer: it reconstructs intent, judges against the repo's own conventions, refutes its
own findings before speaking, rations its words, and treats silence as a valid output.
**Quiet and right.**

It also does something no other reviewer brands: **Standout Recognition** — rare, genuine
praise (a "Bravo") when a change does something exceptional, attributed to the author,
including when an AI wrote it.

## Quickstart (use it on your repo)

```sh
# 1. one-time: install deps + give it a key
cd C:\Users\lucas\Documents\quiet
npm install
echo ANTHROPIC_API_KEY=sk-ant-... > .env        # or: export ANTHROPIC_API_KEY=...

# 2. from inside YOUR project, review your work
cd /path/to/your/project
node C:/Users/lucas/Documents/quiet/src/cli.ts review                 # uncommitted changes
node C:/Users/lucas/Documents/quiet/src/cli.ts review --base main     # branch vs main (PR-style)
```

Review modes:
- `review` — working-tree changes (vs HEAD). *Note: brand-new untracked files aren't
  included; `git add -A` then `review --staged` to include them.*
- `review --staged` — staged changes only
- `review --base main --head HEAD` — a branch/range, like a PR
- `review --diff x.diff` — a saved unified diff

Useful flags: `--fail-on bug` (non-zero exit for pre-commit/CI gating), `--max-comments N`,
`--passes N`, `--json`.

## Pipeline

`ingest -> intent -> {linters, context} -> multi-pass findings -> refute/judge -> budget -> render`
plus a positive branch: deterministic signal -> high-bar Bravo (rationed by a regenerating
praise token). A fast model nominates; a strong model judges. All LLM calls go through
`ModelGateway`, so BYO/local backends slot in without touching the pipeline.

## Status

Usable MVP — local CLI. Lockfiles/`dist`/`node_modules` are auto-skipped. Rule packs:
TS/JS, Python, Rust, Go. Next: GitHub App surface + the action-rate learning loop.
