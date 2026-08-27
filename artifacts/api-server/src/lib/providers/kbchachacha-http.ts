/**
 * KB ChaChaCha HTTP client (www.kbchachacha.com).
 * Search is an HTML fragment; VIN lives on the Carmodoo inspection sheet.
 */

import { HttpsProxyAgent } from "https-proxy-agent";

export const KB_WEB_BASE = "https://www.kbchachacha.com";
export const KB_SEARCH_PATH = "/public/search/list.empty";
export const KB_DETAIL_PATH = "/public/car/detail.kbc";
export const KB_PAGE_SIZE = 40;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const DETAIL_GAP_MS = 2_500;

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export class KbRequestError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public url: string,
  ) {
    super(message);
    this.name = "KbRequestError";
  }
}

export interface KbSearchParams {
  page?: number;
  makerCode?: string;
  keyword?: string;
  sort?: string;
}

let proxyAgent: HttpsProxyAgent<string> | undefined;
let proxyUrlCached: string | undefined;
let detailGate: Promise<void> = Promise.resolve();
let nextDetailAllowedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isKbCaptchaPage(html: string): boolean {
  return (
    html.includes("로봇여부 확인") ||
    html.includes("verifychallenge.json") ||
    html.includes("/public/flowcontrol/toomanyrequests") ||
    // Hard IP block: KB returns a meta-refresh to an off-site interdiction page.
    /220\.85\.44\.172\/KBchachacha\.html/i.test(html) ||
    /meta\s+http-equiv=["']?refresh["']?[^>]+KBchachacha\.html/i.test(html)
  );
}

async function paceDetailFetch(): Promise<void> {
  const run = detailGate.then(async () => {
    const wait = nextDetailAllowedAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextDetailAllowedAt = Date.now() + DETAIL_GAP_MS;
  });
  detailGate = run.catch(() => undefined);
  await run;
}

function getProxyAgent(): HttpsProxyAgent<string> | undefined {
  const url = process.env.KBCHACHACHA_PROXY || process.env.ENCAR_PROXY;
  if (!url) return undefined;
  if (proxyAgent && proxyUrlCached === url) return proxyAgent;
  proxyUrlCached = url;
  proxyAgent = new HttpsProxyAgent(url);
  return proxyAgent;
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
                  : Object.entries(init.headers as Record<string, string>),
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
    req.end();
  });
}

function defaultHeaders(referer = `${KB_WEB_BASE}/`): Record<string, string> {
  return {
    "User-Agent": DESKTOP_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
    Referer: referer,
  };
}

export async function kbFetchText(
  url: string,
  options?: { timeoutMs?: number; referer?: string },
): Promise<{ url: string; status: number; text: string; headers: Record<string, string> }> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = defaultHeaders(options?.referer);
  try {
    const agent = getProxyAgent();
    const init: RequestInit = { headers, signal: controller.signal };
    const res = agent ? await fetchViaAgent(url, agent, init) : await fetch(url, init);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BODY_BYTES) {
      throw new KbRequestError(res.status, "KB ChaChaCha response too large", url);
    }
    const headerMap: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headerMap[key] = value;
    });
    if (!res.ok) {
      throw new KbRequestError(res.status, `KB ChaChaCha HTTP ${res.status}`, url);
    }
    return { url, status: res.status, text: buf.toString("utf8"), headers: headerMap };
  } catch (err) {
    if (err instanceof KbRequestError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new KbRequestError(
      0,
      message.includes("abort") ? "KB ChaChaCha request timed out" : message,
      url,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function kbDetailUrl(carSeq: string): string {
  return `${KB_WEB_BASE}${KB_DETAIL_PATH}?carSeq=${encodeURIComponent(carSeq)}`;
}

export function extractKbCarSeq(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get("carSeq");
    if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;
  } catch {
    // fall through
  }
  const match = url.match(/[?&]carSeq=(\d+)/i) ?? url.match(/\bcarSeq[=/](\d+)/i);
  return match?.[1];
}

export async function kbFetchSearch(params: KbSearchParams = {}): Promise<string> {
  const url = new URL(`${KB_WEB_BASE}${KB_SEARCH_PATH}`);
  url.searchParams.set("page", String(params.page && params.page > 0 ? params.page : 1));
  if (params.makerCode) url.searchParams.set("makerCode", params.makerCode);
  if (params.keyword) url.searchParams.set("keyword", params.keyword);
  if (params.sort) url.searchParams.set("sort", params.sort);
  const res = await kbFetchText(url.toString(), {
    referer: `${KB_WEB_BASE}/public/search/main.kbc`,
  });
  if (isKbCaptchaPage(res.text)) {
    throw new KbRequestError(
      429,
      "KB ChaChaCha blocked this IP (bot-check / interdiction). Set KBCHACHACHA_PROXY to a KR residential proxy.",
      url.toString(),
    );
  }
  return res.text;
}

export async function kbFetchDetail(carSeq: string): Promise<{ url: string; html: string; headers: Record<string, string> }> {
  const url = kbDetailUrl(carSeq);
  await paceDetailFetch();
  const res = await kbFetchText(url, { referer: `${KB_WEB_BASE}/public/search/main.kbc` });
  if (isKbCaptchaPage(res.text)) {
    throw new KbRequestError(
      429,
      "KB ChaChaCha blocked this IP (bot-check / interdiction). Set KBCHACHACHA_PROXY to a KR residential proxy.",
      url,
    );
  }
  return { url, html: res.text, headers: res.headers };
}

export async function kbFetchInspection(inspectionUrl: string): Promise<string> {
  const res = await kbFetchText(inspectionUrl, { referer: `${KB_WEB_BASE}/` });
  return res.text;
}
