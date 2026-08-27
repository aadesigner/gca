/**
 * Shared HTTP client for Korean exporter sites (HTML + form POST).
 */

import { HttpsProxyAgent } from "https-proxy-agent";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const DEFAULT_TIMEOUT_MS = 35_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

let proxyAgent: HttpsProxyAgent<string> | undefined;
let proxyUrlCached: string | undefined;

function getProxyAgent(): HttpsProxyAgent<string> | undefined {
  const url = process.env.KR_PROXY || process.env.ENCAR_PROXY;
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
    if (init?.body) req.write(init.body);
    req.end();
  });
}

const cookieJar = new Map<string, Map<string, string>>();

export class KrRequestError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public url: string,
  ) {
    super(message);
    this.name = "KrRequestError";
  }
}

function originOf(url: string): string {
  return new URL(url).origin;
}

function asciiUrl(raw: string): string {
  try {
    return new URL(raw).href;
  } catch {
    return encodeURI(raw);
  }
}

function asciiHeader(value: string): string {
  return encodeURI(value);
}

function cookieHeader(url: string): string | undefined {
  const jar = cookieJar.get(originOf(url));
  if (!jar || jar.size === 0) return undefined;
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(url: string, headers: Headers): void {
  const origin = originOf(url);
  const jar = cookieJar.get(origin) ?? new Map<string, string>();
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const fallback = headers.get("set-cookie");
  const list = raw.length > 0 ? raw : fallback ? [fallback] : [];
  for (const line of list) {
    const pair = line.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  cookieJar.set(origin, jar);
}

export async function krFetch(
  url: string,
  options?: {
    method?: string;
    body?: string | URLSearchParams;
    contentType?: string;
    referer?: string;
    accept?: string;
    headers?: Record<string, string>;
  },
): Promise<{ url: string; status: number; text: string; headers: Record<string, string> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const requestUrl = asciiUrl(url);
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: options?.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
    ...(options?.referer ? { Referer: asciiHeader(options.referer) } : {}),
    ...(options?.headers ?? {}),
  };
  const cookie = cookieHeader(requestUrl);
  if (cookie) {
    headers.Cookie = headers.Cookie ? `${headers.Cookie}; ${cookie}` : cookie;
  }
  if (options?.body) {
    headers["Content-Type"] = options.contentType ?? "application/x-www-form-urlencoded";
  }

  try {
    const agent = getProxyAgent();
    const body =
      options?.body instanceof URLSearchParams ? options.body.toString() : options?.body;
    const init: RequestInit = {
      method: options?.method ?? "GET",
      headers,
      body,
      redirect: "follow",
      signal: controller.signal,
    };
    const res = agent ? await fetchViaAgent(requestUrl, agent, init) : await fetch(requestUrl, init);
    storeCookies(res.url || url, res.headers);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BODY_BYTES) {
      throw new KrRequestError(res.status, "Response too large", url);
    }
    const text = buf.toString("utf8");
    if (/차단된\s*IP|blocked\s*ip/i.test(text) && buf.length < 500) {
      throw new KrRequestError(403, `IP blocked by ${new URL(url).host}`, url);
    }
    if (res.status === 404) {
      throw new KrRequestError(404, `Not found: ${url}`, url);
    }
    if (res.status >= 400) {
      throw new KrRequestError(res.status, `HTTP ${res.status} for ${url}`, url);
    }
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      outHeaders[key] = value;
    });
    return { url: res.url, status: res.status, text, headers: outHeaders };
  } catch (err) {
    if (err instanceof KrRequestError) throw err;
    throw new KrRequestError(0, err instanceof Error ? err.message : String(err), url);
  } finally {
    clearTimeout(timer);
  }
}

export function headersToRecord(headers: Record<string, string>): Record<string, string> {
  return headers;
}
