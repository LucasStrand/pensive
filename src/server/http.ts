import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { verifySignature } from "./verify.ts";
import { enqueue } from "./queue.ts";
import { handleEvent } from "./handler.ts";
import { intake, list, stats } from "./guard.ts";

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body, null, 2));
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// Shared-secret check for the honeypot endpoint. Unset secret = open (fine for a
// toy; a forged fingerprint costs nothing).
function guardAuthed(req: IncomingMessage): boolean {
  const want = process.env.GUARD_SECRET;
  if (!want) return true;
  const got = (req.headers["x-guard-secret"] as string) ?? "";
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

// The honeypot's own front page: what it caught, named.
function guardPage(): string {
  const s = stats();
  const rows = list()
    .slice(0, 60)
    .map(
      (c) => `<tr>
      <td class="mono">${esc(c.ip)}</td>
      <td>${esc(c.verdict)}</td>
      <td>${c.hits}</td>
      <td>${c.usernames.map(esc).join("<br>")}</td>
      <td class="dim">${c.payloads.slice(-3).map(esc).join("<br>")}</td>
      <td class="dim">${esc(c.lastSeen)}</td>
    </tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>pensive · honeypot</title>
<style>
 body{margin:0;padding:2rem 1rem;background:#11111b;color:#cdd6f4;font:14px/1.6 ui-monospace,Menlo,monospace}
 .wrap{max-width:1000px;margin:0 auto}
 h1{color:#cba6f7;font-size:1.3rem;margin:0 0 .3rem}
 .sub{color:#6c7086;font-style:italic}
 table{width:100%;border-collapse:collapse;font-size:13px;margin-top:1.5rem}
 th{text-align:left;color:#6c7086;font-weight:500;border-bottom:1px solid #313244;padding:.4rem .5rem}
 td{padding:.45rem .5rem;border-bottom:1px solid #1e1e2e;vertical-align:top}
 .mono{color:#f5c2e7}.dim{color:#a6adc8}
 h2{color:#94e2d5;font-size:1rem;margin-top:2rem}
 pre{color:#a6adc8;overflow-x:auto}
</style></head><body><div class="wrap">
<h1>pensive as a honeypot</h1>
<p class="sub">strand.wf's front door posts the clients its guard flags here, and this names them.
cases <b>${s.cases}</b> · reports <b>${s.hits}</b> · payloads kept <b>${s.payloads}</b> · json at <a href="/guard">/guard</a></p>
<table><thead><tr><th>ip</th><th>verdict</th><th>reports</th><th>usernames seen</th><th>last payloads</th><th>last seen</th></tr></thead>
<tbody>${rows || `<tr><td colspan="6" class="dim">nothing caught yet — POST a fingerprint to /guard</td></tr>`}</tbody></table>
<h2>api</h2>
<pre>POST /guard   (header x-guard-secret)
  { ip, class, score, conns, entries, usernames[], clients[], payloads[] }
  -&gt; { verdict, verdictBy, caseId, hits }

GET  /guard   every case file as json</pre>
</div></body></html>`;
}

export function startServer(port: number, secret: string): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/healthz")) { res.writeHead(200).end("ok"); return; }

    // --- honeypot surface: strand.wf (or anything else) reports clients here --
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(guardPage());
      return;
    }
    if (req.method === "GET" && req.url === "/guard") {
      json(res, 200, { stats: stats(), cases: list() });
      return;
    }
    if (req.method === "POST" && req.url === "/guard") {
      if (!guardAuthed(req)) { json(res, 401, { error: "bad secret" }); return; }
      let fp: any;
      try {
        fp = JSON.parse((await readRaw(req)).toString("utf8"));
      } catch { json(res, 400, { error: "bad json" }); return; }
      if (!fp?.ip) { json(res, 400, { error: "ip required" }); return; }
      try {
        const c = await intake(fp);
        console.log(`[guard] ${fp.ip} ${fp.class ?? "?"} score=${fp.score ?? 0} -> ${c.verdict}`);
        json(res, 200, { verdict: c.verdict, verdictBy: c.verdictBy, caseId: c.caseId, hits: c.hits });
      } catch (err: any) {
        console.log(`[guard] intake failed: ${err?.message ?? err}`);
        json(res, 500, { error: "intake failed" });
      }
      return;
    }

    // --- github app webhook (unchanged) -------------------------------------
    if (req.method !== "POST" || req.url !== "/webhook") { res.writeHead(404).end("not found"); return; }

    const raw = await readRaw(req);
    if (!verifySignature(secret, raw, req.headers["x-hub-signature-256"] as string | undefined)) {
      res.writeHead(401).end("bad signature");
      return;
    }

    const event = (req.headers["x-github-event"] as string) ?? "unknown";
    const delivery = (req.headers["x-github-delivery"] as string) ?? "?";
    let payload: any;
    try { payload = JSON.parse(raw.toString("utf8")); }
    catch { res.writeHead(400).end("bad json"); return; }

    // Ack fast — GitHub wants a response in <10s. The review runs off the request path.
    res.writeHead(202).end("queued");
    enqueue(() => handleEvent(event, payload))
      .then((o) => console.log(`[${delivery}] ${event}: ${o.status}${o.detail ? " — " + o.detail : ""}`))
      .catch((e) => console.error(`[${delivery}] ${event}: ERROR`, e?.message ?? e));
  });
  server.listen(port, () => console.log(`pensive webhook server listening on :${port} (POST /webhook, POST /guard)`));
}
