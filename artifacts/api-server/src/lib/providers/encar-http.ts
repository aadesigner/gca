/**
 * Shared Encar HTTP runtime. All api.encar.com traffic goes through this so the
 * crawler can classify failures, rotate request fingerprints, and adapt pacing
 * when Encar starts pushing back.
 */

import { HttpsProxyAgent } from "https-proxy-agent";

export type EncarEndpointKind =
  | "search"
  | "detail"
  | "detail_view"
  | "detail_record"
  | "detail_inspection"
  | "detail_diagnosis"
  | "detail_other";

export type EncarFailureCategory =
  | "hard_block"
  | "rate_limit"
  | "transport"
  | "timeout"
  | "malformed"
  | "upstream";

export interface EncarRequestFingerprint {
  id: string;
  userAgent: string;
  acceptLanguage: string;
  refererBase: string;
}

export interface EncarFailureInfo {
  category: EncarFailureCategory;
  endpoint: EncarEndpointKind;
  url: string;
  message: string;
  statusCode?: number;
  retryAfterMs?: number;
  fingerprintId?: string;
  causeCode?: string;
}

export class EncarRequestError extends Error {
  constructor(public info: EncarFailureInfo, options?: { cause?: unknown }) {
    super(info.message, options);
    this.name = "EncarRequestError";
  }
}

interface EncarEndpointHealth {
  endpoint: EncarEndpointKind;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalFailures: number;
  totalSuccesses: number;
  cooldownUntil: number;
  currentMinGapMs: number;
  currentMaxConcurrent: number;
  lastFailureCategory: EncarFailureCategory | null;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
}

export interface EncarHealthSnapshot {
  endpoints: Record<EncarEndpointKind, EncarEndpointHealth>;
  blockedFingerprints: Array<{
    fingerprintId: string;
    blockedUntil: number;
    reason: EncarFailureCategory;
  }>;
}

const MOBILE_FINGERPRINTS: EncarRequestFingerprint[] = [
  {
    id: "ios17-safari-ko",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    acceptLanguage: "ko-KR,ko;q=0.9,en-US;q=0.8",
    refererBase: "https://www.encar.com/",
  },
  {
    id: "android14-pixel-ko",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    acceptLanguage: "ko-KR,ko;q=0.95,en-US;q=0.8",
    refererBase: "https://m.encar.com/",
  },
  {
    id: "android13-samsung-ko",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    acceptLanguage: "ko-KR,ko;q=0.9,en;q=0.7",
    refererBase: "https://m.encar.com/",
  },
  {
    id: "ios16-safari-en",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    acceptLanguage: "en-US,en;q=0.9,ko-KR;q=0.6",
    refererBase: "https://www.encar.com/",
  },
];

const ENDPOINTS: EncarEndpointKind[] = [
  "search",
  "detail",
  "detail_view",
  "detail_record",
  "detail_inspection",
  "detail_diagnosis",
  "detail_other",
];

let configuredMaxConcurrent = 4;
let configuredMinGapMs = 150;
let inFlight = 0;
let liveInFlight = 0;
let lastRequestAt = 0;
const waitQueue: Array<() => void> = [];
const liveWaitQueue: Array<() => void> = [];
const LIVE_MAX_CONCURRENT = 3;
let proxyAgent: HttpsProxyAgent<string> | undefined;
let fingerprintCursor = 0;

const blockedFingerprints = new Map<
  string,
  { blockedUntil: number; reason: EncarFailureCategory }
>();

const endpointHealth = Object.fromEntries(
  ENDPOINTS.map((endpoint) => [
    endpoint,
    {
      endpoint,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      cooldownUntil: 0,
      currentMinGapMs: configuredMinGapMs,
      currentMaxConcurrent: configuredMaxConcurrent,
      lastFailureCategory: null,
      lastFailureAt: null,
      lastSuccessAt: null,
    } satisfies EncarEndpointHealth,
  ]),
) as Record<EncarEndpointKind, EncarEndpointHealth>;

function now(): number {
  return Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProxyAgent(): HttpsProxyAgent<string> | undefined {
  const url = process.env.ENCAR_PROXY;
  if (!url) return undefined;
  if (!proxyAgent) {
    proxyAgent = new HttpsProxyAgent(url);
    console.log(`[encar-http] Using proxy: ${url.replace(/:\/\/.*@/, "://***@")}`);
  }
  return proxyAgent;
}

function cleanupBlockedFingerprints(ts = now()): void {
  for (const [id, entry] of blockedFingerprints.entries()) {
    if (entry.blockedUntil <= ts) blockedFingerprints.delete(id);
  }
}

function getEndpointHealth(endpoint: EncarEndpointKind): EncarEndpointHealth {
  return endpointHealth[endpoint];
}

function applyFailurePenalty(
  endpoint: EncarEndpointKind,
  category: EncarFailureCategory,
  retryAfterMs?: number,
): void {
  const health = getEndpointHealth(endpoint);
  const ts = now();
  health.consecutiveFailures += 1;
  health.consecutiveSuccesses = 0;
  health.totalFailures += 1;
  health.lastFailureCategory = category;
  health.lastFailureAt = ts;

  if (category === "hard_block") {
    health.cooldownUntil = Math.max(health.cooldownUntil, ts + (retryAfterMs ?? 60_000));
    health.currentMinGapMs = Math.min(20_000, Math.max(configuredMinGapMs * 4, health.currentMinGapMs * 2));
    health.currentMaxConcurrent = 1;
    return;
  }

  if (category === "rate_limit") {
    health.cooldownUntil = Math.max(health.cooldownUntil, ts + (retryAfterMs ?? 30_000));
    health.currentMinGapMs = Math.min(15_000, Math.max(configuredMinGapMs * 2, health.currentMinGapMs + 500));
    health.currentMaxConcurrent = Math.max(1, health.currentMaxConcurrent - 1);
    return;
  }

  if (category === "timeout" || category === "transport") {
    health.cooldownUntil = Math.max(health.cooldownUntil, ts + 10_000);
    health.currentMinGapMs = Math.min(10_000, Math.max(configuredMinGapMs * 2, health.currentMinGapMs + 250));
    health.currentMaxConcurrent = Math.max(1, health.currentMaxConcurrent - 1);
    return;
  }

  health.cooldownUntil = Math.max(health.cooldownUntil, ts + 5_000);
  health.currentMinGapMs = Math.min(8_000, Math.max(configuredMinGapMs, health.currentMinGapMs + 100));
  health.currentMaxConcurrent = Math.max(1, health.currentMaxConcurrent - 1);
}

function recordEndpointSuccess(endpoint: EncarEndpointKind): void {
  const health = getEndpointHealth(endpoint);
  const ts = now();
  health.consecutiveSuccesses += 1;
  health.consecutiveFailures = 0;
  health.totalSuccesses += 1;
  health.lastSuccessAt = ts;
  if (health.consecutiveSuccesses >= 3) {
    health.currentMinGapMs = Math.max(configuredMinGapMs, Math.floor(health.currentMinGapMs * 0.75));
    health.currentMaxConcurrent = Math.min(configuredMaxConcurrent, health.currentMaxConcurrent + 1);
    if (health.cooldownUntil <= ts) {
      health.lastFailureCategory = null;
    }
  }
}

function blockFingerprint(
  fingerprintId: string | undefined,
  category: EncarFailureCategory,
  retryAfterMs?: number,
): void {
  if (!fingerprintId) return;
  const blockedUntil = now() + (retryAfterMs ?? (category === "hard_block" ? 90_000 : 30_000));
  blockedFingerprints.set(fingerprintId, { blockedUntil, reason: category });
}

function normalizeRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const when = Date.parse(value);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return undefined;
}

function classifyTransportError(
  endpoint: EncarEndpointKind,
  url: string,
  err: Error,
  fingerprintId?: string,
): EncarRequestError {
  const cause = (err as Error & { cause?: unknown }).cause;
  const causeCode =
    cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
      ? cause.code
      : typeof (err as Error & { code?: unknown }).code === "string"
        ? (err as Error & { code?: string }).code
        : undefined;
  const message = err.message || "fetch failed";
  const category: EncarFailureCategory =
    message.includes("aborted") || causeCode === "ABORT_ERR"
      ? "timeout"
      : causeCode && /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|UND_ERR/.test(causeCode)
        ? "transport"
        : message.includes("fetch failed")
          ? "transport"
          : "upstream";
  return new EncarRequestError(
    {
      category,
      endpoint,
      url,
      message,
      causeCode,
      fingerprintId,
    },
    { cause: err },
  );
}

async function acquireSlot(
  endpoint: EncarEndpointKind,
  priority: "live" | "bulk" = "bulk",
): Promise<void> {
  if (priority === "live") {
    while (liveInFlight >= LIVE_MAX_CONCURRENT) {
      await new Promise<void>((resolve) => liveWaitQueue.push(resolve));
    }
    // Don't stall customer live API on crawler cooldowns.
    liveInFlight++;
    lastRequestAt = now();
    return;
  }

  while (true) {
    const health = getEndpointHealth(endpoint);
    const ts = now();
    const cooldownRemaining = health.cooldownUntil - ts;
    if (cooldownRemaining > 0) {
      await sleep(Math.min(cooldownRemaining, 5_000));
      continue;
    }

    const effectiveMaxConcurrent = Math.max(1, Math.min(configuredMaxConcurrent, health.currentMaxConcurrent));
    const effectiveGapMs = Math.max(configuredMinGapMs, health.currentMinGapMs);
    if (inFlight < effectiveMaxConcurrent) {
      const gap = effectiveGapMs - (ts - lastRequestAt);
      if (gap > 0) await sleep(gap);
      inFlight++;
      lastRequestAt = now();
      return;
    }
    await new Promise<void>((resolve) => waitQueue.push(resolve));
  }
}

function releaseSlot(priority: "live" | "bulk" = "bulk"): void {
  if (priority === "live") {
    liveInFlight = Math.max(0, liveInFlight - 1);
    const next = liveWaitQueue.shift();
    if (next) next();
    return;
  }
  inFlight = Math.max(0, inFlight - 1);
  const next = waitQueue.shift();
  if (next) next();
}

export function configureEncarHttp(options: {
  maxConcurrent?: number;
  minGapMs?: number;
}): void {
  if (options.maxConcurrent != null) {
    configuredMaxConcurrent = Math.max(1, options.maxConcurrent);
  }
  if (options.minGapMs != null) {
    configuredMinGapMs = Math.max(0, options.minGapMs);
  }
  for (const endpoint of ENDPOINTS) {
    const health = getEndpointHealth(endpoint);
    health.currentMaxConcurrent = Math.min(health.currentMaxConcurrent, configuredMaxConcurrent);
    health.currentMinGapMs = Math.max(health.currentMinGapMs, configuredMinGapMs);
  }
}

export function getEncarHealthSnapshot(): EncarHealthSnapshot {
  cleanupBlockedFingerprints();
  return {
    endpoints: Object.fromEntries(
      ENDPOINTS.map((endpoint) => [endpoint, { ...getEndpointHealth(endpoint) }]),
    ) as Record<EncarEndpointKind, EncarEndpointHealth>,
    blockedFingerprints: [...blockedFingerprints.entries()].map(([fingerprintId, entry]) => ({
      fingerprintId,
      blockedUntil: entry.blockedUntil,
      reason: entry.reason,
    })),
  };
}

export function selectEncarFingerprint(endpoint: EncarEndpointKind): EncarRequestFingerprint {
  cleanupBlockedFingerprints();
  const usable = MOBILE_FINGERPRINTS.filter((fingerprint) => {
    const blocked = blockedFingerprints.get(fingerprint.id);
    return !blocked || blocked.blockedUntil <= now();
  });
  const pool = usable.length > 0 ? usable : MOBILE_FINGERPRINTS;
  const index = fingerprintCursor++ % pool.length;
  const fingerprint = pool[index]!;
  if (endpoint === "search" && fingerprint.refererBase === "https://www.encar.com/") {
    return { ...fingerprint, refererBase: "https://m.encar.com/" };
  }
  return fingerprint;
}

export function buildEncarHeaders(options: {
  endpoint: EncarEndpointKind;
  refererListingId?: string;
  accept?: string;
}): { fingerprint: EncarRequestFingerprint; headers: Record<string, string> } {
  const fingerprint = selectEncarFingerprint(options.endpoint);
  const referer =
    options.refererListingId != null
      ? `https://fem.encar.com/cars/detail/${options.refererListingId}`
      : fingerprint.refererBase;
  return {
    fingerprint,
    headers: {
      "User-Agent": fingerprint.userAgent,
      Accept: options.accept ?? "application/json, text/plain, */*",
      "Accept-Language": fingerprint.acceptLanguage,
      Origin: "https://www.encar.com",
      Referer: referer,
    },
  };
}

export function formatFetchError(err: unknown, url: string): Error {
  if (err instanceof EncarRequestError) return err;
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    const causeMsg =
      cause instanceof Error
        ? cause.message
        : cause != null
          ? String(cause)
          : "";
    const detail = causeMsg && causeMsg !== err.message ? `: ${causeMsg}` : "";
    return new Error(`${err.message}${detail} (${url})`);
  }
  return new Error(String(err));
}

async function fetchViaAgent(
  url: string,
  agent: HttpsProxyAgent<string>,
  init?: RequestInit,
): Promise<Response> {
  const https = await import("node:https");
  const parsed = new URL(url);
  return new Promise<Response>((resolve, reject) => {
    const req = https.request(
      parsed,
      {
        method: init?.method ?? "GET",
        agent,
        headers: init?.headers
          ? Object.fromEntries(
              init.headers instanceof Headers
                ? init.headers.entries()
                : Array.isArray(init.headers)
                  ? init.headers
                  : Object.entries(init.headers),
            )
          : undefined,
        signal: init?.signal as AbortSignal | undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v != null) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
          }
          resolve(
            new Response(body, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? "",
              headers,
            }),
          );
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (init?.body) req.write(init.body);
    req.end();
  });
}

export async function encarFetch(
  url: string,
  init?: RequestInit,
  options?: {
    endpoint?: EncarEndpointKind;
    fingerprintId?: string;
    priority?: "live" | "bulk";
  },
): Promise<Response> {
  const endpoint = options?.endpoint ?? "detail_other";
  const priority = options?.priority ?? "bulk";
  await acquireSlot(endpoint, priority);
  try {
    const agent = getProxyAgent();
    const response = agent ? await fetchViaAgent(url, agent, init) : await fetch(url, init);
    if (response.ok) {
      recordEndpointSuccess(endpoint);
      return response;
    }

    // Missing inspection/diagnosis/record is normal, not a block.
    if (response.status === 404) {
      return response;
    }

    const retryAfterMs = normalizeRetryAfter(response.headers.get("retry-after"));
    const category: EncarFailureCategory =
      response.status === 403 || response.status === 407
        ? "hard_block"
        : response.status === 429 || response.status === 503
          ? "rate_limit"
          : "upstream";

    applyFailurePenalty(endpoint, category, retryAfterMs);
    if (category === "hard_block" || category === "rate_limit") {
      blockFingerprint(options?.fingerprintId, category, retryAfterMs);
    }
    return response;
  } catch (err) {
    const classified = classifyTransportError(
      endpoint,
      url,
      err instanceof Error ? err : new Error(String(err)),
      options?.fingerprintId,
    );
    applyFailurePenalty(endpoint, classified.info.category, classified.info.retryAfterMs);
    throw classified;
  } finally {
    releaseSlot(priority);
  }
}
