import { createHmac, timingSafeEqual } from "node:crypto";

// Verify GitHub's X-Hub-Signature-256 over the RAW body. Constant-time compare.
export function verifySignature(secret: string, raw: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
