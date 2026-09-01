export function normalizeTelegram(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let t = raw.trim().replace(/^@+/, "").slice(0, 64);
  if (!t) return null;
  if (!/^[A-Za-z0-9_]{3,64}$/.test(t)) return null;
  return t;
}
