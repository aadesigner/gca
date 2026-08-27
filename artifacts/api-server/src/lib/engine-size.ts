/** Normalize listing engine size to cc. Values under 20 are treated as liters. */
export function displacementCc(raw?: string | number | null): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n < 20) return Math.round(n * 1000);
  return Math.round(n);
}

export function matchesEngineRange(
  raw: string | number | null | undefined,
  minCc?: number,
  maxCc?: number,
): boolean {
  if (minCc == null && maxCc == null) return true;
  const cc = displacementCc(raw);
  if (cc == null) return false;
  if (minCc != null && cc < minCc) return false;
  if (maxCc != null && cc > maxCc) return false;
  return true;
}
