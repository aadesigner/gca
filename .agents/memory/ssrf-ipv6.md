---
name: SSRF IPv6 coverage
description: Regex-based IPv6 private-IP detection must explicitly handle IPv4-mapped and IPv4-compatible addresses in both dotted-decimal and hex group forms.
---

# SSRF IPv6 Address Coverage

## Rule
When checking whether an IPv6 address is private for SSRF protection, regex-only approaches miss IPv4-compatible addresses in hex form (e.g. `::7f00:1` = 127.0.0.1, `::c0a8:0101` = 192.168.1.1).

**Why:** A DNS AAAA record can contain any 128-bit value, including IPv4-mapped (`::ffff:x.x.x.x`) and IPv4-compatible (`::x.x.x.x` or `::HHHH:HHHH`) addresses that encode private IPv4. Dotted-decimal check alone (`::127.0.0.1`) misses the hex encoding.

**How to apply:**
- Check `::ffff:HHHH:HHHH` (IPv4-mapped hex) — extract hi/lo groups, convert to dotted IPv4, then check private ranges.
- Check `::HHHH:HHHH` without ffff prefix (IPv4-compatible hex) — same extraction with negative lookahead to avoid re-matching ffff form.
- Check `::a.b.c.d` (dotted decimal, both mapped and compatible).
- Always run `isPrivateIp()` on ALL resolved addresses (both v4 and v6) before pinning and connecting.
