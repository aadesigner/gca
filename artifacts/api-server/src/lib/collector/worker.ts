/**
 * Collection Job Worker
 *
 * Polls `collection_jobs` for pending work and runs up to
 * `maxCollectionJobsParallel` jobs concurrently. Within each job, listings
 * are fetched in parallel (`filterParams.concurrency`) and recently-seen cars
 * are skipped before the expensive detail fetch.
 */

import { db, collectionJobsTable, providersTable, settingsTable, listingsTable } from "@workspace/db";
import { eq, and, sql, gt, lt, asc, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { EncarHistoricalAdapter, type EncarFilterParams, PARSER_VERSION, DETAIL_WEB_BASE } from "../providers/encar";
import { AutowiniHistoricalAdapter, AUTWINI_PARSER_VERSION, type AutowiniFilterParams } from "../providers/autowini";
import { AUTWINI_WEB_BASE } from "../providers/autowini-http";
import { KbchachachaHistoricalAdapter, KBCHACHACHA_PARSER_VERSION } from "../providers/kbchachacha";
import { KbRequestError, kbDetailUrl } from "../providers/kbchachacha-http";
import { MangoHistoricalAdapter, MANGO_PARSER_VERSION, mangoDetailUrl } from "../providers/mango";
import { SeobukHistoricalAdapter, SEOBUK_PARSER_VERSION, seobukDetailUrl } from "../providers/seobuk";
import { SsancarHistoricalAdapter, SSANCAR_PARSER_VERSION, ssancarDetailUrl } from "../providers/ssancar";
import {
  KoreaautoAuctionHistoricalAdapter,
  KOREAAUTO_AUCTION_PARSER_VERSION,
  koreaautoAuctionDetailUrl,
} from "../providers/koreaauto-auction";
import { CarpoolkrHistoricalAdapter, CARPOOLKR_PARSER_VERSION, carpoolDetailUrl } from "../providers/carpoolkr";
import {
  LotteAutoglobalHistoricalAdapter,
  LOTTE_AUTOGLOBAL_PARSER_VERSION,
  lotteDetailUrl,
} from "../providers/lotte-autoglobal";
import { AuctionautoHistoricalAdapter, AUCTIONAUTO_PARSER_VERSION, auctionautoDetailUrl } from "../providers/auctionauto";
import { KoreaUsedCarsHistoricalAdapter, KOREAUSEDCARS_PARSER_VERSION, koreaUsedCarsDetailUrl } from "../providers/koreausedcars";
import { AuctionwiniHistoricalAdapter, AUCTIONWINI_PARSER_VERSION, auctionwiniDetailUrl } from "../providers/auctionwini";
import { HeydealerHistoricalAdapter, HEYDEALER_PARSER_VERSION, heydealerDetailUrl } from "../providers/heydealer";
import { BobaedreamHistoricalAdapter, BobaedreamCyberHistoricalAdapter, BOBAEDREAM_PARSER_VERSION, BOBAEDREAMCYBER_PARSER_VERSION, bobaedreamDetailUrl, bobaedreamCyberDetailUrl } from "../providers/bobaedream";
import { SalvagebidHistoricalAdapter, SALVAGEBID_PARSER_VERSION, salvagebidDetailUrl } from "../providers/salvagebid";
import { BatHistoricalAdapter, BAT_PARSER_VERSION, batDetailUrl } from "../providers/bringatrailer";
import { IaaHistoricalAdapter, IAA_PARSER_VERSION, iaaDetailUrl } from "../providers/iaa";
import {
  Autoscout24HistoricalAdapter,
  AutotradercaHistoricalAdapter,
  AUTOSCOUT24_PARSER_VERSION,
  AUTOTRADERCA_PARSER_VERSION,
  autoscout24DetailUrl,
  autotradercaDetailUrl,
} from "../providers/autoscout24";
import { DubicarsHistoricalAdapter, DUBICARS_PARSER_VERSION, dubicarsDetailUrl } from "../providers/dubicars";
import { OtomotoHistoricalAdapter, OTOMOTO_PARSER_VERSION, otomotoDetailUrl } from "../providers/otomoto";
import { KcarHistoricalAdapter, KCAR_PARSER_VERSION, kcarDetailUrl } from "../providers/kcar";
import { Cars24aeHistoricalAdapter, CARS24AE_PARSER_VERSION, cars24aeDetailUrl } from "../providers/cars24ae";
import { WillhabenHistoricalAdapter, WILLHABEN_PARSER_VERSION, willhabenDetailUrl } from "../providers/willhaben";
import { CarpagesHistoricalAdapter, CARPAGES_PARSER_VERSION, carpagesDetailUrl } from "../providers/carpages";
import { AutobellHistoricalAdapter, AUTOBELL_PARSER_VERSION, autobellDetailUrl } from "../providers/autobell";
import {
  KolonAutoHistoricalAdapter,
  KOLON_AUTO_PARSER_VERSION,
  kolonDetailUrl,
} from "../providers/kolon-auto";
import {
  ImportMotorHistoricalAdapter,
  IMPORT_MOTOR_PARSER_VERSION,
  IMPORT_MOTOR_WEB_BASE,
  IMPORT_MOTOR_COUNTRY_PRIORITY,
  seedImportMotorCountryCoverage,
} from "../providers/import-motor";
import { BidscanHistoricalAdapter, BIDSCAN_PARSER_VERSION, BIDSCAN_WEB_BASE } from "../providers/bidscan";
import { KrRequestError } from "../providers/kr-http";
import { mergeCrawlDefaults, crawlProfileFor } from "../crawl-profiles";
import { ENCAR_DOMESTIC_MAKES_EN, ENCAR_IMPORT_MAKES_EN } from "../providers/encar-catalog";
import { EncarRequestError, getEncarHealthSnapshot } from "../providers/encar-http";
import { processFetchedListing, markListingGone } from "./pipeline";
import { findRecentlySeenSourceIds, findKnownSourceIds, findAlreadyCrawledImportMotorVins } from "./listing-skip";
import { runWithConcurrency, createProgressLock } from "./concurrency";
import type { ProviderAdapter, ListingReference, PaginationInfo } from "@workspace/providers";
import { isKoreanImportMotorOrigin } from "../providers/import-motor-parse";

const POLL_INTERVAL_MS = 2_000;
const MAX_CONCURRENCY_DEFAULT = 6;
const DEFAULT_LISTING_CONCURRENCY = 3;
const DISCOVER_PAGE_RETRIES = 6;
const DEFAULT_SKIP_RECENT_HOURS = 12;
const INCREMENTAL_SKIP_RECENT_HOURS = 24;
const INCREMENTAL_FULL_SKIP_PAGE_LIMIT = 2;
const REFRESH_BATCH_SIZE = 40;
const REFRESH_SKIP_RECENT_HOURS = 12;
const LISTING_REFRESH_REPEAT_HOURS = 5;
const ENCAR_AUTWINI_REFRESH_HOURS = 2;

/** After unbounded first crawl, keep watching new/sold/price on these marketplaces. */
const LISTING_REFRESH_FOLLOWUP = new Set([
  "encar",
  "ams",
  "autowini",
  "autoscout24",
  "autotraderca",
  "dubicars",
  "otomoto",
  "kcar",
  "cars24ae",
  "willhaben",
  "carpages",
  "autobell",
  "lotte_autoglobal",
  "kolon_auto",
]);

const PARSER_VERSIONS: Record<string, string> = {
  encar: PARSER_VERSION,
  ams: PARSER_VERSION,
  autowini: AUTWINI_PARSER_VERSION,
  kbchachacha: KBCHACHACHA_PARSER_VERSION,
  mango: MANGO_PARSER_VERSION,
  seobuk: SEOBUK_PARSER_VERSION,
  ssancar: SSANCAR_PARSER_VERSION,
  koreaauto_auction: KOREAAUTO_AUCTION_PARSER_VERSION,
  carpoolkr: CARPOOLKR_PARSER_VERSION,
  lotte_autoglobal: LOTTE_AUTOGLOBAL_PARSER_VERSION,
  kolon_auto: KOLON_AUTO_PARSER_VERSION,
  auctionauto: AUCTIONAUTO_PARSER_VERSION,
  koreausedcars: KOREAUSEDCARS_PARSER_VERSION,
  auctionwini: AUCTIONWINI_PARSER_VERSION,
  heydealer: HEYDEALER_PARSER_VERSION,
  bobaedream: BOBAEDREAM_PARSER_VERSION,
  bobaedreamcyber: BOBAEDREAMCYBER_PARSER_VERSION,
  salvagebid: SALVAGEBID_PARSER_VERSION,
  bringatrailer: BAT_PARSER_VERSION,
  iaa: IAA_PARSER_VERSION,
  autoscout24: AUTOSCOUT24_PARSER_VERSION,
  autotraderca: AUTOTRADERCA_PARSER_VERSION,
  dubicars: DUBICARS_PARSER_VERSION,
  otomoto: OTOMOTO_PARSER_VERSION,
  kcar: KCAR_PARSER_VERSION,
  cars24ae: CARS24AE_PARSER_VERSION,
  willhaben: WILLHABEN_PARSER_VERSION,
  carpages: CARPAGES_PARSER_VERSION,
  autobell: AUTOBELL_PARSER_VERSION,
  import_motor: IMPORT_MOTOR_PARSER_VERSION,
  copart: BIDSCAN_PARSER_VERSION,
};

const persistProviderCache = new Map<string, number>();

async function resolvePersistProviderId(targetName: string | undefined, fallbackId: number): Promise<number> {
  const name = targetName?.trim();
  if (!name) return fallbackId;
  const cached = persistProviderCache.get(name);
  if (cached) return cached;
  const [row] = await db
    .select({ id: providersTable.id })
    .from(providersTable)
    .where(eq(providersTable.internalName, name))
    .limit(1);
  if (!row) {
    logger.warn({ targetName: name, fallbackId }, "targetProvider missing; persisting on job provider");
    return fallbackId;
  }
  persistProviderCache.set(name, row.id);
  return row.id;
}

/**
 * Import Motor re-crawls must not split one lot across import_motor + iaa/copart/encar.
 * Match both `im-123` and bare `123` source ids from earlier parser bugs.
 */
async function resolveImportMotorPersistProviderId(
  listing: { sourceId?: string; targetProvider?: string; vehicle?: { vin?: string | null } | null },
  fallbackId: number,
): Promise<number> {
  const sourceId = String(listing.sourceId ?? "").trim();
  const sourceIds = new Set<string>();
  if (sourceId) {
    sourceIds.add(sourceId);
    if (sourceId.startsWith("im-")) sourceIds.add(sourceId.slice(3));
    else if (/^\d{5,}$/.test(sourceId)) sourceIds.add(`im-${sourceId}`);
  }
  if (sourceIds.size > 0) {
    const [existing] = await db
      .select({ providerId: listingsTable.providerId, internalName: providersTable.internalName })
      .from(listingsTable)
      .innerJoin(providersTable, eq(providersTable.id, listingsTable.providerId))
      .where(
        and(
          inArray(listingsTable.sourceId, [...sourceIds]),
          inArray(providersTable.internalName, [
            "iaa",
            "copart",
            "import_motor",
            "encar",
            "autowini",
          ]),
        ),
      )
      .orderBy(asc(listingsTable.id))
      .limit(1);
    if (existing?.providerId) {
      // Prefer sticking with US auction providers over a prior mis-tagged Encar row.
      if (existing.internalName === "encar" || existing.internalName === "autowini") {
        const preferred = await resolvePersistProviderId(listing.targetProvider, fallbackId);
        const [pref] = await db
          .select({ internalName: providersTable.internalName })
          .from(providersTable)
          .where(eq(providersTable.id, preferred))
          .limit(1);
        if (pref && (pref.internalName === "copart" || pref.internalName === "iaa" || pref.internalName === "import_motor")) {
          return preferred;
        }
      }
      return existing.providerId;
    }
  }
  const vin = String(listing.vehicle?.vin ?? "").trim().toUpperCase();
  if (vin.length === 17) {
    const [byVin] = await db
      .select({ providerId: listingsTable.providerId, internalName: providersTable.internalName })
      .from(listingsTable)
      .innerJoin(providersTable, eq(providersTable.id, listingsTable.providerId))
      .where(
        and(
          eq(listingsTable.vin, vin),
          inArray(providersTable.internalName, ["iaa", "copart", "import_motor"]),
          sql`${listingsTable.sourceUrl} ILIKE '%import-motor.com%'`,
        ),
      )
      .orderBy(asc(listingsTable.id))
      .limit(1);
    if (byVin?.providerId) return byVin.providerId;
  }
  return resolvePersistProviderId(listing.targetProvider, fallbackId);
}

/** 0 or negative means crawl until Encar has no more pages/listings. */
function unbounded(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isFinite(value) || value <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.floor(value);
}

function isJobScheduledInFuture(jobConfig: string | null): boolean {
  if (!jobConfig) return false;
  try {
    const parsed = JSON.parse(jobConfig) as { nextRunAt?: string };
    if (!parsed.nextRunAt) return false;
    const at = Date.parse(parsed.nextRunAt);
    return Number.isFinite(at) && at > Date.now();
  } catch {
    return false;
  }
}

function stripNextRunAt(jobConfig: string | null): string | null {
  if (!jobConfig) return jobConfig;
  try {
    const parsed = JSON.parse(jobConfig) as { nextRunAt?: string };
    if (!parsed.nextRunAt) return jobConfig;
    delete parsed.nextRunAt;
    return JSON.stringify(parsed);
  } catch {
    return jobConfig;
  }
}

function listingRefreshRepeatHours(
  filterParams: EncarFilterParams & { repeatHours?: number },
  internalName?: string,
): number {
  if (filterParams.repeatHours === 0) return 0;
  const hours = filterParams.repeatHours ?? defaultRefreshHours(internalName);
  return hours > 0 ? hours : 0;
}

function scheduledRepeatHours(
  jobType: string,
  filterParams: Record<string, unknown>,
  internalName: string,
): number {
  if (jobType === "listing_refresh") {
    return listingRefreshRepeatHours(filterParams as EncarFilterParams & { repeatHours?: number }, internalName);
  }
  if (jobType === "incremental") {
    const hours = Number((filterParams as { repeatHours?: number }).repeatHours ?? 0);
    return hours > 0 ? hours : 0;
  }
  return 0;
}

function defaultRefreshHours(internalName?: string): number {
  if (internalName === "encar" || internalName === "ams" || internalName === "autowini") {
    return ENCAR_AUTWINI_REFRESH_HOURS;
  }
  return LISTING_REFRESH_REPEAT_HOURS;
}

let workerRunning = false;
let pollTimer: NodeJS.Timeout | null = null;

interface JobProgress {
  pagesProcessed: number;
  itemsDiscovered: number;
  itemsProcessed: number;
  itemsFailed: number;
  listingsFetched: number;
  listingsSkipped: number;
  vinsFound: number;
  vinsNew: number;
  newObservations: number;
  duplicatesSkipped: number;
}

type CrawlShardStatus = "pending" | "active" | "cooldown" | "completed";

interface CrawlShardState {
  id: string;
  label: string;
  filters: EncarFilterParams;
  status: CrawlShardStatus;
  nextPage: number;
  pagesProcessed: number;
  itemsDiscovered: number;
  listingsFetched: number;
  discoverFailures: number;
  cooldownUntil: string | null;
  lastError: string | null;
  /** Import Motor: sticky "Showing … of Z" so a bad page cannot end the country early. */
  expectedResultTotal?: number;
  expectedTotalPages?: number;
}

interface CrawlState {
  version: 1;
  strategy: "single" | "year" | "listing_refresh";
  currentShardId: string | null;
  shards: CrawlShardState[];
  /** listing_refresh: discover new/updated search hits, then re-check stale known ads. */
  refreshPhase?: "discover" | "stale";
  /** listing_refresh stale phase: last listings.id processed (resume cursor). */
  refreshAfterId?: number;
  lastBlock: {
    at: string;
    category: string;
    message: string;
  } | null;
  lastHealthSnapshot: ReturnType<typeof getEncarHealthSnapshot> | null;
}

function currentYear(): number {
  return new Date().getUTCFullYear();
}

function cloneFilterParams(filters: EncarFilterParams): EncarFilterParams {
  return JSON.parse(JSON.stringify(filters)) as EncarFilterParams;
}

function buildInitialCrawlState(
  jobType: string,
  filterParams: EncarFilterParams,
  providerName = "encar",
): CrawlState {
  const shards = buildShards(jobType, filterParams, providerName);
  return {
    version: 1,
    strategy: jobType === "listing_refresh" ? "listing_refresh" : shards.length > 1 ? "year" : "single",
    currentShardId: shards[0]?.id ?? null,
    shards,
    refreshPhase: jobType === "listing_refresh" ? "discover" : undefined,
    refreshAfterId: jobType === "listing_refresh" ? 0 : undefined,
    lastBlock: null,
    lastHealthSnapshot: null,
  };
}

function buildShards(
  jobType: string,
  baseFilters: EncarFilterParams,
  providerName = "encar",
): CrawlShardState[] {
  const autowini = providerName === "autowini";
  const kbchachacha = providerName === "kbchachacha";
  const filters = baseFilters as EncarFilterParams & AutowiniFilterParams;
  if (jobType === "listing_refresh") {
    return [makeShard("discover", "New & updated", baseFilters)];
  }

  if (providerName === "import_motor") {
    return buildImportMotorShards(baseFilters);
  }

  const shardable =
    jobType !== "single_listing" &&
    !filters.searchQuery &&
    filters.yearFrom == null &&
    filters.yearTo == null &&
    !filters.brand &&
    !filters.model &&
    !filters.modelGroup &&
    !filters.badgeGroup &&
    !filters.make &&
    !filters.subModel;

  if (!shardable || (providerName !== "encar" && providerName !== "ams" && !autowini)) {
    return [makeShard("all", autowini || kbchachacha ? "All listings" : "All years", baseFilters)];
  }

  const shards: CrawlShardState[] = [];
  const end = currentYear();
  const start = 1990;
  for (let year = end; year >= start; year--) {
    shards.push(
      makeShard(`year-${year}`, String(year), {
        ...cloneFilterParams(baseFilters),
        yearFrom: year,
        yearTo: year,
      }),
    );
  }
  shards.push(
    makeShard("years-legacy", "1989 and older", {
      ...cloneFilterParams(baseFilters),
      yearFrom: 1900,
      yearTo: 1989,
    }),
  );
  return shards;
}

function makeShard(id: string, label: string, filters: EncarFilterParams): CrawlShardState {
  return {
    id,
    label,
    filters,
    status: "pending",
    nextPage: 1,
    pagesProcessed: 0,
    itemsDiscovered: 0,
    listingsFetched: 0,
    discoverFailures: 0,
    cooldownUntil: null,
    lastError: null,
  };
}

function buildImportMotorShards(baseFilters: EncarFilterParams): CrawlShardState[] {
  const raw = (baseFilters as { countries?: unknown }).countries;
  const explicit = Array.isArray(raw)
    ? raw.map((v) => String(v).trim().toLowerCase()).filter((cc) => /^[a-z]{2}$/.test(cc) || cc === "*rest")
    : [];

  const codes = explicit.length > 0 ? explicit : [...IMPORT_MOTOR_COUNTRY_PRIORITY, "*rest"];
  const fullCrawl = new Set(
    Array.isArray((baseFilters as { fullCrawlCountries?: unknown }).fullCrawlCountries)
      ? ((baseFilters as { fullCrawlCountries: unknown[] }).fullCrawlCountries ?? [])
          .map((v) => String(v).trim().toLowerCase())
          .filter((cc) => /^[a-z]{2}$/.test(cc) || cc === "*rest")
      : [],
  );

  return codes.map((cc) => {
    const filters = {
      ...cloneFilterParams(baseFilters),
      countries: [cc],
    } as EncarFilterParams & {
      origins?: unknown;
      fullCrawl?: boolean;
      fullCrawlCountries?: unknown;
    };
    if (fullCrawl.has(cc)) {
      delete filters.origins;
      filters.fullCrawl = true;
    }
    return makeShard(
      `im-${cc === "*rest" ? "rest" : cc}`,
      cc === "*rest" ? "Other destinations" : cc.toUpperCase(),
      filters,
    );
  });
}

/** Encar search Count/offset tops out around 10k hits; wider queries look "done" while cars remain. */
const ENCAR_SEARCH_WINDOW = 10_000;

function estimatedSearchTotal(pagination: PaginationInfo, pageSize: number): number {
  if (pagination.totalPages && pagination.totalPages > 0 && pageSize > 0) {
    return pagination.totalPages * pageSize;
  }
  return 0;
}

function canSplitEncarShard(shard: CrawlShardState): boolean {
  const f = shard.filters;
  if (f.yearFrom != null && f.yearTo != null && f.yearTo > f.yearFrom) return true;
  if (!f.brand) return true;
  const from = f.yearMonthFrom;
  const to = f.yearMonthTo;
  if (from != null && to != null && to - from > 1) return true;
  if (from == null && to == null) return true;
  return false;
}

function shouldSplitCappedEncarShard(
  adapterName: string,
  shard: CrawlShardState,
  pagination: PaginationInfo,
  pageSize: number,
): boolean {
  if (adapterName !== "encar" && adapterName !== "ams") return false;
  if (!canSplitEncarShard(shard)) return false;
  return estimatedSearchTotal(pagination, pageSize) >= ENCAR_SEARCH_WINDOW;
}

function splitCappedEncarShard(shard: CrawlShardState): CrawlShardState[] {
  const f = cloneFilterParams(shard.filters);
  const fromYear = f.yearFrom;
  const toYear = f.yearTo;

  if (fromYear != null && toYear != null && toYear > fromYear) {
    const extras: CrawlShardState[] = [];
    for (let year = toYear; year >= fromYear; year--) {
      extras.push(
        makeShard(`${shard.id}-y${year}`, `${year}`, {
          ...cloneFilterParams(f),
          yearFrom: year,
          yearTo: year,
        }),
      );
    }
    return extras;
  }

  if (!f.brand) {
    const makes = f.carType === "domestic" ? ENCAR_DOMESTIC_MAKES_EN : ENCAR_IMPORT_MAKES_EN;
    return makes.map((make) =>
      makeShard(
        `${shard.id}-${make.replace(/[^A-Za-z0-9]+/g, "")}`,
        `${shard.label} ${make}`,
        { ...cloneFilterParams(f), brand: make },
      ),
    );
  }

  const year = fromYear ?? toYear ?? currentYear();
  const monthFrom = f.yearMonthFrom ?? year * 100 + 1;
  const monthTo = f.yearMonthTo ?? year * 100 + 12;
  if (monthTo - monthFrom <= 1) return [];
  const mid = Math.floor((monthFrom + monthTo) / 2);
  return [
    makeShard(`${shard.id}-a`, `${shard.label} ${monthFrom}-${mid}`, {
      ...cloneFilterParams(f),
      yearFrom: year,
      yearTo: year,
      yearMonthFrom: monthFrom,
      yearMonthTo: mid,
    }),
    makeShard(`${shard.id}-b`, `${shard.label} ${mid + 1}-${monthTo}`, {
      ...cloneFilterParams(f),
      yearFrom: year,
      yearTo: year,
      yearMonthFrom: mid + 1,
      yearMonthTo: monthTo,
    }),
  ];
}

function parseCrawlState(
  raw: string | null,
  jobType: string,
  filterParams: EncarFilterParams,
  providerName = "encar",
): CrawlState {
  if (!raw) return buildInitialCrawlState(jobType, filterParams, providerName);
  try {
    const parsed = JSON.parse(raw) as CrawlState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.shards) || parsed.shards.length === 0) {
      return buildInitialCrawlState(jobType, filterParams, providerName);
    }
    if (jobType === "listing_refresh") {
      if (parsed.strategy !== "listing_refresh") {
        return buildInitialCrawlState(jobType, filterParams, providerName);
      }
      if (!parsed.refreshPhase) {
        if ((parsed.refreshAfterId ?? 0) > 0) {
          parsed.refreshPhase = "stale";
        } else {
          parsed.refreshPhase = "discover";
          parsed.shards = [makeShard("discover", "New & updated", filterParams)];
          parsed.refreshAfterId = 0;
        }
      }
      return parsed;
    }
    return parsed;
  } catch {
    return buildInitialCrawlState(jobType, filterParams, providerName);
  }
}

function serializeCrawlState(state: CrawlState): string {
  return JSON.stringify(state);
}

function computeCooldownMs(err: Error): number {
  if (err instanceof KbRequestError && err.statusCode === 429) return 10 * 60 * 1000;
  if (err instanceof EncarRequestError) {
    if (err.info.retryAfterMs) return Math.max(5_000, err.info.retryAfterMs);
    if (err.info.category === "hard_block") return 60_000;
    if (err.info.category === "rate_limit") return 30_000;
    if (err.info.category === "transport" || err.info.category === "timeout") return 15_000;
  }
  return 20_000;
}

function shardIsReady(shard: CrawlShardState, ts: number): boolean {
  if (shard.status === "completed") return false;
  if (shard.status === "cooldown" && shard.cooldownUntil && Date.parse(shard.cooldownUntil) > ts) {
    return false;
  }
  if (shard.status === "cooldown" && shard.cooldownUntil && Date.parse(shard.cooldownUntil) <= ts) {
    shard.status = "pending";
    shard.cooldownUntil = null;
  }
  return shard.status === "pending" || shard.status === "active";
}

function pickNextShard(state: CrawlState): CrawlShardState | null {
  const ts = Date.now();
  const current = state.shards.find((shard) => shard.id === state.currentShardId);
  if (current && shardIsReady(current, ts)) return current;

  const chronic = (shard: CrawlShardState) =>
    (shard.discoverFailures ?? 0) >= 8 && (shard.listingsFetched ?? 0) === 0;

  for (const shard of state.shards) {
    if (!shardIsReady(shard, ts)) continue;
    if (chronic(shard)) continue;
    return shard;
  }
  for (const shard of state.shards) {
    if (shardIsReady(shard, ts)) return shard;
  }
  return null;
}

function allShardsCompleted(state: CrawlState): boolean {
  return state.shards.every((shard) => shard.status === "completed");
}

function nextShardWakeMs(state: CrawlState): number | null {
  const waits = state.shards
    .filter((shard) => shard.status === "cooldown" && shard.cooldownUntil)
    .map((shard) => Math.max(0, Date.parse(shard.cooldownUntil!) - Date.now()));
  if (waits.length === 0) return null;
  return Math.min(...waits);
}

async function enqueueListingRefreshFollowup(
  providerId: number,
  internalName: string,
  filterParams: EncarFilterParams,
): Promise<void> {
  if (!LISTING_REFRESH_FOLLOWUP.has(internalName)) return;

  const active = await db
    .select({ id: collectionJobsTable.id })
    .from(collectionJobsTable)
    .where(
      and(
        eq(collectionJobsTable.providerId, providerId),
        eq(collectionJobsTable.jobType, "listing_refresh"),
        inArray(collectionJobsTable.status, ["pending", "running", "paused"]),
      ),
    )
    .limit(1);
  if (active.length > 0) {
    logger.info({ providerId, internalName, jobId: active[0]!.id }, "Listing refresh already queued");
    return;
  }

  const profile = crawlProfileFor(internalName);
  const jobConfig = JSON.stringify({
    delayMs: filterParams.delayMs ?? profile.delayMs,
    concurrency: filterParams.concurrency ?? profile.concurrency,
    retryCount: filterParams.retryCount ?? profile.retryCount,
    skipRecentHours: profile.skipRecentHours,
    detailLevel: "standard",
    repeatHours: defaultRefreshHours(internalName),
    maxPages: 0,
    maxListings: 0,
  });

  const [created] = await db
    .insert(collectionJobsTable)
    .values({
      providerId,
      jobType: "listing_refresh",
      status: "pending",
      jobConfig,
    })
    .returning({ id: collectionJobsTable.id });

  logger.info(
    { providerId, internalName, jobId: created?.id, repeatHours: defaultRefreshHours(internalName) },
    "Queued repeating listing_refresh after full_collection (new ads, sold/price, VIN observations)",
  );
}

/**
 * Start the background job worker (idempotent — safe to call multiple times).
 */
export async function startWorker(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  logger.info("Collection job worker started");

  try {
    const recovered = await db
      .update(collectionJobsTable)
      .set({
        status: "pending",
        completedAt: null,
        errorMessage: null,
      })
      .where(eq(collectionJobsTable.status, "running"))
      .returning({ id: collectionJobsTable.id });
    if (recovered.length > 0) {
      logger.warn({ jobIds: recovered.map((r) => r.id) }, "Re-queued running jobs after worker restart");
    }
  } catch (err) {
    logger.error({ err }, "Failed to re-queue stale running jobs");
  }

  schedulePoll();
}

export function stopWorker(): void {
  workerRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info("Collection job worker stopped");
}

function schedulePoll(): void {
  if (!workerRunning) return;
  pollTimer = setTimeout(async () => {
    try {
      await pollForJobs();
    } catch (err) {
      logger.error({ err }, "Worker poll error");
    } finally {
      schedulePoll();
    }
  }, POLL_INTERVAL_MS);
}

async function getMaxConcurrency(): Promise<number> {
  try {
    const [settings] = await db
      .select({ maxCollectionJobsParallel: settingsTable.maxCollectionJobsParallel })
      .from(settingsTable)
      .where(eq(settingsTable.id, 1));
    const raw = settings?.maxCollectionJobsParallel ?? MAX_CONCURRENCY_DEFAULT;
    // <= 0 means unlimited — run every due pending job.
    if (!Number.isFinite(raw) || raw <= 0) return Number.MAX_SAFE_INTEGER;
    return Math.floor(raw);
  } catch {
    return MAX_CONCURRENCY_DEFAULT;
  }
}

async function pollForJobs(): Promise<void> {
  const maxConcurrency = await getMaxConcurrency();

  const [runningRow] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(collectionJobsTable)
    .where(eq(collectionJobsTable.status, "running"));
  const runningCount = Number(runningRow?.c ?? 0);

  if (runningCount >= maxConcurrency) return;

  const slots = maxConcurrency - runningCount;

  const candidates = await db
    .select({ id: collectionJobsTable.id, jobConfig: collectionJobsTable.jobConfig })
    .from(collectionJobsTable)
    .where(eq(collectionJobsTable.status, "pending"))
    .orderBy(collectionJobsTable.createdAt)
    .limit(Math.max(slots * 20, 50));

  const due = candidates.filter((row) => !isJobScheduledInFuture(row.jobConfig)).slice(0, slots);

  for (const candidate of due) {
    const claimed = await db
      .update(collectionJobsTable)
      .set({
        status: "running",
        startedAt: sql`COALESCE(${collectionJobsTable.startedAt}, NOW())`,
        completedAt: null,
        errorMessage: null,
        jobConfig: stripNextRunAt(candidate.jobConfig),
      })
      .where(
        and(
          eq(collectionJobsTable.id, candidate.id),
          eq(collectionJobsTable.status, "pending"),
        ),
      )
      .returning({
        id: collectionJobsTable.id,
        providerId: collectionJobsTable.providerId,
        jobType: collectionJobsTable.jobType,
        jobConfig: collectionJobsTable.jobConfig,
        targetUrl: collectionJobsTable.targetUrl,
      });

    if (claimed.length === 0) continue;

    const job = claimed[0]!;

    const [providerRow] = await db
      .select({ baseUrl: providersTable.baseUrl })
      .from(providersTable)
      .where(eq(providersTable.id, job.providerId));
    const providerBaseUrl = providerRow?.baseUrl ?? null;

    runJob({ ...job, providerBaseUrl }).catch((err) => {
      logger.error({ err, jobId: job.id }, "Unhandled job error");
    });
  }
}

function validateTargetUrl(targetUrl: string, providerBaseUrl: string | null): void {
  if (!providerBaseUrl) {
    throw new Error(
      "Cannot run single_listing job: provider has no baseUrl configured (required for SSRF guard)",
    );
  }
  let base: URL;
  try {
    base = new URL(providerBaseUrl);
  } catch {
    throw new Error(`Provider baseUrl is not a valid URL: ${providerBaseUrl}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error(`Invalid targetUrl: ${targetUrl}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`targetUrl must use HTTPS (got ${parsed.protocol})`);
  }
  if (!hostnameMatchesProvider(parsed.hostname, base.hostname)) {
    throw new Error(
      `targetUrl hostname (${parsed.hostname}) must match provider host (${base.hostname})`,
    );
  }
}

function hostnameMatchesProvider(targetHost: string, baseHost: string): boolean {
  const t = targetHost.toLowerCase();
  const b = baseHost.toLowerCase();
  if (t === b) return true;
  const registrable = (host: string) => {
    const parts = host.split(".");
    return parts.length >= 2 ? parts.slice(-2).join(".") : host;
  };
  return registrable(t) === registrable(b);
}

async function runJob(job: {
  id: number;
  providerId: number;
  jobType: string;
  jobConfig: string | null;
  targetUrl: string | null;
  providerBaseUrl: string | null;
}): Promise<void> {
  logger.info({ jobId: job.id, providerId: job.providerId, jobType: job.jobType }, "Starting collection job");
  let progress: JobProgress | null = null;
  let crawlState: CrawlState | null = null;

  try {
    const [provider] = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.id, job.providerId));

    if (!provider) {
      throw new Error(`Provider ${job.providerId} not found`);
    }
    if (!provider.enabled) {
      await db
        .update(collectionJobsTable)
        .set({
          status: "cancelled",
          completedAt: new Date(),
          errorMessage: "Provider is disabled",
        })
        .where(eq(collectionJobsTable.id, job.id));
      logger.warn({ jobId: job.id, provider: provider.internalName }, "Skipped job — provider disabled");
      return;
    }

    let filterParams: EncarFilterParams = {};
    if (job.jobConfig) {
      try {
        filterParams = JSON.parse(job.jobConfig);
      } catch {
        logger.warn({ jobId: job.id }, "Failed to parse jobConfig, using defaults");
      }
    }
    filterParams = mergeCrawlDefaults(provider.internalName, filterParams, job.jobType) as EncarFilterParams;

    if ((job.jobType === "incremental" || job.jobType === "listing_refresh") && !filterParams.sort) {
      if (provider.internalName === "autowini") filterParams.sort = "recentDate";
      else if (provider.internalName === "encar" || provider.internalName === "ams") filterParams.sort = "ModifiedDate";
    }

    if (job.jobType === "listing_refresh" && (filterParams as { repeatHours?: number }).repeatHours == null) {
      (filterParams as { repeatHours?: number }).repeatHours = defaultRefreshHours(provider.internalName);
    }
    if ((filterParams as { nextRunAt?: string }).nextRunAt) {
      delete (filterParams as { nextRunAt?: string }).nextRunAt;
    }

    if (job.jobType !== "single_listing" && filterParams.detailLevel == null) {
      filterParams.detailLevel = job.jobType === "listing_refresh" ? "standard" : "full";
    }
    if (job.jobType === "single_listing") {
      filterParams.detailLevel = "full";
    }
    progress = await loadJobProgress(job.id);
    crawlState = await loadCrawlState(job.id, job.jobType, filterParams, provider.internalName);
    const adapterFactory = (shardFilters: EncarFilterParams) =>
      getAdapter(provider.internalName, provider.baseUrl ?? undefined, shardFilters);

    const [globalSettings] = await db
      .select({
        defaultMaxPages: settingsTable.defaultMaxPages,
        defaultMaxListings: settingsTable.defaultMaxListings,
        defaultDelayMs: settingsTable.defaultDelayMs,
      })
      .from(settingsTable)
      .where(eq(settingsTable.id, 1));

    const fullCrawl = job.jobType === "full_collection";
    const refreshKnown = job.jobType === "listing_refresh";
    const maxPages = unbounded(
      filterParams.maxPages ?? (fullCrawl || refreshKnown ? 0 : undefined),
      globalSettings?.defaultMaxPages ?? 200,
    );
    const maxListings = unbounded(
      filterParams.maxListings ?? (fullCrawl || refreshKnown ? 0 : undefined),
      globalSettings?.defaultMaxListings ?? 5000,
    );
    const delayMs = filterParams.delayMs ?? globalSettings?.defaultDelayMs ?? 800;
    const listingConcurrency = Math.min(
      16,
      Math.max(1, filterParams.concurrency ?? DEFAULT_LISTING_CONCURRENCY),
    );

    const skipRecentHours =
      filterParams.skipRecentHours ??
      (job.jobType === "incremental"
        ? INCREMENTAL_SKIP_RECENT_HOURS
        : job.jobType === "listing_refresh"
          ? REFRESH_SKIP_RECENT_HOURS
          : DEFAULT_SKIP_RECENT_HOURS);
    const skipRecentMs = skipRecentHours > 0 ? skipRecentHours * 60 * 60 * 1000 : 0;

    logger.info(
      {
        jobId: job.id,
        listingConcurrency,
        delayMs,
        skipRecentHours,
        maxListings,
        maxPages,
      },
      "Job crawl settings",
    );

    let halt: JobHalt = null;

    if (job.jobType === "single_listing" && job.targetUrl) {
      const adapter = adapterFactory(filterParams);
      if (!adapter) {
        throw new Error(`No adapter registered for provider: ${provider.internalName}`);
      }
      validateTargetUrl(job.targetUrl, job.providerBaseUrl);
      halt = await processSingleListing(adapter, job.providerId, job.id, job.targetUrl, progress);
    } else if (job.jobType === "listing_refresh") {
      halt = await runListingRefresh({
        adapterFactory,
        filterParams,
        crawlState,
        providerId: job.providerId,
        providerName: provider.internalName,
        jobId: job.id,
        maxPages,
        maxListings,
        delayMs,
        listingConcurrency,
        skipRecentMs,
        progress,
      });
    } else {
      halt = await runPaginatedCollection({
        adapterFactory,
        baseFilters: filterParams,
        crawlState,
        providerId: job.providerId,
        jobId: job.id,
        maxPages,
        maxListings,
        delayMs,
        listingConcurrency,
        skipRecentMs,
        incremental: job.jobType === "incremental",
        progress,
      });
    }

    if (halt === "paused" || halt === "cancelled") {
      await db
        .update(collectionJobsTable)
        .set({ ...progressToDbFields(progress), crawlState: serializeCrawlState(crawlState) })
        .where(
          and(
            eq(collectionJobsTable.id, job.id),
            eq(collectionJobsTable.status, halt),
          ),
        );
      logger.info({ jobId: job.id, progress, halt }, `Collection job ${halt}`);
    } else {
      const updated = await db
        .update(collectionJobsTable)
        .set({
          status: "completed",
          completedAt: new Date(),
          crawlState: serializeCrawlState(crawlState),
          ...progressToDbFields(progress),
        })
        .where(
          and(
            eq(collectionJobsTable.id, job.id),
            eq(collectionJobsTable.status, "running"),
          ),
        )
        .returning({ id: collectionJobsTable.id });

      if (updated.length === 0) {
        await db
          .update(collectionJobsTable)
          .set({ completedAt: new Date(), crawlState: serializeCrawlState(crawlState), ...progressToDbFields(progress) })
          .where(eq(collectionJobsTable.id, job.id));
        logger.info({ jobId: job.id }, "Collection job was cancelled just before completion");
      } else {
        const repeatHours = scheduledRepeatHours(job.jobType, filterParams, provider.internalName);
        if (repeatHours > 0) {
          const nextRunAt = new Date(Date.now() + repeatHours * 60 * 60 * 1000).toISOString();
          const nextConfig = { ...filterParams, repeatHours, nextRunAt, lastCompletedAt: new Date().toISOString() };
          await db
            .update(collectionJobsTable)
            .set({
              status: "pending",
              startedAt: null,
              completedAt: new Date(),
              crawlState: serializeCrawlState(buildInitialCrawlState(job.jobType, filterParams, provider.internalName)),
              jobConfig: JSON.stringify(nextConfig),
              errorMessage: null,
              pagesProcessed: 0,
              itemsDiscovered: 0,
              itemsProcessed: 0,
              itemsFailed: 0,
              listingsFetched: 0,
              vinsFound: 0,
              vinsNew: 0,
              newObservations: 0,
              duplicatesSkipped: 0,
            })
            .where(eq(collectionJobsTable.id, job.id));
          logger.info({ jobId: job.id, nextRunAt, repeatHours }, "Status refresh completed — next run scheduled");
        } else {
          logger.info({ jobId: job.id, progress }, "Collection job completed");
          if (job.jobType === "full_collection") {
            await enqueueListingRefreshFollowup(job.providerId, provider.internalName, filterParams);
          }
        }
      }
    }
  } catch (err) {
    progress = progress ?? (await loadJobProgress(job.id).catch(() => null));
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (await isTransientDbError(err)) {
      logger.warn({ err, jobId: job.id }, "Transient DB error during crawl — keeping job running");
      if (progress) {
        await updateJobProgress(job.id, progress, crawlState ?? undefined);
      }
      return;
    }
    logger.error({ err, jobId: job.id }, "Collection job failed");

    const updated = await db
      .update(collectionJobsTable)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage,
        crawlState: crawlState ? serializeCrawlState(crawlState) : null,
        ...progressToDbFields(progress),
      })
      .where(
        and(
          eq(collectionJobsTable.id, job.id),
          eq(collectionJobsTable.status, "running"),
        ),
      )
      .returning({ id: collectionJobsTable.id });

    if (updated.length === 0) {
      await db
        .update(collectionJobsTable)
        .set({ completedAt: new Date(), crawlState: crawlState ? serializeCrawlState(crawlState) : null, ...progressToDbFields(progress) })
        .where(eq(collectionJobsTable.id, job.id));
    }
  }
}

interface PaginatedCollectionOptions {
  adapterFactory: (filters: EncarFilterParams) => ProviderAdapter | null;
  baseFilters: EncarFilterParams;
  crawlState: CrawlState;
  providerId: number;
  jobId: number;
  maxPages: number;
  maxListings: number;
  delayMs: number;
  listingConcurrency: number;
  skipRecentMs: number;
  incremental: boolean;
  preferFullForNew?: boolean;
  progress: JobProgress;
}

async function runPaginatedCollection(options: PaginatedCollectionOptions): Promise<JobHalt> {
  const {
    adapterFactory,
    crawlState,
    providerId,
    jobId,
    maxPages,
    maxListings,
    delayMs,
    listingConcurrency,
    skipRecentMs,
    incremental,
    preferFullForNew,
    progress,
  } = options;

  const progressLock = createProgressLock();
  const seenThisJob = new Set<string>();
  let consecutiveFullSkipPages = 0;

  while (progress.listingsFetched < maxListings) {
    const halt = await getJobHalt(jobId);
    if (halt) {
      logger.info({ jobId, halt }, "Job interrupted mid-collection");
      return halt;
    }

    const shard = pickNextShard(crawlState);
    if (!shard) {
      if (allShardsCompleted(crawlState)) break;
      const waitMs = nextShardWakeMs(crawlState);
      crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
      await updateJobProgress(jobId, progress, crawlState);
      await sleep(Math.max(1_000, Math.min(waitMs ?? 5_000, 30_000)));
      continue;
    }

    crawlState.currentShardId = shard.id;
    shard.status = "active";
    const page = Math.max(1, shard.nextPage);
    if (page > maxPages) {
      shard.status = "completed";
      await updateJobProgress(jobId, progress, crawlState);
      continue;
    }

    // Restore sticky IM catalog size after API restart / job resume.
    const imCountries = (shard.filters as { countries?: string[] }).countries;
    if (
      Array.isArray(imCountries) &&
      imCountries.length === 1 &&
      imCountries[0] &&
      imCountries[0] !== "*rest" &&
      (shard.expectedResultTotal || shard.expectedTotalPages)
    ) {
      seedImportMotorCountryCoverage(imCountries[0], {
        total: shard.expectedResultTotal,
        totalPages: shard.expectedTotalPages,
      });
    }

    const adapter = adapterFactory(shard.filters);
    if (!adapter || !adapter.discoverListings || !adapter.fetchListing || !adapter.parseListing) {
      throw new Error("Adapter does not support discoverListings/fetchListing/parseListing");
    }

    logger.info(
      { jobId, shardId: shard.id, shardLabel: shard.label, page, listingsFetched: progress.listingsFetched },
      "Discovering listings on shard page",
    );

    let listings: ListingReference[];
    let pagination: PaginationInfo;
    try {
      ({ listings, pagination } = await discoverListingsWithRetry(adapter, page, jobId));
    } catch (err) {
      if (err instanceof JobInterrupted) return err.halt;
      const error = err instanceof Error ? err : new Error(String(err));
      shard.status = "cooldown";
      shard.discoverFailures += 1;
      shard.lastError = error.message;
      shard.cooldownUntil = new Date(Date.now() + computeCooldownMs(error)).toISOString();
      crawlState.lastBlock = {
        at: new Date().toISOString(),
        category: error instanceof EncarRequestError ? error.info.category : "upstream",
        message: error.message,
      };
      crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
      logger.warn(
        { err: error, jobId, shardId: shard.id, page, cooldownUntil: shard.cooldownUntil },
        "Discover page failed after retries — cooling shard and moving on",
      );
      await updateJobProgress(jobId, progress, crawlState);
      continue;
    }
    await progressLock.mutate(() => {
      progress.itemsDiscovered += listings.length;
    });
    shard.itemsDiscovered += listings.length;
    shard.discoverFailures = 0;
    shard.lastError = null;
    shard.cooldownUntil = null;

    const pageSize = listings.length || 50;
    // Incremental / status-refresh discover is newest-first until overlap.
    // Year-splitting that window would recrawl the catalog and miss the point.
    if (!incremental && shouldSplitCappedEncarShard(adapter.internalName, shard, pagination, pageSize)) {
      const extras = splitCappedEncarShard(shard);
      if (extras.length > 0) {
        logger.info(
          {
            jobId,
            shardId: shard.id,
            extraShards: extras.length,
            totalPages: pagination.totalPages,
            estimatedTotal: estimatedSearchTotal(pagination, pageSize),
          },
          "Splitting Encar shard — search window would hide remaining cars",
        );
        crawlState.shards.push(...extras);
        shard.status = "completed";
        shard.lastError = "split: Encar search result window";
        await updateJobProgress(jobId, progress, crawlState);
        continue;
      }
    }

    if (
      listings.length > 0 &&
      listings.every((ref) => seenThisJob.has(ref.sourceId))
    ) {
      // Import Motor country catalogs are multi-page — a transient repeat of the same
      // list HTML must not abort the remaining pages (we'd miss thousands of VINs).
      if (adapter.internalName === "import_motor" && pagination.hasMore) {
        logger.warn(
          {
            jobId,
            shardId: shard.id,
            page,
            listings: listings.length,
            totalPages: pagination.totalPages,
          },
          "Import Motor discover page looked duplicated — advancing to next list page anyway",
        );
        await progressLock.mutate(() => {
          progress.pagesProcessed++;
        });
        shard.pagesProcessed++;
        shard.nextPage++;
        shard.status = "pending";
        crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
        await updateJobProgress(jobId, progress, crawlState);
        await sleep(Math.max(300, delayMs));
        continue;
      }
      logger.info(
        { jobId, shardId: shard.id, page, listings: listings.length },
        "Discover page repeated listings already seen this job — ending shard",
      );
      shard.status = "completed";
      shard.lastError = "pagination: duplicate page";
      crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
      await updateJobProgress(jobId, progress, crawlState);
      continue;
    }

    const sourceIds = listings.map((ref) => ref.sourceId);
    const recentlySeen = await findRecentlySeenSourceIds(providerId, sourceIds, skipRecentMs, {
      requireFullDetail: shard.filters.detailLevel !== "standard",
    });

    const imAdapter =
      adapter.internalName === "import_motor" && adapter instanceof ImportMotorHistoricalAdapter
        ? adapter
        : null;
    const alreadyFromIm =
      imAdapter != null
        ? await findAlreadyCrawledImportMotorVins(
            listings.map((ref) => String(ref.sourceId ?? "").toUpperCase()),
          )
        : null;

    const toFetch: ListingReference[] = [];
    let pageSkipped = 0;

    for (const ref of listings) {
      if (seenThisJob.has(ref.sourceId)) {
        pageSkipped++;
        continue;
      }

      if (recentlySeen.has(ref.sourceId)) {
        seenThisJob.add(ref.sourceId);
        pageSkipped++;
        continue;
      }

      const vinKey = String(ref.sourceId ?? "").toUpperCase();
      if (alreadyFromIm?.has(vinKey)) {
        seenThisJob.add(ref.sourceId);
        pageSkipped++;
        continue;
      }

      // Prefer-Korean list skip: only when the card clearly shows a non-matching origin.
      // Unknown platform → fetch; once opened we always persist (see fetchAndPersistListing).
      const originHint =
        ref.metadata && typeof ref.metadata === "object"
          ? String((ref.metadata as { originHint?: string }).originHint ?? "")
          : "";
      if (
        imAdapter?.preferOriginsOnly &&
        originHint &&
        !imAdapter.allowsOrigin(originHint)
      ) {
        seenThisJob.add(ref.sourceId);
        pageSkipped++;
        continue;
      }

      toFetch.push(ref);
    }

    if (pageSkipped > 0) {
      await progressLock.mutate(() => {
        progress.listingsSkipped += pageSkipped;
      });
      logger.debug({ jobId, shardId: shard.id, page, pageSkipped, toFetch: toFetch.length }, "Skipped recently seen listings");
    }

    if (incremental && listings.length > 0 && toFetch.length === 0) {
      consecutiveFullSkipPages++;
      if (consecutiveFullSkipPages >= INCREMENTAL_FULL_SKIP_PAGE_LIMIT) {
        logger.info(
          { jobId, page, consecutiveFullSkipPages },
          "Incremental job stopping — consecutive pages were all recently seen",
        );
        shard.status = "completed";
        crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
        await updateJobProgress(jobId, progress, crawlState);
        break;
      }
    } else {
      consecutiveFullSkipPages = 0;
    }

    crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
    await updateJobProgress(jobId, progress, crawlState);

    const knownIds = preferFullForNew
      ? await findKnownSourceIds(providerId, toFetch.map((ref) => ref.sourceId))
      : null;

    let listingBlock: Error | null = null;
    await runWithConcurrency(toFetch, listingConcurrency, async (ref) => {
      if (listingBlock) return;
      if (progress.listingsFetched >= maxListings) return;
      if (await getJobHalt(jobId)) return;

      const listingAdapter =
        preferFullForNew && knownIds && !knownIds.has(ref.sourceId)
          ? adapterFactory({ ...shard.filters, detailLevel: "full" }) ?? adapter
          : adapter;

      try {
        await fetchAndPersistListing({
          adapter: listingAdapter,
          providerId,
          jobId,
          ref,
          progress,
          progressLock,
        });
        seenThisJob.add(ref.sourceId);
        shard.listingsFetched += 1;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (error instanceof KbRequestError && error.statusCode === 429) {
          listingBlock = error;
          logger.warn({ err: error, url: ref.url, jobId }, "KB ChaChaCha bot-check — cooling shard");
          return;
        }
        logger.warn({ err: error, url: ref.url, jobId }, "Failed to process listing");
        await progressLock.mutate(() => {
          progress.itemsFailed++;
        });
      }

      if (progress.listingsFetched % 10 === 0) {
        crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
        await updateJobProgress(jobId, progress, crawlState);
      }
    });

    if (listingBlock) {
      shard.status = "cooldown";
      shard.lastError = listingBlock.message;
      shard.cooldownUntil = new Date(Date.now() + computeCooldownMs(listingBlock)).toISOString();
      crawlState.lastBlock = {
        at: new Date().toISOString(),
        category: "rate_limit",
        message: listingBlock.message,
      };
      await updateJobProgress(jobId, progress, crawlState);
      continue;
    }

    const afterPage = await getJobHalt(jobId);
    if (afterPage) {
      crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
      await updateJobProgress(jobId, progress, crawlState);
      return afterPage;
    }

    await progressLock.mutate(() => {
      progress.pagesProcessed++;
    });
    shard.pagesProcessed++;
    shard.nextPage++;

    // Persist Import Motor catalog size; never end a country before sticky total/pages.
    if (adapter.internalName === "import_motor") {
      if (pagination.resultTotal != null && pagination.resultTotal > 0) {
        shard.expectedResultTotal = Math.max(shard.expectedResultTotal ?? 0, pagination.resultTotal);
      }
      if (pagination.totalPages != null && pagination.totalPages > 0) {
        shard.expectedTotalPages = Math.max(shard.expectedTotalPages ?? 0, pagination.totalPages);
      }
      const cc = Array.isArray(imCountries) && imCountries.length === 1 ? imCountries[0] : undefined;
      if (cc && cc !== "*rest") {
        seedImportMotorCountryCoverage(cc, {
          total: shard.expectedResultTotal,
          totalPages: shard.expectedTotalPages,
        });
      }

      let hasMore = pagination.hasMore;
      if (shard.expectedTotalPages != null && page < shard.expectedTotalPages) {
        hasMore = true;
      }
      // Empty page mid-catalog: stay on this page index for retry (we already incremented — roll back).
      if (listings.length === 0 && hasMore) {
        shard.nextPage = page;
        shard.pagesProcessed = Math.max(0, shard.pagesProcessed - 1);
        await progressLock.mutate(() => {
          progress.pagesProcessed = Math.max(0, progress.pagesProcessed - 1);
        });
        shard.status = "cooldown";
        shard.lastError = `empty list page ${page} while catalog incomplete`;
        shard.cooldownUntil = new Date(Date.now() + 5_000).toISOString();
        crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
        await updateJobProgress(jobId, progress, crawlState);
        continue;
      }

      shard.status = hasMore ? "pending" : "completed";
      if (!hasMore && shard.expectedTotalPages != null && page < shard.expectedTotalPages) {
        shard.status = "pending";
        shard.lastError = null;
      }
    } else {
      shard.status = pagination.hasMore ? "pending" : "completed";
    }

    crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
    await updateJobProgress(jobId, progress, crawlState);

    if (
      (adapter.internalName === "import_motor"
        ? shard.status === "pending"
        : pagination.hasMore) &&
      shard.nextPage <= maxPages &&
      progress.listingsFetched < maxListings
    ) {
      await sleep(Math.max(300, delayMs));
    }
  }

  return null;
}

async function discoverListingsWithRetry(
  adapter: ProviderAdapter,
  page: number,
  jobId: number,
): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
  if (!adapter.discoverListings) {
    throw new Error("Adapter does not support discoverListings");
  }

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= DISCOVER_PAGE_RETRIES; attempt++) {
    const halt = await getJobHalt(jobId);
    if (halt) throw new JobInterrupted(halt);
    try {
      return await adapter.discoverListings(page);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= DISCOVER_PAGE_RETRIES) break;
      const waitMs = Math.min(30_000, 1000 * Math.pow(2, attempt - 1));
      logger.warn(
        { err: lastError, jobId, page, attempt, waitMs },
        "Discover page failed, retrying",
      );
      await sleep(waitMs);
    }
  }

  throw lastError ?? new Error(`Failed to discover listings on page ${page}`);
}

async function fetchAndPersistListing(ctx: {
  adapter: ProviderAdapter;
  providerId: number;
  jobId: number;
  ref: ListingReference;
  progress: JobProgress;
  progressLock: ReturnType<typeof createProgressLock>;
}): Promise<void> {
  const { adapter, providerId, jobId, ref, progress, progressLock } = ctx;
  const parserVersion = PARSER_VERSIONS[adapter.internalName] ?? PARSER_VERSION;

  const fetched = await adapter.fetchListing!(ref.url);
  if (ref.metadata) fetched.metadata = ref.metadata;

  await progressLock.mutate(() => {
    progress.listingsFetched++;
  });

  const listing = await adapter.parseListing!(fetched);

  // Prefer-Korean mode only skips at list-card level. If we already opened this detail
  // page, always persist (US/CA/Korean) — cheap compared to the CDP fetch we paid for.

  // Korean IM lots must keep full history/registry; never treat as "light" skip.
  if (
    adapter.internalName === "import_motor" &&
    isKoreanImportMotorOrigin(listing.targetProvider) &&
    (!listing.events || listing.events.length === 0)
  ) {
    logger.warn(
      { jobId, sourceId: listing.sourceId, url: ref.url },
      "Korean Import Motor detail parsed with 0 events — still persisting listing/vehicle",
    );
  }

  const persistProviderId =
    adapter.internalName === "import_motor"
      ? await resolveImportMotorPersistProviderId(listing, providerId)
      : await resolvePersistProviderId(listing.targetProvider, providerId);
  const vehicle = adapter.normalizeVehicle ? await adapter.normalizeVehicle(listing) : listing.vehicle ?? {};
  let vin = adapter.extractVIN?.(listing) ?? listing.vehicle?.vin ?? vehicle.vin;
  if (!vin && listing.sourceId) {
    const [known] = await db
      .select({ vin: listingsTable.vin })
      .from(listingsTable)
      .where(and(eq(listingsTable.providerId, persistProviderId), eq(listingsTable.sourceId, listing.sourceId)))
      .limit(1);
    vin = known?.vin ?? undefined;
  }
  const photos = adapter.extractPhotos?.(listing)?.length
    ? adapter.extractPhotos!(listing)
    : (listing.photos ?? []);

  const result = await processFetchedListing({
    providerId: persistProviderId,
    jobId,
    fetched,
    listing,
    vehicle,
    vin,
    photos,
    parserVersion,
  });

  await progressLock.mutate(() => {
    if (result.skippedNoVin) {
      progress.listingsSkipped++;
      logger.debug({ sourceId: listing.sourceId, jobId }, "Listing skipped — no VIN");
      return;
    }
    if (result.skippedNoMileage) {
      progress.listingsSkipped++;
      logger.debug(
        { sourceId: listing.sourceId, jobId, vin },
        "Listing skipped — no mileage (VIN history requires odometer)",
      );
      return;
    }
    if (result.skippedNoIdentity) {
      progress.listingsSkipped++;
      logger.debug(
        { sourceId: listing.sourceId, jobId, vin, title: listing.title },
        "Listing skipped — unknown vehicle (VIN history requires make/model)",
      );
      return;
    }

    // Count VIN only when we actually persist history (VIN + mileage + identity).
    if (result.vinFound) progress.vinsFound++;
    if (result.isNewVehicle) progress.vinsNew++;
    if (result.isNewObservation) progress.newObservations++;
    if (result.isDuplicate) progress.duplicatesSkipped++;
    progress.itemsProcessed++;
  });
}

function isListingGoneError(err: Error): boolean {
  const status = (err as { statusCode?: number }).statusCode;
  if (status === 404 || status === 410) return true;
  if (err instanceof KrRequestError && (err.statusCode === 404 || err.statusCode === 410)) return true;
  const msg = err.message.toLowerCase();
  return msg.includes("not found") || /\b404\b/.test(msg);
}

function listingFetchUrl(
  providerName: string,
  row: { sourceId: string; sourceUrl: string | null },
): string {
  if (row.sourceUrl) return row.sourceUrl;
  if (providerName === "encar") return `${DETAIL_WEB_BASE}/cars/detail/${row.sourceId}`;
  if (providerName === "autowini") return `${AUTWINI_WEB_BASE}/items/${row.sourceId}`;
  if (providerName === "kbchachacha") return kbDetailUrl(row.sourceId);
  if (providerName === "mango") return mangoDetailUrl(row.sourceId);
  if (providerName === "seobuk") return seobukDetailUrl(row.sourceId);
  if (providerName === "ssancar") return ssancarDetailUrl(row.sourceId);
  if (providerName === "koreaauto_auction") return koreaautoAuctionDetailUrl(row.sourceId);
  if (providerName === "carpoolkr") return carpoolDetailUrl(row.sourceId);
  if (providerName === "lotte_autoglobal") return lotteDetailUrl(row.sourceId);
  if (providerName === "kolon_auto") return kolonDetailUrl(row.sourceId);
  if (providerName === "auctionauto") return auctionautoDetailUrl(row.sourceId);
  if (providerName === "koreausedcars") return koreaUsedCarsDetailUrl(row.sourceId);
  if (providerName === "auctionwini") return auctionwiniDetailUrl(row.sourceId);
  if (providerName === "heydealer") return heydealerDetailUrl(row.sourceId);
  if (providerName === "bobaedream") return bobaedreamDetailUrl(row.sourceId);
  if (providerName === "bobaedreamcyber") return bobaedreamCyberDetailUrl(row.sourceId);
  if (providerName === "salvagebid") return salvagebidDetailUrl(row.sourceId);
  if (providerName === "bringatrailer") return batDetailUrl(row.sourceId);
  if (providerName === "iaa") return iaaDetailUrl(row.sourceId);
  if (providerName === "autoscout24") return autoscout24DetailUrl(row.sourceId);
  if (providerName === "autotraderca") return autotradercaDetailUrl(row.sourceId);
  if (providerName === "dubicars") return dubicarsDetailUrl(row.sourceId);
  if (providerName === "otomoto") return otomotoDetailUrl(row.sourceId);
  if (providerName === "kcar") return kcarDetailUrl(row.sourceId);
  if (providerName === "cars24ae") return cars24aeDetailUrl(row.sourceId);
  if (providerName === "willhaben") return willhabenDetailUrl(row.sourceId);
  if (providerName === "carpages") return carpagesDetailUrl(row.sourceId);
  if (providerName === "autobell") return autobellDetailUrl(row.sourceId);
  if (providerName === "copart") {
    const vin = row.sourceId.match(/[A-HJ-NPR-Z0-9]{17}/i)?.[0];
    return vin ? `${BIDSCAN_WEB_BASE}/cars/${vin.toUpperCase()}` : row.sourceId;
  }
  return row.sourceId;
}

async function runListingRefresh(opts: {
  adapterFactory: (filters: EncarFilterParams) => ProviderAdapter | null;
  filterParams: EncarFilterParams;
  crawlState: CrawlState;
  providerId: number;
  providerName: string;
  jobId: number;
  maxPages: number;
  maxListings: number;
  delayMs: number;
  listingConcurrency: number;
  skipRecentMs: number;
  progress: JobProgress;
}): Promise<JobHalt> {
  const {
    adapterFactory,
    filterParams,
    crawlState,
    providerId,
    providerName,
    jobId,
    maxPages,
    maxListings,
    delayMs,
    listingConcurrency,
    skipRecentMs,
    progress,
  } = opts;

  crawlState.strategy = "listing_refresh";

  if (crawlState.refreshPhase !== "stale") {
    crawlState.refreshPhase = "discover";
    const parked = crawlState.shards.filter((item) => item.id !== "discover");
    crawlState.shards = crawlState.shards.filter((item) => item.id === "discover");
    if (crawlState.shards.length === 0) {
      crawlState.shards = [makeShard("discover", "New & updated", filterParams)];
    }
    logger.info({ jobId, listingsFetched: progress.listingsFetched }, "Status refresh phase 1 — new and updated search hits");
    const discoverHalt = await runPaginatedCollection({
      adapterFactory,
      baseFilters: filterParams,
      crawlState,
      providerId,
      jobId,
      maxPages,
      maxListings,
      delayMs,
      listingConcurrency,
      skipRecentMs,
      incremental: true,
      preferFullForNew: true,
      progress,
    });
    crawlState.shards = [
      ...crawlState.shards.filter((item) => item.id === "discover"),
      ...parked.filter((item) => item.id !== "discover"),
    ];
    if (discoverHalt) return discoverHalt;

    for (const item of crawlState.shards) {
      if (item.id === "discover") item.status = "completed";
    }
    crawlState.refreshPhase = "stale";
    crawlState.refreshAfterId = crawlState.refreshAfterId ?? 0;
    crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
    await updateJobProgress(jobId, progress, crawlState);
    logger.info({ jobId, listingsFetched: progress.listingsFetched }, "Status refresh phase 2 — stale known listings (sold/removed)");
  }

  if (progress.listingsFetched >= maxListings) {
    return getJobHalt(jobId);
  }

  const adapter = adapterFactory({ ...filterParams, detailLevel: filterParams.detailLevel ?? "standard" });
  if (!adapter?.fetchListing || !adapter.parseListing) {
    throw new Error("Adapter does not support fetchListing/parseListing");
  }

  let shard = crawlState.shards.find((item) => item.id === "stale" || item.id === "known");
  if (!shard) {
    shard = makeShard("stale", "Sold & stale", filterParams);
    crawlState.shards.push(shard);
  }
  crawlState.currentShardId = shard.id;
  shard.status = "active";
  const progressLock = createProgressLock();
  const cutoff = skipRecentMs > 0 ? new Date(Date.now() - skipRecentMs) : null;

  while (progress.listingsFetched < maxListings) {
    const halt = await getJobHalt(jobId);
    if (halt) {
      shard.status = "pending";
      crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
      await updateJobProgress(jobId, progress, crawlState);
      return halt;
    }

    const afterId = crawlState.refreshAfterId ?? 0;
    const conditions = [
      eq(listingsTable.providerId, providerId),
      eq(listingsTable.isActive, true),
      gt(listingsTable.id, afterId),
    ];
    if (cutoff) conditions.push(lt(listingsTable.lastSeenAt, cutoff));

    const batch = await db
      .select({
        id: listingsTable.id,
        sourceId: listingsTable.sourceId,
        sourceUrl: listingsTable.sourceUrl,
      })
      .from(listingsTable)
      .where(and(...conditions))
      .orderBy(asc(listingsTable.id))
      .limit(Math.min(REFRESH_BATCH_SIZE, maxListings - progress.listingsFetched));

    await progressLock.mutate(() => {
      progress.itemsDiscovered += batch.length;
    });
    shard.itemsDiscovered += batch.length;

    if (batch.length === 0) {
      shard.status = "completed";
      crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
      await updateJobProgress(jobId, progress, crawlState);
      break;
    }

    let listingBlock: Error | null = null;
    await runWithConcurrency(batch, listingConcurrency, async (row) => {
      if (listingBlock) return;
      if (progress.listingsFetched >= maxListings) return;
      if (await getJobHalt(jobId)) return;

      const ref = {
        sourceId: row.sourceId,
        url: listingFetchUrl(providerName, row),
      };

      try {
        await fetchAndPersistListing({
          adapter,
          providerId,
          jobId,
          ref,
          progress,
          progressLock,
        });
        shard.listingsFetched += 1;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (error instanceof KbRequestError && error.statusCode === 429) {
          listingBlock = error;
          logger.warn({ err: error, url: ref.url, jobId }, "KB ChaChaCha bot-check — cooling refresh");
          return;
        }
        if (error instanceof EncarRequestError && (error.info.category === "rate_limit" || error.info.category === "hard_block")) {
          listingBlock = error;
          logger.warn({ err: error, url: ref.url, jobId }, "Encar block — cooling refresh");
          return;
        }
        if (isListingGoneError(error)) {
          const gone = await markListingGone(providerId, row.sourceId);
          await progressLock.mutate(() => {
            progress.itemsProcessed++;
            if (gone.observation) progress.newObservations++;
          });
          shard.listingsFetched += 1;
          logger.info({ sourceId: row.sourceId, jobId }, "Listing gone — marked inactive");
          return;
        }
        logger.warn({ err: error, url: ref.url, jobId }, "Failed to refresh listing");
        await progressLock.mutate(() => {
          progress.itemsFailed++;
        });
      }
    });

    if (!listingBlock) {
      crawlState.refreshAfterId = batch[batch.length - 1]!.id;
    }
    shard.pagesProcessed += 1;
    shard.nextPage = shard.pagesProcessed + 1;
    await progressLock.mutate(() => {
      progress.pagesProcessed++;
    });

    if (listingBlock) {
      shard.status = "cooldown";
      shard.lastError = listingBlock.message;
      shard.cooldownUntil = new Date(Date.now() + computeCooldownMs(listingBlock)).toISOString();
      crawlState.lastBlock = {
        at: new Date().toISOString(),
        category: "rate_limit",
        message: listingBlock.message,
      };
      crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
      await updateJobProgress(jobId, progress, crawlState);
      const waitMs = nextShardWakeMs(crawlState) ?? 20_000;
      await sleep(Math.min(waitMs, 60_000));
      continue;
    }

    crawlState.lastHealthSnapshot = getEncarHealthSnapshot();
    await updateJobProgress(jobId, progress, crawlState);
    await sleep(Math.max(200, delayMs));
  }

  if (shard.status === "active" && progress.listingsFetched >= maxListings) {
    shard.status = "pending";
    await updateJobProgress(jobId, progress, crawlState);
  }

  return getJobHalt(jobId);
}

async function processSingleListing(
  adapter: ProviderAdapter,
  providerId: number,
  jobId: number,
  url: string,
  progress: JobProgress,
): Promise<JobHalt> {
  if (!adapter.fetchListing || !adapter.parseListing) {
    throw new Error("Adapter does not support fetchListing/parseListing");
  }

  const halt = await getJobHalt(jobId);
  if (halt) return halt;

  const progressLock = createProgressLock();
  await fetchAndPersistListing({
    adapter,
    providerId,
    jobId,
    ref: { sourceId: url, url },
    progress,
    progressLock,
  });

  progress.pagesProcessed = Math.max(progress.pagesProcessed, 1);
  progress.itemsDiscovered = Math.max(progress.itemsDiscovered, 1);

  return getJobHalt(jobId);
}

type JobHalt = "cancelled" | "paused" | null;

class JobInterrupted extends Error {
  constructor(public halt: Exclude<JobHalt, null>) {
    super(`Job ${halt}`);
    this.name = "JobInterrupted";
  }
}

async function loadJobProgress(jobId: number): Promise<JobProgress> {
  const [row] = await db
    .select({
      pagesProcessed: collectionJobsTable.pagesProcessed,
      itemsDiscovered: collectionJobsTable.itemsDiscovered,
      itemsProcessed: collectionJobsTable.itemsProcessed,
      itemsFailed: collectionJobsTable.itemsFailed,
      listingsFetched: collectionJobsTable.listingsFetched,
      vinsFound: collectionJobsTable.vinsFound,
      vinsNew: collectionJobsTable.vinsNew,
      newObservations: collectionJobsTable.newObservations,
      duplicatesSkipped: collectionJobsTable.duplicatesSkipped,
    })
    .from(collectionJobsTable)
    .where(eq(collectionJobsTable.id, jobId));

  return {
    pagesProcessed: row?.pagesProcessed ?? 0,
    itemsDiscovered: row?.itemsDiscovered ?? 0,
    itemsProcessed: row?.itemsProcessed ?? 0,
    itemsFailed: row?.itemsFailed ?? 0,
    listingsFetched: row?.listingsFetched ?? 0,
    listingsSkipped: 0,
    vinsFound: row?.vinsFound ?? 0,
    vinsNew: row?.vinsNew ?? 0,
    newObservations: row?.newObservations ?? 0,
    duplicatesSkipped: row?.duplicatesSkipped ?? 0,
  };
}

async function loadCrawlState(
  jobId: number,
  jobType: string,
  filterParams: EncarFilterParams,
  providerName = "encar",
): Promise<CrawlState> {
  const [row] = await db
    .select({ crawlState: collectionJobsTable.crawlState })
    .from(collectionJobsTable)
    .where(eq(collectionJobsTable.id, jobId));
  return parseCrawlState(row?.crawlState ?? null, jobType, filterParams, providerName);
}

function isTransientDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Failed query|timeout|timed out|ECONNRESET|ECONNREFUSED|connection terminated|too many clients|Connection terminated|socket hang up/i.test(
    msg,
  );
}

async function withDbRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (attempt < retries - 1 && isTransientDbError(err)) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw last;
}

async function getJobHalt(jobId: number): Promise<JobHalt> {
  try {
    const [check] = await withDbRetry(() =>
      db
        .select({ status: collectionJobsTable.status })
        .from(collectionJobsTable)
        .where(eq(collectionJobsTable.id, jobId)),
    );
    if (check?.status === "cancelled" || check?.status === "paused") return check.status;
    return null;
  } catch (err) {
    logger.warn({ err, jobId }, "getJobHalt DB check failed — assuming still running");
    return null;
  }
}

async function updateJobProgress(jobId: number, progress: JobProgress, crawlState?: CrawlState): Promise<void> {
  try {
    const halt = await getJobHalt(jobId);
    if (halt) return;
    await withDbRetry(() =>
      db
        .update(collectionJobsTable)
        .set({
          ...progressToDbFields(progress),
          ...(crawlState ? { crawlState: serializeCrawlState(crawlState) } : {}),
        })
        .where(eq(collectionJobsTable.id, jobId)),
    );
  } catch (err) {
    logger.warn({ err, jobId }, "Progress write skipped (transient DB)");
  }
}

function progressToDbFields(progress: JobProgress) {
  return {
    itemsDiscovered: progress.itemsDiscovered,
    itemsProcessed: progress.itemsProcessed,
    itemsFailed: progress.itemsFailed,
    pagesProcessed: progress.pagesProcessed,
    listingsFetched: progress.listingsFetched,
    vinsFound: progress.vinsFound,
    vinsNew: progress.vinsNew,
    newObservations: progress.newObservations,
    duplicatesSkipped: progress.duplicatesSkipped + progress.listingsSkipped,
  };
}

function getAdapter(
  internalName: string,
  baseUrl?: string,
  filterParams?: EncarFilterParams,
): ProviderAdapter | null {
  const extra = filterParams as unknown as Record<string, unknown> | undefined;
  if (internalName === "encar" || internalName === "ams") {
    return new EncarHistoricalAdapter(baseUrl ?? DETAIL_WEB_BASE, filterParams);
  }
  if (internalName === "autowini") {
    return new AutowiniHistoricalAdapter(baseUrl ?? "https://www.autowini.com", filterParams);
  }
  if (internalName === "kbchachacha") {
    return new KbchachachaHistoricalAdapter(baseUrl ?? "https://www.kbchachacha.com", filterParams);
  }
  if (internalName === "mango") return new MangoHistoricalAdapter(baseUrl, filterParams);
  if (internalName === "seobuk") return new SeobukHistoricalAdapter(baseUrl, filterParams);
  if (internalName === "ssancar") return new SsancarHistoricalAdapter(baseUrl, filterParams);
  if (internalName === "koreaauto_auction") {
    return new KoreaautoAuctionHistoricalAdapter(baseUrl, filterParams);
  }
  if (internalName === "carpoolkr") return new CarpoolkrHistoricalAdapter(baseUrl, filterParams);
  if (internalName === "lotte_autoglobal") return new LotteAutoglobalHistoricalAdapter(baseUrl, filterParams);
  if (internalName === "kolon_auto") return new KolonAutoHistoricalAdapter(baseUrl, filterParams);
  if (internalName === "auctionauto") return new AuctionautoHistoricalAdapter(baseUrl, filterParams);
  if (internalName === "koreausedcars") return new KoreaUsedCarsHistoricalAdapter(baseUrl, filterParams);
  if (internalName === "auctionwini") return new AuctionwiniHistoricalAdapter(baseUrl, filterParams);
  if (internalName === "heydealer") return new HeydealerHistoricalAdapter(baseUrl, filterParams);
  if (internalName === "bobaedream") return new BobaedreamHistoricalAdapter(baseUrl, filterParams);
  if (internalName === "bobaedreamcyber") return new BobaedreamCyberHistoricalAdapter(baseUrl, filterParams);
  if (internalName === "salvagebid") return new SalvagebidHistoricalAdapter(baseUrl, extra);
  if (internalName === "bringatrailer") return new BatHistoricalAdapter(baseUrl, extra);
  if (internalName === "iaa") return new IaaHistoricalAdapter(baseUrl, extra);
  if (internalName === "autoscout24") return new Autoscout24HistoricalAdapter(baseUrl, extra);
  if (internalName === "autotraderca") return new AutotradercaHistoricalAdapter(baseUrl, extra);
  if (internalName === "dubicars") return new DubicarsHistoricalAdapter(baseUrl, extra);
  if (internalName === "otomoto") return new OtomotoHistoricalAdapter(baseUrl, extra);
  if (internalName === "kcar") return new KcarHistoricalAdapter(baseUrl, extra);
  if (internalName === "cars24ae") return new Cars24aeHistoricalAdapter(baseUrl, extra);
  if (internalName === "willhaben") return new WillhabenHistoricalAdapter(baseUrl, extra);
  if (internalName === "carpages") return new CarpagesHistoricalAdapter(baseUrl, extra);
  if (internalName === "autobell") return new AutobellHistoricalAdapter(baseUrl, extra);
  if (internalName === "import_motor") {
    return new ImportMotorHistoricalAdapter(baseUrl ?? IMPORT_MOTOR_WEB_BASE, extra);
  }
  if (internalName === "copart") {
    return new BidscanHistoricalAdapter(baseUrl ?? BIDSCAN_WEB_BASE, extra);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
