/**
 * CSRF / origin protection for admin mutations.
 *
 * Strict Origin check on POST/PUT/PATCH/DELETE. Server-to-server calls (no
 * Origin) are allowed. localhost and 127.0.0.1 are treated as the same host
 * because Windows Vite often opens the dashboard on 127.0.0.1 while
 * ADMIN_ORIGIN is http://localhost:3000.
 *
 * The Vite proxy uses changeOrigin, so the API sees Host=localhost:5000 while
 * the browser Origin is the real dashboard URL (LAN IP, Tailscale 100.x / *.ts.net).
 * When the incoming Host is loopback, we compare against X-Forwarded-Host instead.
 */
import type { Request, Response, NextFunction } from "express";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const IS_PROD = process.env.NODE_ENV === "production";

const ALLOWED_ORIGINS: string[] = (process.env.ADMIN_ORIGIN ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

type ParsedOrigin = { protocol: string; host: string; port: string };

function firstHeader(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw.split(",")[0]?.trim();
  return first || null;
}

function parseOrigin(raw: string): ParsedOrigin | null {
  try {
    const url = new URL(raw);
    const protocol = url.protocol.toLowerCase();
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const port = url.port || (protocol === "https:" ? "443" : "80");
    return { protocol, host, port };
  } catch {
    return null;
  }
}

function canonicalHost(host: string): string {
  if (host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return "localhost";
  return host;
}

function hostFromHostHeader(hostHeader: string): string {
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end >= 0 ? trimmed.slice(1, end) : trimmed;
  }
  return trimmed.split(":")[0] ?? trimmed;
}

function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  return canonicalHost(hostFromHostHeader(hostHeader)) === "localhost";
}

function originsEquivalent(left: string, right: string): boolean {
  const a = parseOrigin(left);
  const b = parseOrigin(right);
  if (!a || !b) return left === right;
  return a.protocol === b.protocol && canonicalHost(a.host) === canonicalHost(b.host) && a.port === b.port;
}

/** RFC1918, loopback, and Tailscale mesh (CGNAT 100.64/10 + MagicDNS). */
function isPrivateLanHost(host: string): boolean {
  const canonical = canonicalHost(host);
  if (canonical === "localhost") return true;
  if (host.endsWith(".ts.net") || host.endsWith(".tailscale.net")) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // Tailscale IPv4: 100.64.0.0/10
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const ipv6 = host.toLowerCase();
  if (ipv6 === "fd7a:115c:a1e0" || ipv6.startsWith("fd7a:115c:a1e0:")) return true;
  return false;
}

function expectedOriginFromRequest(req: Request): string | null {
  const forwardedHost = firstHeader(req.headers["x-forwarded-host"]);
  const hostHeader = req.headers.host;
  const host =
    forwardedHost && isLoopbackHostHeader(hostHeader) ? forwardedHost : hostHeader;
  if (!host) return null;
  const proto =
    firstHeader(req.headers["x-forwarded-proto"]) || req.protocol || "http";
  return `${proto}://${host}`;
}

export function isAllowedAdminOrigin(origin: string, requestHostOrigin?: string | null): boolean {
  if (requestHostOrigin && originsEquivalent(origin, requestHostOrigin)) return true;
  if (ALLOWED_ORIGINS.some((allowed) => originsEquivalent(origin, allowed))) return true;
  if (!IS_PROD) {
    const parsed = parseOrigin(origin);
    if (parsed && (parsed.protocol === "http:" || parsed.protocol === "https:") && isPrivateLanHost(parsed.host)) {
      return true;
    }
  }
  return false;
}

export function csrfOriginCheck(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATION_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }

  if (isAllowedAdminOrigin(origin, expectedOriginFromRequest(req))) {
    next();
    return;
  }

  res.status(403).json({ error: "Forbidden: invalid request origin" });
}
