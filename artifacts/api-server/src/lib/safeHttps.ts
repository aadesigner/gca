/**
 * DNS-rebinding-safe HTTPS fetch utility.
 *
 * Defends against SSRF via DNS rebinding by:
 *  1. Resolving the hostname to concrete IP addresses using our own DNS lookup.
 *  2. Validating that every resolved address is a public (non-private) IP.
 *  3. Connecting to the *validated IP directly* via https.request() — no
 *     further DNS lookup occurs, so the resolver cannot return a different
 *     address for the actual connection.
 *  4. Setting `servername` (TLS SNI) to the *original hostname* so the server
 *     sends the correct certificate, and overriding `checkServerIdentity` to
 *     verify the cert against the original hostname (not the IP).
 *  5. Rejecting all HTTP redirects so a 301/302 cannot point the connection to
 *     an internal address.
 *
 * Usage replaces `fetch()` for all upstream live-provider calls.
 */
import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { isPrivateIp } from "./urlValidation";

export interface SafeHttpsOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Request timeout in ms (default: 10 000) */
  timeoutMs?: number;
}

export interface SafeHttpsResponse {
  status: number;
  ok: boolean;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

/**
 * Resolve the hostname in `rawUrl`, validate all addresses are public, and
 * connect to the resolved IP directly — bypassing all subsequent DNS lookups.
 *
 * Throws if:
 * - The URL is not HTTPS
 * - DNS resolution fails or returns no results
 * - Any resolved IP is private / reserved
 * - A redirect is returned (SSRF via redirect chain)
 * - The connection times out
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeHttpsOptions = {}
): Promise<SafeHttpsResponse> {
  const url = new URL(rawUrl);

  if (url.protocol !== "https:") {
    throw new Error("safeFetch: only HTTPS URLs are permitted");
  }

  const hostname = url.hostname;
  const port = parseInt(url.port || "443", 10);

  // ── 1. Resolve and validate DNS ────────────────────────────────────────────
  const [v4Result, v6Result] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ]);

  const v4Addrs = v4Result.status === "fulfilled" ? v4Result.value : [];
  const v6Addrs = v6Result.status === "fulfilled" ? v6Result.value : [];
  const allAddrs = [...v4Addrs, ...v6Addrs];

  if (allAddrs.length === 0) {
    const msg =
      v4Result.status === "rejected"
        ? String((v4Result as PromiseRejectedResult).reason)
        : String((v6Result as PromiseRejectedResult).reason);
    throw new Error(`safeFetch: could not resolve hostname '${hostname}': ${msg}`);
  }

  for (const addr of allAddrs) {
    if (isPrivateIp(addr)) {
      throw new Error(
        `safeFetch: SSRF protection — '${hostname}' resolves to private/reserved IP ${addr}`
      );
    }
  }

  // ── 2. Pick a target IP (prefer IPv4 for simplicity) ──────────────────────
  const targetIp: string = v4Addrs.find((a) => !isPrivateIp(a)) ??
    v6Addrs.find((a) => !isPrivateIp(a))!;

  // ── 3. Connect directly to the validated IP, never re-resolving DNS ────────
  return new Promise<SafeHttpsResponse>((resolve, reject) => {
    let settled = false;
    function finish(fn: () => void) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    }

    const timer = setTimeout(() => {
      finish(() => reject(new Error("safeFetch: request timeout")));
      req.destroy();
    }, options.timeoutMs ?? 10_000);

    const reqOptions: https.RequestOptions = {
      method: options.method ?? "GET",

      // Connect to the validated IP — no further DNS resolution occurs.
      // For IPv6, Node.js expects the bare address (no brackets) in hostname.
      hostname: targetIp,
      port,
      path: url.pathname + url.search,

      // TLS SNI: tell the server which certificate to present.
      // Without this, TLS handshake may fail on SNI-gated servers.
      servername: hostname,

      // Override certificate host-check: verify against the *original hostname*,
      // not the numeric IP (which would always fail / be meaningless).
      checkServerIdentity: (_host: string, cert: tls.PeerCertificate) =>
        tls.checkServerIdentity(hostname, cert),

      headers: {
        Host: hostname,
        ...(options.headers ?? {}),
      },
    };

    const req = https.request(reqOptions, (res) => {
      // ── 4. Reject all redirects ──────────────────────────────────────────
      if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400) {
        res.destroy();
        finish(() =>
          reject(
            new Error(
              `safeFetch: redirect not followed (${res.statusCode} → ${res.headers.location}). ` +
                "Redirects are blocked to prevent SSRF via redirect chains."
            )
          )
        );
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const bodyStr = body.toString("utf8");
        finish(() =>
          resolve({
            status: res.statusCode ?? 0,
            ok: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300,
            text: async () => bodyStr,
            json: async () => JSON.parse(bodyStr) as unknown,
          })
        );
      });
      res.on("error", (err) => finish(() => reject(err)));
    });

    req.on("error", (err) => finish(() => reject(err)));
    req.end();
  });
}
