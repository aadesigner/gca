export function normalizeWebsite(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let u = raw.trim().slice(0, 400);
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname || !parsed.hostname.includes(".")) return null;
    return parsed.toString().slice(0, 400);
  } catch {
    return null;
  }
}
