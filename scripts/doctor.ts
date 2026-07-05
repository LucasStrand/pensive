// Pensive doctor — answers one question with certainty: "Is Pensive actually
// wired into my pull requests, like CodeRabbit?"
//
// It asks GitHub itself (the source of truth), not the local state file:
//   1. Are the App credentials valid?         GET /app
//   2. Is the App installed anywhere?          GET /app/installations
//   3. What repos can it see/post to?          GET /installation/repositories
//   4. Has it ever commented on a PR?          scan recent PRs for our marker
//   5. Is the local webhook server up?         GET localhost:PORT/health
//   6. Is a public tunnel configured?          PENSIVE_SMEE_URL in .env
//
// Run:  npm run doctor   (or: node scripts/doctor.ts)

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { appJwt, installationToken, gh } from "../src/server/githubApp.ts";

// Mirror the server's .env loading so the doctor sees the same config.
const here = dirname(fileURLToPath(import.meta.url));
for (const p of [join(process.cwd(), ".env"), join(here, "..", ".env")]) {
  try { (process as any).loadEnvFile(p); } catch { /* none */ }
}

const MARKER = "<!-- pensive:status -->"; // must match src/server/post.ts
const ok = "✅", no = "❌", warn = "⚠️ ", dot = "•";
const log = (...a: unknown[]) => console.log(...a);

// App-JWT-authenticated GET (for app-scoped endpoints the installation token can't reach).
async function ghAppGet(path: string): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${appJwt()}`, Accept: "application/vnd.github+json", "User-Agent": "pensive-doctor" },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  log(`\n=== Pensive doctor ===\n`);

  // ---- env presence -------------------------------------------------------
  const need = ["GITHUB_APP_ID", "GITHUB_WEBHOOK_SECRET"];
  const hasKey = !!process.env.GITHUB_APP_PRIVATE_KEY_PATH || !!process.env.GITHUB_APP_PRIVATE_KEY;
  for (const k of need) log(`${process.env[k] ? ok : no} ${k} ${process.env[k] ? "set" : "MISSING"}`);
  log(`${hasKey ? ok : no} private key ${hasKey ? "set" : "MISSING (GITHUB_APP_PRIVATE_KEY_PATH)"}`);
  if (!process.env.GITHUB_APP_ID || !hasKey) {
    log(`\n${no} Can't talk to GitHub without the App ID + private key. Fill those in .env first.\n`);
    process.exit(1);
  }

  // ---- 1. credentials valid? → also tells us the bot's name on PRs --------
  let slug = "pensive";
  try {
    const app = await ghAppGet("/app");
    slug = app.slug;
    log(`${ok} App credentials valid — this is "${app.name}". On PRs it comments as: ${slug}[bot]`);
    // The in_progress check is the signal OTHER agents poll. It only appears if the
    // App holds "Checks: write" — if it doesn't, reviews still comment but no bot can
    // see "review in flight", so they may conclude the PR prematurely.
    const checksPerm = app.permissions?.checks;
    if (checksPerm === "write") {
      log(`${ok} Checks: write — the "${slug}" in_progress check WILL appear for other agents to wait on.`);
    } else {
      log(`${warn}Checks permission is "${checksPerm ?? "none"}", not "write" — Pensive will comment, but the`);
      log(`   machine-readable "reviewing" check WON'T post, so other bots can't see the review in flight.`);
      log(`   → Fix: App settings → Permissions → Repository → Checks: Read & write → save → accept the`);
      log(`     permission update on the installation.`);
    }
  } catch (e: any) {
    log(`${no} App credentials REJECTED by GitHub: ${e.message}`);
    log(`   → Wrong GITHUB_APP_ID, or the .pem doesn't match this app. Pensive cannot post until this is fixed.\n`);
    process.exit(1);
  }

  // ---- 2. installed anywhere? --------------------------------------------
  const installs: any[] = await ghAppGet("/app/installations");
  if (!installs.length) {
    log(`\n${no} The App is NOT installed on any account.`);
    log(`   → This is almost certainly why you see nothing on PRs.`);
    log(`   → Fix: open the App's public page → "Install App" → pick your account → choose repos.`);
    log(`   → (GitHub → Settings → Developer settings → GitHub Apps → your app → Install App)\n`);
    process.exit(1);
  }
  log(`${ok} Installed on ${installs.length} account(s):`);

  // ---- 3 + 4. per install: repos it can see, and whether it's commented --
  let reposSeen = 0, prsScanned = 0, prsWithPensive = 0;
  for (const inst of installs) {
    const acct = inst.account?.login ?? "(unknown)";
    const scope = inst.repository_selection; // "all" | "selected"
    log(`   ${dot} ${acct} — repos: ${scope}`);
    const token = await installationToken(inst.id);

    const repoResp = (await gh(token, "GET", "/installation/repositories?per_page=100")) as any;
    const repos: any[] = repoResp.repositories ?? [];
    reposSeen += repos.length;
    if (!repos.length) { log(`       ${warn}can see 0 repos (selection may be empty)`); continue; }

    for (const r of repos.slice(0, 20)) {
      // Look at recent PRs (open + closed) for our sticky marker comment.
      const prs = (await gh(token, "GET",
        `/repos/${r.full_name}/pulls?state=all&per_page=10&sort=updated&direction=desc`)) as any[];
      let hitsHere = 0;
      for (const pr of prs) {
        prsScanned++;
        const comments = (await gh(token, "GET",
          `/repos/${r.full_name}/issues/${pr.number}/comments?per_page=100`)) as any[];
        if (comments.some((c) => c.body?.includes(MARKER))) { hitsHere++; prsWithPensive++; }
      }
      const tag = hitsHere ? `${ok} commented on ${hitsHere} of last ${prs.length} PRs` : `${dot} no Pensive comments yet`;
      log(`       ${r.full_name.padEnd(40)} ${tag}`);
    }
    if (repos.length > 20) log(`       …and ${repos.length - 20} more repo(s) not scanned`);
  }

  // ---- 5. local server up? -----------------------------------------------
  const port = process.env.PENSIVE_PORT ?? "3000";
  let serverUp = false;
  try {
    const r = await fetch(`http://localhost:${port}/health`);
    serverUp = r.ok;
  } catch { /* not listening */ }
  log(`\n${serverUp ? ok : no} Local webhook server ${serverUp ? `is running on :${port}` : `is NOT running (start it: npm run server)`}`);

  // ---- 6. how does GitHub reach this server? -----------------------------
  // Two valid setups: (a) deployed on a public host (e.g. ssh.strand.wf) where the
  // App webhook points straight at https://<host>/webhook — set PENSIVE_PUBLIC_URL;
  // or (b) a local dev box behind a smee tunnel — set PENSIVE_SMEE_URL.
  const publicUrl = process.env.PENSIVE_PUBLIC_URL;
  const smee = process.env.PENSIVE_SMEE_URL;
  if (publicUrl) {
    log(`${ok} Public host configured: ${publicUrl}`);
    log(`   → Set the GitHub App's Webhook URL to: ${publicUrl.replace(/\/$/, "")}/webhook`);
    log(`   → No smee needed — GitHub posts directly to this host. Make sure :${port} is reachable (reverse proxy / TLS).`);
  } else if (smee) {
    log(`${ok} Smee tunnel configured: ${smee}`);
    log(`   → it must be forwarding: npx --yes smee-client --url ${smee} --target http://localhost:${port}/webhook`);
  } else {
    log(`${warn}No public endpoint set. GitHub's webhooks have nowhere to reach this server.`);
    log(`   → Deployed (ssh.strand.wf): set PENSIVE_PUBLIC_URL=https://ssh.strand.wf and point the App webhook there.`);
    log(`   → Local dev: set PENSIVE_SMEE_URL and run the smee-client forwarder.`);
  }

  // ---- verdict ------------------------------------------------------------
  log(`\n=== Verdict ===`);
  if (prsWithPensive > 0) {
    log(`${ok} CONFIRMED: Pensive has posted on ${prsWithPensive} PR(s). It IS appearing — look for the "${slug}[bot]" comment.`);
  } else {
    log(`${warn}Pensive is installed & can see ${reposSeen} repo(s), but hasn't commented on any of the ${prsScanned} recent PRs scanned.`);
    log(`   For a live end-to-end confirmation, the chain must ALL be up at once:`);
    log(`     1. npm run server                                  (this machine)`);
    log(`     2. smee-client forwarding to /webhook              (the tunnel)`);
    log(`     3. open or push to a PR on an installed repo       (the trigger)`);
    log(`   Then re-run: npm run doctor  →  it'll flip to CONFIRMED.`);
  }
  log("");
}

main().catch((e) => { console.error(`\n${no} doctor crashed:`, e?.message ?? e, "\n"); process.exit(1); });
