import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verifySignature } from "./verify.ts";
import { enqueue } from "./queue.ts";
import { handleEvent } from "./handler.ts";

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function startServer(port: number, secret: string): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/health") { res.writeHead(200).end("ok"); return; }
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
  server.listen(port, () => console.log(`pensive webhook server listening on :${port} (POST /webhook)`));
}
