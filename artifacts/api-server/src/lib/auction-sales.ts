/**
 * Auction / marketplace sale rows: sold date, amount, and first registration.
 * Built from sold observations plus explicit `sale` events.
 */

export interface AuctionSaleRow {
  soldDate: string;
  amount?: number;
  currency?: string;
  priceUsd?: number;
  priceEur?: number;
  registered?: string;
  provider?: string;
  sourceListingId?: string;
  source?: string;
}

type EventLike = {
  eventType?: string | null;
  description?: string | null;
  occurredAt?: Date | string | null;
  metadata?: string | Record<string, unknown> | null;
};

type ObservationLike = {
  listingStatus?: string | null;
  priceAmount?: number | null;
  priceCurrency?: string | null;
  priceUsd?: number | null;
  priceEur?: number | null;
  observedAt?: Date | string | null;
  providerName?: string | null;
  providerId?: number | null;
  sourceListingId?: string | null;
};

export function buildAuctionSales(
  events: EventLike[],
  observations: ObservationLike[] = [],
): AuctionSaleRow[] {
  const registered = extractRegistered(events);
  const byKey = new Map<string, AuctionSaleRow>();

  for (const event of events) {
    if (event.eventType !== "sale") continue;
    const meta = parseMeta(event.metadata);
    const soldDate = str(meta.soldDate) || formatDate(event.occurredAt);
    if (!soldDate) continue;
    const sourceListingId = str(meta.sourceListingId);
    const provider = displayProvider(str(meta.provider) ?? str(meta.source));
    const amount =
      num(meta.priceAmount) ??
      num(meta.amount) ??
      // Import Motor sale events store Final price as metadata.value
      (str(meta.field) === "final_price" || str(meta.field) === "buy_now" ? num(meta.value) : undefined) ??
      amountFromSaleDescription(str(event.description));
    const key = saleDedupeKey(soldDate, amount, provider);
    const existing = byKey.get(key);
    const row: AuctionSaleRow = {
      soldDate,
      amount,
      currency:
        str(meta.priceCurrency) ??
        str(meta.currency) ??
        (provider === "iaa" ||
        provider === "copart" ||
        str(meta.source) === "iaa" ||
        str(meta.source) === "copart"
          ? "USD"
          : "KRW"),
      priceUsd:
        num(meta.priceUsd) ??
        (provider === "iaa" ||
        provider === "copart" ||
        str(meta.source) === "iaa" ||
        str(meta.source) === "copart"
          ? amount
          : undefined),
      priceEur: num(meta.priceEur),
      registered: str(meta.registered) ?? registered,
      provider,
      sourceListingId,
      source: str(meta.source) ?? "sale_event",
    };
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    byKey.set(key, mergeSaleRows(existing, row, "sale_event"));
  }

  for (const obs of observations) {
    const status = (obs.listingStatus ?? "").toLowerCase();
    if (status !== "sold") continue;
    const soldDate = formatDate(obs.observedAt);
    if (!soldDate) continue;
    const sourceListingId = str(obs.sourceListingId);
    const amount = num(obs.priceAmount);
    const covered = [...byKey.values()].find((row) =>
      saleRowCoversObservation(row, soldDate, sourceListingId, amount),
    );
    if (covered) {
      // Prefer the auction house name (Copart/IAA) over the Import Motor mirror label.
      covered.provider = preferAuctionProvider(str(obs.providerName), covered.provider);
      if (covered.amount == null) covered.amount = amount;
      if (covered.priceUsd == null && obs.priceUsd != null) covered.priceUsd = obs.priceUsd;
      if (covered.priceEur == null && obs.priceEur != null) covered.priceEur = obs.priceEur;
      if (!covered.currency && obs.priceCurrency) covered.currency = obs.priceCurrency;
      if (!covered.sourceListingId) covered.sourceListingId = sourceListingId;
      continue;
    }
    const key = saleDedupeKey(soldDate, amount, str(obs.providerName));
    const existing = byKey.get(key);
    const row: AuctionSaleRow = {
      soldDate,
      amount,
      currency: str(obs.priceCurrency) ?? "KRW",
      priceUsd: obs.priceUsd ?? undefined,
      priceEur: obs.priceEur ?? undefined,
      registered,
      provider: str(obs.providerName),
      sourceListingId,
      source: "observation",
    };
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    byKey.set(key, mergeSaleRows(existing, row, existing.source ?? "observation"));
  }

  return [...byKey.values()].sort((a, b) => b.soldDate.localeCompare(a.soldDate));
}

function extractRegistered(events: EventLike[]): string | undefined {
  const dates: string[] = [];
  for (const event of events) {
    const meta = parseMeta(event.metadata);
    const field = str(meta.field);
    if (
      field === "firstDate" ||
      field === "firstRegistration" ||
      field === "firstRegistrationDate"
    ) {
      const value = str(meta.value) || formatDate(event.occurredAt);
      if (value) dates.push(value.slice(0, 10));
      continue;
    }
    const fromDesc = str(event.description)?.match(/First registration:\s*(.+)$/i)?.[1];
    if (fromDesc) {
      dates.push(fromDesc.trim().slice(0, 10));
      continue;
    }
    if (event.eventType === "delivery") {
      const dated = formatDate(event.occurredAt);
      if (dated) dates.push(dated);
    }
  }
  dates.sort();
  return dates[0];
}

function parseMeta(raw: EventLike["metadata"]): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t || undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function formatDate(value: Date | string | unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

function displayProvider(raw?: string): string | undefined {
  if (!raw || raw === "bidscan") return undefined;
  if (/^import_motor$/i.test(raw)) return undefined;
  return raw;
}

function preferAuctionProvider(preferred?: string, fallback?: string): string | undefined {
  const a = preferred?.trim();
  const b = fallback?.trim();
  if (a && !/^import_motor$/i.test(a)) return a;
  if (b && !/^import_motor$/i.test(b)) return b;
  return a || b;
}

function amountFromSaleDescription(description?: string): number | undefined {
  if (!description) return undefined;
  const m = description.match(/(?:Final price|Buy now|Sold for)\s*:\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
  if (!m?.[1]) return undefined;
  return num(m[1].replace(/,/g, ""));
}

function saleDedupeKey(soldDate: string, amount?: number, provider?: string): string {
  return `sale:${soldDate}:${amount ?? "na"}:${(provider ?? "").toLowerCase()}`;
}

function saleRowCoversObservation(
  row: AuctionSaleRow,
  soldDate: string,
  sourceListingId?: string,
  amount?: number,
): boolean {
  if (sourceListingId && row.sourceListingId && sourceListingId === row.sourceListingId) return true;
  if (amount != null && row.amount != null && amount === row.amount) return true;
  // Same sale day: Import Motor sale event (often missing amount historically) + auction-house observation.
  if (row.soldDate === soldDate) {
    if (row.amount == null || amount == null || row.amount === amount) return true;
  }
  return false;
}

function mergeSaleRows(existing: AuctionSaleRow, row: AuctionSaleRow, source: string): AuctionSaleRow {
  const provider = preferAuctionProvider(existing.provider, row.provider);
  return {
    ...existing,
    amount: existing.amount ?? row.amount,
    currency: existing.currency ?? row.currency,
    priceUsd: existing.priceUsd ?? row.priceUsd,
    priceEur: existing.priceEur ?? row.priceEur,
    registered: existing.registered ?? row.registered,
    provider,
    sourceListingId: existing.sourceListingId ?? row.sourceListingId,
    source,
  };
}
