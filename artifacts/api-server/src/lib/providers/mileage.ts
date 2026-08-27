/**
 * Shared mileage helpers for crawl salvage + VIN history gating.
 * History DB requires a usable odometer reading (mileage > 0).
 */

const MILEAGE_KEY_RE =
  /^(odometer|odo|mileage|mileages|km|kilometers|kilometres|miles|driveDistance|drive_distance|odometerValue|odometer_value|mileageFromOdometer|주행거리)$/i;

const MAX_WALK_DEPTH = 4;
const MAX_WALK_NODES = 80;

export function isUsableMileage(value: unknown): value is number {
  // Reject 0/1 — common "unknown" sentinels on KR auction/catalog feeds.
  return typeof value === "number" && Number.isFinite(value) && value > 1 && value <= 2_000_000;
}

export function coerceMileage(value: unknown): number | undefined {
  if (isUsableMileage(value)) return value;
  if (typeof value === "string") {
    const fromText = extractMileageFromText(value);
    if (fromText != null) return fromText;
    const n = Number(value.replace(/[^\d.]/g, ""));
    if (isUsableMileage(n)) return Math.round(n);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (
      coerceMileage(obj.value) ??
      coerceMileage(obj.amount) ??
      coerceMileage(obj.km) ??
      coerceMileage(obj.miles) ??
      coerceMileage(obj.odometer) ??
      coerceMileage(obj.mileage)
    );
  }
  return undefined;
}

/** Pull KM/mi figures from free text / titles (e.g. `…60000KM`, `84,431 mi`). */
export function extractMileageFromText(text?: string | null): number | undefined {
  if (!text) return undefined;
  const patterns = [
    /(\d{1,3}(?:,\d{3}){1,2}|\d{2,7})\s*(?:k\.?m\.?|kilometers?|kilometres?)\b/i,
    /(\d{1,3}(?:,\d{3}){1,2}|\d{2,7})\s*(?:mi\.?|miles?)\b/i,
    /\b(?:odometer|mileage|주행거리)\s*[:.]?\s*(\d{1,3}(?:,\d{3}){1,2}|\d{2,7})\b/i,
    /\b(\d{4,7})km\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const n = Number(m[1].replace(/,/g, ""));
    if (isUsableMileage(n)) return n;
  }
  return undefined;
}

export function extractMileageFromRecord(record?: Record<string, unknown> | null): number | undefined {
  if (!record) return undefined;
  const directKeys = [
    "odometer",
    "odo",
    "mileage",
    "odometerValue",
    "odometer_value",
    "driveDistance",
    "drive_distance",
    "km",
    "miles",
    "Mileage",
    "Odometer",
  ];
  for (const key of directKeys) {
    const n = coerceMileage(record[key]);
    if (n != null) return n;
  }
  return walkMileage(record, 0, { nodes: 0 });
}

function walkMileage(
  node: unknown,
  depth: number,
  state: { nodes: number },
): number | undefined {
  if (node == null || depth > MAX_WALK_DEPTH || state.nodes > MAX_WALK_NODES) return undefined;
  state.nodes++;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 20)) {
      const n = walkMileage(item, depth + 1, state);
      if (n != null) return n;
    }
    return undefined;
  }
  if (typeof node !== "object") return undefined;
  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (MILEAGE_KEY_RE.test(key)) {
      const n = coerceMileage(value);
      if (n != null) return n;
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const n = walkMileage(value, depth + 1, state);
      if (n != null) return n;
    }
  }
  return undefined;
}

/**
 * Prefer parser mileage; otherwise recover from metadata / JSON / title / HTML.
 * Call before VIN history persistence so we don't drop recoverable odometer values.
 */
export function salvageListingMileage(input: {
  mileage?: number | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
  json?: unknown;
  html?: string | null;
}): number | undefined {
  const fromListing = coerceMileage(input.mileage);
  if (fromListing != null) return fromListing;

  const fromMeta = extractMileageFromRecord(input.metadata ?? undefined);
  if (fromMeta != null) return fromMeta;

  if (input.json && typeof input.json === "object") {
    const fromJson = extractMileageFromRecord(input.json as Record<string, unknown>);
    if (fromJson != null) return fromJson;
  }

  const fromTitle = extractMileageFromText(input.title);
  if (fromTitle != null) return fromTitle;

  if (input.html) {
    const head = input.html.slice(0, 120_000);
    // Prefer an explicit Mileage widget; never fall through to related-car km.
    const labeled = head.match(
      /<h6[^>]*>\s*([^<]*?)\s*<\/h6>\s*<span[^>]*>\s*Mileage\s*<\/span>/i,
    );
    if (labeled?.[1]) {
      const raw = labeled[1].trim();
      if (/^\?\s*km/i.test(raw) || raw === "?" || /^n\/?a$/i.test(raw)) return undefined;
      const n = coerceMileage(raw);
      if (n != null) return n;
      return undefined;
    }
    const fromHtml = extractMileageFromText(head);
    if (fromHtml != null) return fromHtml;
  }

  return undefined;
}
