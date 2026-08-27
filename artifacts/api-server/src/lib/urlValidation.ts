/**
 * SSRF-safe upstream URL validation.
 *
 * Call validateUpstreamUrl() before storing or fetching an upstream provider URL.
 * It blocks:
 *   - Non-HTTPS protocols
 *   - IPv4 private / reserved ranges (RFC 1918, 3927, 6598, etc.)
 *   - IPv6 private / reserved ranges (loopback, link-local, unique local, etc.)
 *   - IPv4-mapped IPv6 (::ffff:x.x.x.x) — ALL textual forms, checked numerically
 *   - IPv4-compatible IPv6 (::x.x.x.x) — ALL textual forms, including expanded
 *   - Known cloud-metadata hostnames and private TLDs
 *   - Hostnames that DNS-resolve to any private/reserved address
 *
 * isPrivateIp() is exported for use in safeHttps.ts (DNS-pinned fetch).
 *
 * IPv6 checking uses numeric expansion rather than regex so it covers every
 * valid textual representation (compressed, partially expanded, fully expanded,
 * mixed IPv4 notation) without gaps.
 */
import dns from "node:dns/promises";
import net from "node:net";

// ── IPv4 private / reserved CIDR ranges ────────────────────────────────────

const PRIVATE_IPv4_PATTERNS: RegExp[] = [
  /^0\./,                                       // 0.0.0.0/8   — this network
  /^10\./,                                      // 10.0.0.0/8  — RFC 1918
  /^127\./,                                     // 127.0.0.0/8 — loopback
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // 100.64.0.0/10 — shared (RFC 6598)
  /^169\.254\./,                                // 169.254.0.0/16 — link-local (RFC 3927)
  /^172\.(1[6-9]|2\d|3[01])\./,                // 172.16.0.0/12 — RFC 1918
  /^192\.0\.0\./,                               // 192.0.0.0/24 — IETF protocol
  /^192\.0\.2\./,                               // 192.0.2.0/24 — TEST-NET-1
  /^192\.168\./,                                // 192.168.0.0/16 — RFC 1918
  /^198\.(1[89])\./,                            // 198.18.0.0/15 — benchmarking
  /^198\.51\.100\./,                            // 198.51.100.0/24 — TEST-NET-2
  /^203\.0\.113\./,                             // 203.0.113.0/24 — TEST-NET-3
  /^22[4-9]\./,                                 // 224.0.0.0/4  — multicast
  /^23\d\./,
  /^24[0-9]\./,                                 // 240.0.0.0/4  — future use
  /^25[0-5]\./,
  /^255\.255\.255\.255$/,                       // broadcast
];

export function isPrivateIpv4(ip: string): boolean {
  return PRIVATE_IPv4_PATTERNS.some((p) => p.test(ip));
}

// ── IPv6 numeric parsing and range checking ─────────────────────────────────
//
// We expand the IPv6 address to 8 unsigned 16-bit groups and check ranges
// numerically. This handles every valid textual form:
//   compressed:          ::1, ::ffff:7f00:1, ::7f00:1
//   partially expanded:  0:0:0:0:0:0:7f00:1, 0:0:0:0:0:ffff:7f00:1
//   fully expanded:      0000:0000:0000:0000:0000:0000:7f00:0001
//   mixed (IPv4 dotted): ::127.0.0.1, ::ffff:127.0.0.1, 0:0:0:0:0:ffff:127.0.0.1

/**
 * Parse an IPv6 address string into 8 unsigned 16-bit groups.
 * Handles compressed (::), partially/fully expanded, and mixed IPv4 notation.
 * Returns null if the address cannot be parsed.
 */
function expandIPv6(raw: string): number[] | null {
  const addr = raw.trim().toLowerCase();

  // Guard: reject multiple "::" (invalid)
  const dcolCount = (addr.match(/::/g) ?? []).length;
  if (dcolCount > 1) return null;

  // Split on "::"
  const [leftStr, rightStr] = dcolCount === 1
    ? addr.split("::")
    : [addr, undefined] as [string, undefined];

  // Helper: split a colon-separated group string, handling optional trailing
  // embedded IPv4 in mixed notation (e.g. "ffff:127.0.0.1" → [0xffff, 127<<8|0, 0<<8|1])
  function parseGroupStr(s: string): number[] | null {
    if (!s) return [];
    const colonParts = s.split(":");
    const result: number[] = [];
    for (let i = 0; i < colonParts.length; i++) {
      const part = colonParts[i]!;
      if (part.includes(".")) {
        // Embedded IPv4 in mixed notation (only valid as the last element)
        if (i !== colonParts.length - 1) return null;
        const octets = part.split(".");
        if (octets.length !== 4) return null;
        const nums = octets.map((o) => parseInt(o, 10));
        if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
        result.push((nums[0]! << 8) | nums[1]!);
        result.push((nums[2]! << 8) | nums[3]!);
      } else {
        const n = parseInt(part || "0", 16);
        if (isNaN(n) || n < 0 || n > 0xffff) return null;
        result.push(n);
      }
    }
    return result;
  }

  const leftGroups = parseGroupStr(leftStr ?? "");
  if (!leftGroups) return null;

  if (dcolCount === 0) {
    // No "::" — must be exactly 8 groups
    if (leftGroups.length !== 8) return null;
    return leftGroups;
  }

  // Has "::" — right side may be absent (all zeros) or present
  const rightGroups = parseGroupStr(rightStr ?? "");
  if (!rightGroups) return null;

  const fillCount = 8 - leftGroups.length - rightGroups.length;
  if (fillCount < 0) return null; // too many groups

  return [...leftGroups, ...new Array<number>(fillCount).fill(0), ...rightGroups];
}

/**
 * Return true if the IPv6 address (given as 8 numeric 16-bit groups) is in
 * any private or reserved range, including embedded IPv4 ranges.
 */
function isPrivateIPv6Groups(g: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number, number, number, number, number, number, number, number
  ];

  // ── Loopback / unspecified ─────────────────────────────────────────────
  // ::1 (0000:…:0001) and :: (all zeros)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    if (g6 === 0) return true; // :: (unspecified) and all 0:0:0:0:0:0:0:x where high group is 0
    // IPv4-compatible: 0:0:0:0:0:0:HHHH:HHHH — the last 32 bits embed an IPv4 address.
    // This includes ::1 (already caught above), ::7f00:1 (127.0.0.1), ::c0a8:101 (192.168.1.1), etc.
    const v4 = `${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`;
    return isPrivateIpv4(v4);
  }

  // ── IPv4-mapped: 0:0:0:0:0:ffff:HHHH:HHHH ────────────────────────────
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    const v4 = `${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`;
    return isPrivateIpv4(v4);
  }

  // ── Link-local: fe80::/10 ─────────────────────────────────────────────
  if ((g0 & 0xffc0) === 0xfe80) return true;

  // ── Unique local: fc00::/7 ────────────────────────────────────────────
  if ((g0 & 0xfe00) === 0xfc00) return true;

  // ── Multicast: ff00::/8 ───────────────────────────────────────────────
  if ((g0 & 0xff00) === 0xff00) return true;

  // ── Documentation: 2001:db8::/32 ─────────────────────────────────────
  if (g0 === 0x2001 && g1 === 0x0db8) return true;

  // ── Teredo: 2001::/32 ─────────────────────────────────────────────────
  // (may embed private IPv4 in client address; block the whole range)
  if (g0 === 0x2001 && g1 === 0x0000) return true;

  // ── NAT64: 64:ff9b::/96 ───────────────────────────────────────────────
  // May relay to private IPv4; block as it can route to internal services.
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return true;

  // ── Discard: 100::/64 ─────────────────────────────────────────────────
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true;

  return false;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Return true if the IP address (v4 or v6, in any valid textual form) is in
 * any private or reserved range.
 *
 * For IPv6, the address is expanded numerically so every compressed, partially
 * expanded, and mixed-notation form is handled correctly, including:
 *   - IPv4-mapped:      ::ffff:127.0.0.1  |  ::ffff:7f00:1  |  0:0:0:0:0:ffff:7f00:1
 *   - IPv4-compatible:  ::127.0.0.1        |  ::7f00:1        |  0:0:0:0:0:0:7f00:1
 *
 * Unknown / unparseable addresses are treated as private (fail-closed).
 */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);

  if (net.isIPv6(ip)) {
    const groups = expandIPv6(ip);
    if (!groups) return true; // Parse failure → fail closed
    return isPrivateIPv6Groups(groups);
  }

  // Unknown format — fail closed
  return true;
}

// ── Hostname / URL block-lists ──────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "169.254.169.254",         // AWS / GCP / Azure IMDS
  "100.100.100.200",         // Alibaba Cloud metadata
  "metadata.google.internal",
  "metadata.google",
  "metadata",
]);

const BLOCKED_TLD_SUFFIXES = [
  ".local",
  ".internal",
  ".localhost",
  ".corp",
  ".home",
  ".lan",
  ".intranet",
  ".invalid",
  ".test",
  ".example",
];

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate that a URL is safe to use as an upstream live provider endpoint.
 *
 * Checks:
 * 1. Parseable as a URL
 * 2. Protocol is exactly "https:"
 * 3. Hostname not in the blocked-hostname set
 * 4. Hostname TLD not in the blocked-TLD list
 * 5. Literal IP hostnames must be public
 * 6. DNS-resolved hostnames: ALL resolved addresses (v4 and v6) must be public
 */
export async function validateUpstreamUrl(rawUrl: string): Promise<UrlValidationResult> {
  // 1. Parse
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  // 2. HTTPS only
  if (url.protocol !== "https:") {
    return { valid: false, error: "Upstream URL must use HTTPS" };
  }

  const hostname = url.hostname.toLowerCase();

  // 3. Blocked exact hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: `Upstream hostname '${hostname}' is not allowed` };
  }

  // 4. Blocked TLD suffixes
  for (const tld of BLOCKED_TLD_SUFFIXES) {
    if (hostname === tld.slice(1) || hostname.endsWith(tld)) {
      return { valid: false, error: `Upstream hostname uses a blocked TLD ('${tld}')` };
    }
  }

  // 5. Literal IP check
  if (net.isIP(hostname) !== 0) {
    if (isPrivateIp(hostname)) {
      return { valid: false, error: "Upstream URL cannot target a private or reserved IP address" };
    }
    return { valid: true };
  }

  // 6. DNS resolution check — resolve all address families
  const [v4Result, v6Result] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ]);

  const v4Addrs = v4Result.status === "fulfilled" ? v4Result.value : [];
  const v6Addrs = v6Result.status === "fulfilled" ? v6Result.value : [];
  const allAddrs = [...v4Addrs, ...v6Addrs];

  if (allAddrs.length === 0) {
    const errMsg =
      v4Result.status === "rejected"
        ? (v4Result.reason as Error).message
        : (v6Result as PromiseRejectedResult).reason?.message ?? "DNS resolution failed";
    return { valid: false, error: `Could not resolve upstream hostname: ${errMsg}` };
  }

  for (const addr of allAddrs) {
    if (isPrivateIp(addr)) {
      return {
        valid: false,
        error: `Upstream hostname resolves to a private/reserved IP (${addr})`,
      };
    }
  }

  return { valid: true };
}
