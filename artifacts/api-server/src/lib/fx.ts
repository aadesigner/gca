/**
 * FX conversion: any listing currency → USD + EUR.
 * Rates are snapshotted in `fx_rates` (~1h TTL) and applied once on fetch/persist.
 */
import { db, fxRatesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "./logger";

const STALE_MS = 60 * 60 * 1000;
/** Currencies we always snapshot alongside USD/EUR (covers active providers). */
const TRACKED_QUOTES = ["EUR", "KRW", "PLN", "AED", "CAD", "GBP", "AUD", "JPY", "CHF", "CZK", "SEK", "NOK"] as const;

export interface FxSnapshot {
  base: "KRW";
  usdPerKrw: number;
  eurPerKrw: number;
  krwPerUsd: number;
  krwPerEur: number;
  fetchedAt: string;
  source: string;
}

/** Units of each currency per 1 USD (e.g. PLN≈4, EUR≈0.92, KRW≈1400). */
export interface UsdFxTable {
  perUsd: Record<string, number>;
  fetchedAt: string;
  source: string;
}

export interface ConvertedPrice {
  amount: number;
  currency: string;
  usd: number | null;
  eur: number | null;
  fx: FxSnapshot | null;
}

let memoryUsd: { table: UsdFxTable; at: number } | null = null;
let memoryKrw: { snapshot: FxSnapshot; at: number } | null = null;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundMajor(n: number): number {
  return Math.round(n);
}

export function convertToUsdEur(
  amount: number | null | undefined,
  currency: string | null | undefined,
  table: UsdFxTable | null,
): { usd: number | null; eur: number | null } {
  if (amount == null || !Number.isFinite(amount) || !table) return { usd: null, eur: null };
  const cur = (currency ?? "USD").toUpperCase();
  const eurPerUsd = table.perUsd.EUR;
  if (!eurPerUsd || eurPerUsd <= 0) return { usd: null, eur: null };

  if (cur === "USD") {
    return { usd: roundMoney(amount), eur: roundMoney(amount * eurPerUsd) };
  }
  if (cur === "EUR") {
    return { usd: roundMoney(amount / eurPerUsd), eur: roundMoney(amount) };
  }

  const unitsPerUsd = table.perUsd[cur];
  if (!unitsPerUsd || unitsPerUsd <= 0) return { usd: null, eur: null };
  const usd = amount / unitsPerUsd;
  return { usd: roundMoney(usd), eur: roundMoney(usd * eurPerUsd) };
}

/** Prefer already-persisted USD/EUR; otherwise convert from original currency. */
export function resolveUsdEur(
  amount: number | null | undefined,
  currency: string | null | undefined,
  persistedUsd: number | null | undefined,
  persistedEur: number | null | undefined,
  table: UsdFxTable | null,
  krwFx: FxSnapshot | null,
): { usd: number | null; eur: number | null } {
  if (persistedUsd != null && Number.isFinite(persistedUsd) && persistedEur != null && Number.isFinite(persistedEur)) {
    return { usd: Number(persistedUsd), eur: Number(persistedEur) };
  }
  if (persistedUsd != null && Number.isFinite(persistedUsd)) {
    const eurPerUsd = table?.perUsd.EUR ?? (krwFx && krwFx.usdPerKrw > 0 ? krwFx.eurPerKrw / krwFx.usdPerKrw : null);
    return {
      usd: Number(persistedUsd),
      eur: eurPerUsd && eurPerUsd > 0 ? roundMoney(Number(persistedUsd) * eurPerUsd) : persistedEur ?? null,
    };
  }
  const fromTable = convertToUsdEur(amount, currency, table);
  if (fromTable.usd != null) return fromTable;
  return convertKrw(amount, currency, krwFx) ?? { usd: null, eur: null };
}

export function convertKrw(
  amount: number | null | undefined,
  currency: string | null | undefined,
  fx: FxSnapshot | null,
): ConvertedPrice | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const cur = (currency ?? "KRW").toUpperCase();
  if (cur === "USD") {
    const eurPerUsd = fx && fx.usdPerKrw > 0 ? fx.eurPerKrw / fx.usdPerKrw : null;
    return {
      amount,
      currency: cur,
      usd: roundMoney(amount),
      eur: eurPerUsd ? roundMoney(amount * eurPerUsd) : null,
      fx,
    };
  }
  if (cur === "EUR") {
    const eurPerUsd = fx && fx.usdPerKrw > 0 ? fx.eurPerKrw / fx.usdPerKrw : null;
    return {
      amount,
      currency: cur,
      usd: eurPerUsd ? roundMoney(amount / eurPerUsd) : null,
      eur: roundMoney(amount),
      fx,
    };
  }
  if (cur !== "KRW" || !fx) {
    return { amount, currency: cur, usd: null, eur: null, fx };
  }
  return {
    amount,
    currency: cur,
    usd: roundMoney(amount * fx.usdPerKrw),
    eur: roundMoney(amount * fx.eurPerKrw),
    fx,
  };
}

export function withPriceFx<
  T extends {
    priceAmount?: number | null;
    priceCurrency?: string | null;
    priceUsd?: number | null;
    priceEur?: number | null;
  },
>(
  row: T,
  fx: FxSnapshot | null,
  usdTable?: UsdFxTable | null,
): T & { priceUsd: number | null; priceEur: number | null; fx: FxSnapshot | null } {
  const converted = resolveUsdEur(row.priceAmount, row.priceCurrency, row.priceUsd, row.priceEur, usdTable ?? null, fx);
  return {
    ...row,
    priceUsd: converted.usd,
    priceEur: converted.eur,
    fx,
  };
}

export async function getUsdFxTable(): Promise<UsdFxTable | null> {
  if (memoryUsd && Date.now() - memoryUsd.at < STALE_MS) return memoryUsd.table;

  const stored = await readUsdTableFromDb();
  if (stored && Date.now() - new Date(stored.fetchedAt).getTime() < STALE_MS) {
    memoryUsd = { table: stored, at: Date.now() };
    return stored;
  }

  try {
    const fresh = await fetchUsdRates();
    await persistUsdTable(fresh);
    memoryUsd = { table: fresh, at: Date.now() };
    // Keep KRW snapshot in sync for existing call sites.
    const krw = krwSnapshotFromUsdTable(fresh);
    if (krw) {
      await persistKrwSnapshot(krw);
      memoryKrw = { snapshot: krw, at: Date.now() };
    }
    return fresh;
  } catch (err) {
    logger.warn({ err }, "Live FX fetch failed; using last stored USD rates if any");
    if (stored) {
      memoryUsd = { table: stored, at: Date.now() };
      return stored;
    }
    return null;
  }
}

export async function getKrwFxSnapshot(): Promise<FxSnapshot | null> {
  if (memoryKrw && Date.now() - memoryKrw.at < STALE_MS) return memoryKrw.snapshot;

  const table = await getUsdFxTable();
  if (table) {
    const fromUsd = krwSnapshotFromUsdTable(table);
    if (fromUsd) {
      memoryKrw = { snapshot: fromUsd, at: Date.now() };
      return fromUsd;
    }
  }

  const stored = await readKrwFromDb();
  if (stored) {
    memoryKrw = { snapshot: stored, at: Date.now() };
    return stored;
  }
  return null;
}

function krwSnapshotFromUsdTable(table: UsdFxTable): FxSnapshot | null {
  const krwPerUsd = table.perUsd.KRW;
  const eurPerUsd = table.perUsd.EUR;
  if (!krwPerUsd || !eurPerUsd || krwPerUsd <= 0 || eurPerUsd <= 0) return null;
  const usdPerKrw = 1 / krwPerUsd;
  const eurPerKrw = eurPerUsd / krwPerUsd;
  return {
    base: "KRW",
    usdPerKrw,
    eurPerKrw,
    krwPerUsd,
    krwPerEur: krwPerUsd / eurPerUsd,
    fetchedAt: table.fetchedAt,
    source: table.source,
  };
}

async function readUsdTableFromDb(): Promise<UsdFxTable | null> {
  const rows = await db
    .select()
    .from(fxRatesTable)
    .where(eq(fxRatesTable.baseCurrency, "USD"))
    .orderBy(desc(fxRatesTable.fetchedAt))
    .limit(40);

  if (!rows.length) return null;
  const newest = rows[0]!.fetchedAt.getTime();
  const perUsd: Record<string, number> = { USD: 1 };
  let source = rows[0]!.source;
  for (const row of rows) {
    if (Math.abs(row.fetchedAt.getTime() - newest) > 5_000) continue;
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    perUsd[row.quoteCurrency.toUpperCase()] = rate;
    source = row.source;
  }
  if (!perUsd.EUR) return null;
  return {
    perUsd,
    fetchedAt: rows[0]!.fetchedAt.toISOString(),
    source,
  };
}

async function readKrwFromDb(): Promise<FxSnapshot | null> {
  const [usd, eur] = await Promise.all(
    (["USD", "EUR"] as const).map((quote) =>
      db
        .select()
        .from(fxRatesTable)
        .where(and(eq(fxRatesTable.baseCurrency, "KRW"), eq(fxRatesTable.quoteCurrency, quote)))
        .orderBy(desc(fxRatesTable.fetchedAt))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ),
  );
  if (!usd || !eur) return null;
  const usdRate = Number(usd.rate);
  const eurRate = Number(eur.rate);
  if (!Number.isFinite(usdRate) || !Number.isFinite(eurRate) || usdRate <= 0 || eurRate <= 0) return null;
  return {
    base: "KRW",
    usdPerKrw: usdRate,
    eurPerKrw: eurRate,
    krwPerUsd: Number(usd.inverseRate) || 1 / usdRate,
    krwPerEur: Number(eur.inverseRate) || 1 / eurRate,
    fetchedAt: (usd.fetchedAt > eur.fetchedAt ? usd.fetchedAt : eur.fetchedAt).toISOString(),
    source: usd.source,
  };
}

async function persistUsdTable(table: UsdFxTable): Promise<void> {
  const fetchedAt = new Date(table.fetchedAt);
  const values = Object.entries(table.perUsd)
    .filter(([quote, rate]) => {
      if (quote === "USD") return false;
      if (!Number.isFinite(rate) || rate <= 0) return false;
      const inverse = 1 / rate;
      // numeric(18,10) allows 8 digits left of the decimal.
      return rate < 1e8 && inverse < 1e8;
    })
    .map(([quote, rate]) => ({
      baseCurrency: "USD",
      quoteCurrency: quote,
      rate: rate.toFixed(10),
      inverseRate: (1 / rate).toFixed(10),
      source: table.source,
      fetchedAt,
    }));
  try {
    if (values.length) await db.insert(fxRatesTable).values(values);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), pairs: values.length },
      "FX USD snapshot persist skipped",
    );
  }
}

async function persistKrwSnapshot(snapshot: FxSnapshot): Promise<void> {
  const fetchedAt = new Date(snapshot.fetchedAt);
  await db.insert(fxRatesTable).values([
    {
      baseCurrency: "KRW",
      quoteCurrency: "USD",
      rate: snapshot.usdPerKrw.toFixed(10),
      inverseRate: snapshot.krwPerUsd.toFixed(10),
      source: snapshot.source,
      fetchedAt,
    },
    {
      baseCurrency: "KRW",
      quoteCurrency: "EUR",
      rate: snapshot.eurPerKrw.toFixed(10),
      inverseRate: snapshot.krwPerEur.toFixed(10),
      source: snapshot.source,
      fetchedAt,
    },
  ]);
}

async function fetchUsdRates(): Promise<UsdFxTable> {
  const errors: string[] = [];
  for (const probe of [fetchUsdFawazAhmed, fetchUsdOpenErApi]) {
    try {
      return await probe();
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(`All FX sources failed: ${errors.join(" | ")}`);
}

async function fetchJson(url: string, timeoutMs = 8_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function tableFromUsdRates(
  rates: Record<string, number>,
  fetchedAt: string | undefined,
  source: string,
): UsdFxTable {
  const perUsd: Record<string, number> = { USD: 1 };
  // Tracked fiat only — the public FX dump includes crypto/obscure ticks whose
  // inverse overflows numeric(18,10) and used to stall the API logger.
  for (const quote of TRACKED_QUOTES) {
    const key = quote.toLowerCase();
    const upper = quote.toUpperCase();
    const val = rates[upper] ?? rates[key];
    if (val != null && Number.isFinite(val) && val > 0) perUsd[upper] = val;
  }
  if (!perUsd.EUR) throw new Error("FX response missing EUR");
  return {
    perUsd,
    fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : new Date().toISOString(),
    source,
  };
}

async function fetchUsdFawazAhmed(): Promise<UsdFxTable> {
  const json = (await fetchJson(
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
  )) as { date?: string; usd?: Record<string, number> };
  if (!json.usd) throw new Error("fawazahmed0 response missing usd map");
  return tableFromUsdRates(json.usd, json.date, "fawazahmed0/currency-api");
}

async function fetchUsdOpenErApi(): Promise<UsdFxTable> {
  const json = (await fetchJson("https://open.er-api.com/v6/latest/USD")) as {
    result?: string;
    rates?: Record<string, number>;
    time_last_update_utc?: string;
  };
  if (json.result !== "success" || !json.rates) throw new Error("open.er-api.com response missing rates");
  return tableFromUsdRates(json.rates, json.time_last_update_utc, "open.er-api.com");
}

const KRW_PER_USD_FALLBACK = 1400;

export function usdToKrw(usd: number, fx: FxSnapshot | null): number {
  const rate = fx?.krwPerUsd && fx.krwPerUsd > 0 ? fx.krwPerUsd : KRW_PER_USD_FALLBACK;
  return Math.round(usd * rate);
}

/** Asking price in USD for mixed-currency live listings. */
export function livePriceUsd(
  vehicle: { price?: number; currency?: string; priceUsd?: number | null; priceOnRequest?: boolean },
  fx?: FxSnapshot | null,
  usdTable?: UsdFxTable | null,
): number | null {
  if (vehicle.priceOnRequest) return null;
  if (vehicle.priceUsd != null && Number.isFinite(vehicle.priceUsd)) return vehicle.priceUsd;
  const amount = vehicle.price;
  if (amount == null || !Number.isFinite(amount)) return null;
  const fromTable = convertToUsdEur(amount, vehicle.currency, usdTable ?? null);
  if (fromTable.usd != null) return fromTable.usd;
  const cur = (vehicle.currency ?? "KRW").toUpperCase();
  if (cur === "USD") return amount;
  if (cur === "KRW") {
    const per = fx?.usdPerKrw;
    if (per && per > 0) return amount * per;
  }
  return null;
}

export function withLivePriceFx<
  T extends { price?: number; currency?: string; msrp?: number; priceUsd?: number | null; priceEur?: number | null },
>(
  vehicle: T,
  fx: FxSnapshot | null,
  usdTable?: UsdFxTable | null,
): T & {
  priceUsd: number | null;
  priceEur: number | null;
  msrpUsd: number | null;
  msrpEur: number | null;
  fx: FxSnapshot | null;
} {
  const price = resolveUsdEur(vehicle.price, vehicle.currency, vehicle.priceUsd, vehicle.priceEur, usdTable ?? null, fx);
  const msrp = convertToUsdEur(vehicle.msrp, vehicle.currency, usdTable ?? null);
  const msrpFallback = msrp.usd == null ? convertKrw(vehicle.msrp, vehicle.currency ?? "KRW", fx) : null;
  return {
    ...vehicle,
    priceUsd: price.usd,
    priceEur: price.eur,
    msrpUsd: msrp.usd ?? msrpFallback?.usd ?? null,
    msrpEur: msrp.eur ?? msrpFallback?.eur ?? null,
    fx,
  };
}

/** Attach frozen USD/EUR on a normalized listing at fetch time (mutates + returns). */
export async function attachListingFx<
  T extends { priceAmount?: number; priceCurrency?: string; priceUsd?: number; priceEur?: number },
>(listing: T): Promise<T> {
  if (listing.priceAmount == null || !Number.isFinite(listing.priceAmount)) return listing;
  const cur = (listing.priceCurrency ?? "USD").toUpperCase();
  if (cur === "USD" && listing.priceUsd != null && listing.priceEur != null) return listing;

  const table = await getUsdFxTable();
  const { usd, eur } = convertToUsdEur(listing.priceAmount, cur, table);
  if (usd == null || eur == null) {
    const krw = await getKrwFxSnapshot();
    const fallback = convertKrw(listing.priceAmount, cur, krw);
    if (fallback?.usd != null) listing.priceUsd = roundMajor(fallback.usd);
    if (fallback?.eur != null) listing.priceEur = roundMajor(fallback.eur);
    return listing;
  }
  listing.priceUsd = roundMajor(usd);
  listing.priceEur = roundMajor(eur);
  return listing;
}
