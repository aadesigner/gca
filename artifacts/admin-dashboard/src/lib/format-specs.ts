/** Format engine displacement for display (cc from Encar, or liter strings like "2.0L"). */

function parseEngineCc(raw?: string | number | null): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    // Bare numbers: >= 100 treat as cc, otherwise liters → cc.
    return raw >= 100 ? Math.round(raw) : Math.round(raw * 1000);
  }

  const s = String(raw).trim();
  if (!s || /^[?\-–—]$/.test(s) || /^n\/?a$/i.test(s) || /^unknown$/i.test(s)) return null;

  // Explicit cc / cm³ first (e.g. "1998cc", "2.0L(1987cm3)").
  const cm3 = s.match(/(\d{3,5})\s*(?:cm\s*³|cm3|cc)\b/i);
  if (cm3) {
    const n = Number(cm3[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Already liters: "2.0L", "2.0 L", "3L".
  const liters = s.match(/^(\d+(?:\.\d+)?)\s*L\b/i);
  if (liters) {
    const n = Number(liters[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 1000);
  }

  // Pure numeric string.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n >= 100 ? Math.round(n) : Math.round(n * 1000);
  }

  return null;
}

function litersLabel(cc: number): string {
  const liters = Math.round((cc / 1000) * 10) / 10;
  return `${liters.toFixed(1)}L`;
}

/** Encar stores cc (e.g. 1998); other sources may send "2.0L". */
export function formatEngineDisplacement(raw?: string | number | null): string | null {
  if (raw == null || raw === "") return null;
  const cc = parseEngineCc(raw);
  if (cc == null || cc <= 0) {
    const s = String(raw).trim();
    if (!s || /^[?\-–—]$/.test(s) || /^n\/?a$/i.test(s) || /^0+(\.0+)?\s*L$/i.test(s)) return null;
    return s;
  }
  return `${litersLabel(cc)} (${cc.toLocaleString()} cc)`;
}

export function formatEngineBadge(raw?: string | number | null): string | null {
  if (raw == null || raw === "") return null;
  const cc = parseEngineCc(raw);
  if (cc == null || cc <= 0) {
    const s = String(raw).trim();
    if (!s || /^[?\-–—]$/.test(s) || /^n\/?a$/i.test(s) || /^0+(\.0+)?\s*L$/i.test(s)) return null;
    return s;
  }
  return litersLabel(cc);
}

export function formatDualMileage(km?: number | null, miles?: number | null) {
  if (km == null) return null;
  const mi = miles ?? Math.round(km * 0.621371);
  return `${km.toLocaleString()} km (${mi.toLocaleString()} mi)`;
}

/** Vehicle history dates: day month year when known; year-only when that is all we have. */
export function formatEventDate(
  raw?: string | Date | null,
  event?: { metadata?: unknown; description?: string | null } | null,
): string {
  const meta = parseEventMeta(event?.metadata);
  const precision = String(meta.datePrecision ?? "").toLowerCase();
  const value =
    (typeof meta.value === "string" && meta.value.trim()) ||
    event?.description?.match(/First registration:\s*(.+)$/i)?.[1]?.trim() ||
    "";

  if (precision === "year" || /^\d{4}$/.test(value)) {
    return value.slice(0, 4);
  }
  if (precision === "month" || /^\d{4}-\d{2}$/.test(value)) {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(5, 7));
    if (y && m >= 1 && m <= 12) {
      return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
      });
    }
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const dated = calendarDate(value);
    if (dated) {
      return dated.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }
  }

  // Year-only production fallback often stored as Jan 1 — don't invent a day/month.
  if (
    (meta.source === "productionYear" || /first registration:\s*\d{4}\s*$/i.test(event?.description ?? "")) &&
    raw
  ) {
    const date = calendarDate(raw);
    if (date && date.getMonth() === 0 && date.getDate() === 1) {
      return String(date.getFullYear());
    }
  }

  if (raw == null || raw === "") return "—";
  const date = calendarDate(raw);
  if (!date) return String(raw);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function parseEventMeta(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function calendarDate(raw: string | Date): Date | null {
  if (typeof raw === "string") {
    const match = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
  }
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
