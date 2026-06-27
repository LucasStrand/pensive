# Pensive webhook server — auto-review every PR

Run Pensive on your own machine as a GitHub App. Open a PR on any installed repo
(Hyperion, or all of them) and Pensive reviews it automatically, posting its
verdict as a PR review. Same loop as CodeRabbit, self-hosted, your model key.

```
GitHub PR event ──► smee.io ──► localhost:3000/webhook ──► review() ──► PR comment
```

The server only turns a PR event into a `review({mode:"range", ...})` call against
a local checkout and posts the markdown back. The review pipeline is unchanged.

## One-time setup

### 1. Register a GitHub App
GitHub → Settings → Developer settings → **GitHub Apps** → **New GitHub App**.

- **Webhook URL:** your smee channel — go to https://smee.io, click *Start a new
  channel*, paste that URL here (e.g. `https://smee.io/AbCd1234`).
- **Webhook secret:** generate a long random string; you'll put the same value in
  `.env` as `GITHUB_WEBHOOK_SECRET`.
- **Repository permissions:**
  - Contents: **Read-only** (to clone)
  - Pull requests: **Read & write** (to post reviews)
  - Metadata: **Read-only** (default)
- **Subscribe to events:** ✅ **Pull request**
- Create the app, then **Generate a private key** → downloads a `.pem`. Save it in
  the repo folder (it's gitignored) and note its path.
- Note the **App ID** (top of the app's settings page).

### 2. Install the App on your account
On the app page → **Install App** → choose your account → **All repositories**
(or just Hyperion to start). This is what makes "all my repos" work.

### 3. Fill in `.env`
```sh
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=./pensive-app.private-key.pem
GITHUB_WEBHOOK_SECRET=the-same-secret-you-set-in-the-app
PENSIVE_PORT=3000
PENSIVE_SMEE_URL=https://smee.io/AbCd1234
```

## Run it (two terminals)

```sh
# terminal 1 — the reviewer
npm run server

# terminal 2 — forward GitHub's webhooks to localhost
npx --yes smee-client --url https://smee.io/AbCd1234 --target http://localhost:3000/webhook
```

Open or push to a PR on an installed repo → a **Pensive review** appears within a
minute. `npm run server` logs every delivery: `reviewed`, `skipped`, or `ERROR`.

## How it behaves
- Reviews on: PR **opened**, **synchronize** (new push), **reopened**, **ready_for_review**.
- Skips: drafts, and any commit SHA it already reviewed (dedupe via
  `.pensive/server-state.json`).
- Jobs run **one at a time** (serialized) to bound model cost and rate limits.
- Each installed repo is cloned once under `.pensive/repos/<owner>/<name>/` and
  fetched fresh per event; the existing rulepacks/linters judge it in place.

## Notes & next steps
- **Cost:** unlike a flat CodeRabbit seat, each review bills your model key.
- **Always-on:** for a stable URL that survives reboots, swap smee for a
  Cloudflare Tunnel pointing at `http://localhost:3000` and set that as the App's
  webhook URL instead.
- **Inline comments:** currently posts one summary review. Findings already carry
  `file`+`line`, so per-line comments via the reviews API are a drop-in upgrade in
  `src/server/post.ts`.
