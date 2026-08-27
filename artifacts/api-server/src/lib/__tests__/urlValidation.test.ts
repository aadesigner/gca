/**
 * Unit tests for isPrivateIp() — covers all IPv4-mapped and IPv4-compatible
 * IPv6 forms including the bypass cases identified in security review.
 *
 * Run with: pnpm tsx src/lib/__tests__/urlValidation.test.ts
 */
import { isPrivateIp, isPrivateIpv4 } from "../urlValidation";

let passed = 0;
let failed = 0;

function assert(value: boolean, message: string): void {
  if (value) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// ── IPv4 private ranges ──────────────────────────────────────────────────────
console.log("\n=== IPv4 private ranges ===");
assert(isPrivateIpv4("127.0.0.1"), "127.0.0.1 is loopback");
assert(isPrivateIpv4("10.0.0.1"), "10.0.0.1 is RFC 1918");
assert(isPrivateIpv4("192.168.1.1"), "192.168.1.1 is RFC 1918");
assert(isPrivateIpv4("172.16.0.1"), "172.16.0.1 is RFC 1918");
assert(isPrivateIpv4("172.31.255.255"), "172.31.255.255 is RFC 1918");
assert(isPrivateIpv4("169.254.1.1"), "169.254.x.x is link-local");
assert(isPrivateIpv4("0.0.0.1"), "0.x is this-network");
assert(!isPrivateIpv4("8.8.8.8"), "8.8.8.8 is public");
assert(!isPrivateIpv4("1.1.1.1"), "1.1.1.1 is public");

// ── IPv4-mapped IPv6 (::ffff:...) — all textual forms ──────────────────────
console.log("\n=== IPv4-mapped IPv6 (::ffff:x.x.x.x) ===");

// Compressed dotted: ::ffff:127.0.0.1
assert(isPrivateIp("::ffff:127.0.0.1"), "::ffff:127.0.0.1 (loopback, compressed dotted)");
assert(isPrivateIp("::ffff:192.168.1.1"), "::ffff:192.168.1.1 (RFC 1918, compressed dotted)");
assert(isPrivateIp("::ffff:10.0.0.1"), "::ffff:10.0.0.1 (RFC 1918, compressed dotted)");

// Compressed hex: ::ffff:7f00:1
assert(isPrivateIp("::ffff:7f00:1"), "::ffff:7f00:1 (loopback, compressed hex) [BYPASS CASE]");
assert(isPrivateIp("::ffff:c0a8:101"), "::ffff:c0a8:101 (192.168.1.1, compressed hex) [BYPASS CASE]");

// Partially expanded: 0:0:0:0:0:ffff:7f00:1
assert(isPrivateIp("0:0:0:0:0:ffff:7f00:1"), "0:0:0:0:0:ffff:7f00:1 (loopback, partially expanded hex)");
assert(isPrivateIp("0:0:0:0:0:ffff:c0a8:101"), "0:0:0:0:0:ffff:c0a8:101 (192.168.1.1, partially expanded hex)");

// Partially expanded with dotted IPv4
assert(isPrivateIp("0:0:0:0:0:ffff:127.0.0.1"), "0:0:0:0:0:ffff:127.0.0.1 (loopback, partially expanded dotted)");

// Fully expanded: 0000:0000:0000:0000:0000:ffff:7f00:0001
assert(isPrivateIp("0000:0000:0000:0000:0000:ffff:7f00:0001"), "0000:0000:0000:0000:0000:ffff:7f00:0001 (loopback, fully expanded)");

// Public IPv4-mapped should pass
assert(!isPrivateIp("::ffff:8.8.8.8"), "::ffff:8.8.8.8 (public IPv4, mapped) → public");
assert(!isPrivateIp("::ffff:8080:8080"), "::ffff:8080:8080 (128.128.128.128, public) → public");

// ── IPv4-compatible IPv6 (::x.x.x.x / ::HHHH:HHHH) — all textual forms ───
console.log("\n=== IPv4-compatible IPv6 (::x.x.x.x) ===");

// Compressed dotted: ::127.0.0.1
assert(isPrivateIp("::127.0.0.1"), "::127.0.0.1 (loopback, compressed dotted IPv4-compat)");
assert(isPrivateIp("::192.168.1.1"), "::192.168.1.1 (RFC 1918, compressed dotted IPv4-compat)");

// Compressed hex: ::7f00:1, ::c0a8:101 (the reviewer's exact bypass examples)
assert(isPrivateIp("::7f00:1"), "::7f00:1 (127.0.0.1, compressed hex IPv4-compat) [BYPASS CASE]");
assert(isPrivateIp("::c0a8:0101"), "::c0a8:0101 (192.168.1.1, compressed hex IPv4-compat) [BYPASS CASE]");

// Partially expanded: 0:0:0:0:0:0:7f00:1
assert(isPrivateIp("0:0:0:0:0:0:7f00:1"), "0:0:0:0:0:0:7f00:1 (loopback, partially expanded hex) [BYPASS CASE]");
assert(isPrivateIp("0:0:0:0:0:0:c0a8:101"), "0:0:0:0:0:0:c0a8:101 (192.168.1.1, partially expanded hex) [BYPASS CASE]");

// Partially expanded dotted: 0:0:0:0:0:0:127.0.0.1
assert(isPrivateIp("0:0:0:0:0:0:127.0.0.1"), "0:0:0:0:0:0:127.0.0.1 (loopback, partially expanded dotted IPv4-compat)");

// Fully expanded: 0000:0000:0000:0000:0000:0000:7f00:0001
assert(isPrivateIp("0000:0000:0000:0000:0000:0000:7f00:0001"), "0000:0000:0000:0000:0000:0000:7f00:0001 (loopback, fully expanded)");

// ── Standard IPv6 private ranges ─────────────────────────────────────────
console.log("\n=== Standard IPv6 private ranges ===");
assert(isPrivateIp("::1"), "::1 (loopback)");
assert(isPrivateIp("::"), ":: (unspecified)");
assert(isPrivateIp("fe80::1"), "fe80::1 (link-local)");
assert(isPrivateIp("fd00::1"), "fd00::1 (unique local)");
assert(isPrivateIp("fc00::1"), "fc00::1 (unique local)");
assert(isPrivateIp("ff02::1"), "ff02::1 (multicast)");

// ── Public IPv6 ───────────────────────────────────────────────────────────
console.log("\n=== Public IPv6 ===");
assert(!isPrivateIp("2001:4860:4860::8888"), "2001:4860:4860::8888 (Google DNS, public)");
assert(!isPrivateIp("2606:4700:4700::1111"), "2606:4700:4700::1111 (Cloudflare DNS, public)");

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
