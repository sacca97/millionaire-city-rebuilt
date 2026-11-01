import crypto from "node:crypto";
import https from "node:https";
import type { TLSSocket } from "node:tls";

export function sha256(body: Buffer | string): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

export interface RawResponse {
  status: number;
  headers: Headers;
  body: Buffer;
  text: string;
}

/** GET/POST helper that returns the exact body bytes (no decompression of content-encoding is hidden: undici decodes it). */
export async function request(url: string, init: RequestInit = {}): Promise<RawResponse> {
  const res = await fetch(url, { redirect: "manual", ...init });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body, text: body.toString("utf8") };
}

/** HTTPS GET that ignores certificate validation (self-signed) and gives back the peer certificate too. */
export function httpsGet(url: string, headers: Record<string, string> = {}): Promise<RawResponse & { cert: crypto.X509Certificate }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false, headers }, (res) => {
      const chunks: Buffer[] = [];
      const peer = (res.socket as TLSSocket).getPeerCertificate();
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : String(v));
        resolve({
          status: res.statusCode ?? 0,
          headers: h,
          body,
          text: body.toString("utf8"),
          cert: new crypto.X509Certificate(peer.raw)
        });
      });
    });
    req.once("error", reject);
  });
}

export function xmlAttr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
}

export function definitionTags(xml: string): string[] {
  return xml.match(/<Definition\b[^>]*\/>/g) ?? [];
}

export function findDefinitionTag(xml: string, sku: string): string | undefined {
  const escapedSku = sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return xml.match(new RegExp(`<Definition\\b(?=[^>]*\\bsku="${escapedSku}")[^>]*/>`))?.[0];
}

export function extractDefinitionTag(xml: string, sku: string): string {
  const match = findDefinitionTag(xml, sku);
  if (!match) throw new Error(`Could not find definition for ${sku}`);
  return match;
}
