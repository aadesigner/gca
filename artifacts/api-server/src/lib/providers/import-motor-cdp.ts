/**
 * Fetch import-motor.com pages through a real Chrome instance via CDP.
 * Playwright/Node fetch get Cloudflare reload loops — clearance is bound to
 * the real browser TLS fingerprint.
 *
 * Requires Chrome started with:
 *   chrome --remote-debugging-port=9222 --user-data-dir=%TEMP%\chrome-im-cdp
 * and IMPORT_MOTOR_CDP_URL=http://127.0.0.1:9222
 *
 * Parallelism: IMPORT_MOTOR_CDP_TABS (default 10) opens that many Chrome tabs
 * and serves concurrent navigations from a pool. Sessions stay open so we do
 * not reconnect WebSocket on every VIN (major speed win).
 */

import fs from "node:fs";
import path from "node:path";
import { KrRequestError } from "./kr-http";

type CdpTarget = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

type CdpResult = { url: string; status: number; text: string };

type PoolTab = {
  id: string;
  wsUrl: string;
  busy: boolean;
  session: CdpSession | null;
};

let pool: PoolTab[] | null = null;
let poolInit: Promise<PoolTab[]> | null = null;
const waiters: Array<() => void> = [];
let htmlFetchesInFlight = 0;

/** Cap concurrent full-HTML CDP reads (heavy). Defaults high enough to match tab parallelism. */
function withHtmlFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
  const htmlLimit = Math.min(maxCdpParallel(), 8);
  return new Promise<T>((resolve, reject) => {
    const tryStart = (): void => {
      if (htmlFetchesInFlight >= htmlLimit) {
        setTimeout(tryStart, 30);
        return;
      }
      htmlFetchesInFlight += 1;
      Promise.resolve()
        .then(fn)
        .then(
          (v) => {
            htmlFetchesInFlight = Math.max(0, htmlFetchesInFlight - 1);
            resolve(v);
          },
          (e) => {
            htmlFetchesInFlight = Math.max(0, htmlFetchesInFlight - 1);
            reject(e);
          },
        );
    };
    tryStart();
  });
}

function cdpEndpoint(): string | undefined {
  return process.env.IMPORT_MOTOR_CDP_URL?.trim() || undefined;
}

export function desiredTabCount(): number {
  const raw = Number(process.env.IMPORT_MOTOR_CDP_TABS ?? "10");
  if (!Number.isFinite(raw) || raw < 1) return 10;
  return Math.min(16, Math.floor(raw));
}

export function importMotorUsesCdp(): boolean {
  return Boolean(cdpEndpoint());
}

async function listTargets(base: string): Promise<CdpTarget[]> {
  const res = await fetch(`${base.replace(/\/$/, "")}/json/list`);
  if (!res.ok) throw new Error(`CDP list failed: ${res.status}`);
  return (await res.json()) as CdpTarget[];
}

async function openNewTab(base: string, url: string): Promise<CdpTarget> {
  const endpoint = `${base.replace(/\/$/, "")}/json/new?${encodeURIComponent(url)}`;
  for (const method of ["PUT", "GET"] as const) {
    try {
      const res = await fetch(endpoint, { method });
      if (!res.ok) continue;
      const target = (await res.json()) as CdpTarget;
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      /* try next method */
    }
  }
  throw new Error(`Failed to open CDP tab via ${endpoint}`);
}

function pageTargets(targets: CdpTarget[]): CdpTarget[] {
  return targets.filter(
    (t) => t.type === "page" && t.webSocketDebuggerUrl && !/^chrome/i.test(t.url || ""),
  );
}

async function ensurePool(base: string): Promise<PoolTab[]> {
  const want = desiredTabCount();

  // Rebind / replenish when tabs were closed in Chrome or the pool shrank.
  if (pool && pool.length > 0 && !poolInit) {
    try {
      const live = pageTargets(await listTargets(base));
      const liveById = new Map(live.map((t) => [t.id, t]));
      const surviving: PoolTab[] = [];
      for (const tab of pool) {
        const t = liveById.get(tab.id);
        if (!t?.webSocketDebuggerUrl) {
          try {
            tab.session?.close();
          } catch {
            /* ignore */
          }
          tab.session = null;
          tab.busy = false;
          continue;
        }
        tab.wsUrl = t.webSocketDebuggerUrl;
        surviving.push(tab);
      }
      pool = surviving;
      while (pool.length < want) {
        const created = await openNewTab(base, "https://import-motor.com/buyer-locations");
        if (!created.webSocketDebuggerUrl || !created.id) {
          throw new Error("CDP opened a tab without a debugger URL");
        }
        pool.push({
          id: created.id,
          wsUrl: created.webSocketDebuggerUrl,
          busy: false,
          session: null,
        });
        await new Promise((r) => setTimeout(r, 150));
      }
      if (pool.length > 0) return pool;
      resetImportMotorCdpPool();
    } catch {
      resetImportMotorCdpPool();
    }
  }

  if (pool && pool.length > 0) return pool;
  if (poolInit) return poolInit;

  poolInit = (async () => {
    const targets = pageTargets(await listTargets(base));

    const preferred = targets.filter((t) => /import-motor\.com/i.test(t.url));
    const seed = preferred.length > 0 ? preferred : targets;

    const tabs: PoolTab[] = [];
    for (const t of seed) {
      if (!t.webSocketDebuggerUrl || !t.id) continue;
      tabs.push({ id: t.id, wsUrl: t.webSocketDebuggerUrl, busy: false, session: null });
      if (tabs.length >= want) break;
    }

    while (tabs.length < want) {
      const created = await openNewTab(base, "https://import-motor.com/buyer-locations");
      if (!created.webSocketDebuggerUrl || !created.id) {
        throw new Error("CDP opened a tab without a debugger URL");
      }
      tabs.push({
        id: created.id,
        wsUrl: created.webSocketDebuggerUrl,
        busy: false,
        session: null,
      });
      await new Promise((r) => setTimeout(r, 150));
    }

    if (tabs.length === 0) {
      throw new KrRequestError(
        503,
        "No Chrome page for CDP. Start Chrome with --remote-debugging-port=9222 and open import-motor.com",
        base,
      );
    }

    pool = tabs;
    return tabs;
  })();

  try {
    return await poolInit;
  } catch (err) {
    poolInit = null;
    pool = null;
    throw err;
  }
}

function acquireTab(tabs: PoolTab[], timeoutMs = 25_000): Promise<PoolTab> {
  const free = tabs.find((t) => !t.busy);
  if (free) {
    free.busy = true;
    return Promise.resolve(free);
  }

  return new Promise<PoolTab>((resolve, reject) => {
    let settled = false;

    const onWake = (): void => {
      if (settled) return;
      const next = tabs.find((t) => !t.busy);
      if (!next) {
        waiters.push(onWake);
        return;
      }
      settled = true;
      next.busy = true;
      resolve(next);
    };

    waiters.push(onWake);

    setTimeout(() => {
      if (settled) return;
      const idx = waiters.indexOf(onWake);
      if (idx >= 0) waiters.splice(idx, 1);
      // Hard reset — hung tabs leave busy=true and block the whole crawl.
      resetImportMotorCdpPool();
      settled = true;
      reject(new Error(`CDP tab acquire timed out after ${timeoutMs}ms — pool reset`));
    }, timeoutMs);
  });
}

function releaseTab(tab: PoolTab): void {
  tab.busy = false;
  const wake = waiters.shift();
  if (wake) wake();
}

class CdpSession {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private alive = true;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (msg.id == null) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
      else p.resolve(msg.result);
    });
    ws.addEventListener("close", () => {
      this.alive = false;
      for (const [, p] of this.pending) p.reject(new Error("CDP websocket closed"));
      this.pending.clear();
    });
    ws.addEventListener("error", () => {
      this.alive = false;
    });
  }

  get isOpen(): boolean {
    return this.alive && this.ws.readyState === WebSocket.OPEN;
  }

  static async connect(wsUrl: string, timeoutMs = 8_000): Promise<CdpSession> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP websocket connect timed out: ${wsUrl}`)), timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`CDP websocket failed: ${wsUrl}`));
      });
    });
    return new CdpSession(ws);
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
    if (!this.isOpen) return Promise.reject(new Error("CDP websocket not open"));
    const id = this.nextId++;
    const work = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    return Promise.race([
      work,
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      }),
    ]);
  }

  close(): void {
    this.alive = false;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function refreshTabWsUrl(base: string, tab: PoolTab): Promise<void> {
  const targets = pageTargets(await listTargets(base));
  const match = targets.find((t) => t.id === tab.id) ?? targets.find((t) => t.webSocketDebuggerUrl);
  if (match?.webSocketDebuggerUrl) {
    tab.id = match.id;
    tab.wsUrl = match.webSocketDebuggerUrl;
  }
}

async function sessionForTab(base: string, tab: PoolTab): Promise<CdpSession> {
  if (tab.session?.isOpen) return tab.session;
  if (tab.session) {
    try {
      tab.session.close();
    } catch {
      /* ignore */
    }
    tab.session = null;
  }
  try {
    tab.session = await CdpSession.connect(tab.wsUrl);
  } catch {
    await refreshTabWsUrl(base, tab);
    tab.session = await CdpSession.connect(tab.wsUrl);
  }
  await tab.session.send("Page.enable", undefined, 5_000);
  await tab.session.send("Runtime.enable", undefined, 5_000);
  try {
    await tab.session.send("DOM.enable", undefined, 3_000);
  } catch {
    /* optional */
  }
  await applyImportMotorCookies(tab.session);
  return tab.session;
}

type CookieInput = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
};

function loadImportMotorCookies(): CookieInput[] {
  const byName = new Map<string, CookieInput>();
  const jsonPath =
    process.env.IMPORT_MOTOR_COOKIES_JSON?.trim() ||
    path.resolve(process.cwd(), "../../scripts/.import-motor.cookies.json");
  try {
    if (fs.existsSync(jsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as unknown;
      const rows = Array.isArray(parsed) ? parsed : [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const rec = row as Record<string, unknown>;
        const name = String(rec.name ?? "").trim();
        const value = String(rec.value ?? "").trim();
        if (!name || !value || name === "cf_clearance") continue;
        byName.set(name, {
          name,
          value,
          domain: typeof rec.domain === "string" ? rec.domain : ".import-motor.com",
          path: typeof rec.path === "string" ? rec.path : "/",
          httpOnly: rec.httpOnly === true,
          secure: rec.secure !== false,
        });
      }
    }
  } catch {
    /* ignore malformed cookie files */
  }
  const raw = process.env.IMPORT_MOTOR_COOKIE?.trim();
  if (raw) {
    for (const part of raw.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!name || !value || name === "cf_clearance") continue;
      if (byName.has(name)) continue;
      byName.set(name, { name, value, domain: ".import-motor.com", path: "/", secure: true });
    }
  }
  return [...byName.values()];
}

async function applyImportMotorCookies(session: CdpSession): Promise<void> {
  const cookies = loadImportMotorCookies();
  if (cookies.length === 0) return;
  try {
    await session.send("Network.enable", undefined, 3_000);
  } catch {
    return;
  }
  for (const cookie of cookies) {
    if (cookie.name === "cf_clearance") continue;
    try {
      await session.send(
        "Network.setCookie",
        {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain || ".import-motor.com",
          path: cookie.path || "/",
          httpOnly: Boolean(cookie.httpOnly),
          secure: cookie.secure !== false,
        },
        3_000,
      );
    } catch {
      /* ignore single cookie failures */
    }
  }
}

function looksLikeChallenge(title: string, html: string): boolean {
  if (/just a moment|attention required/i.test(title)) return true;
  if (/cf-challenge-running|cdn-cgi\/challenge-platform\/h\//i.test(html) && html.length < 50_000) {
    return true;
  }
  return false;
}

function looksLikeHttpErrorPage(title: string, html: string): number | undefined {
  if (/405\s*Method Not Allowed|Method Not Allowed/i.test(title) || /Method Not Allowed/i.test(html.slice(0, 4_000))) {
    return 405;
  }
  if (/An Error Occurred/i.test(title) && /server returned a\s*"?40\d/i.test(html.slice(0, 4_000))) {
    const m = html.slice(0, 4_000).match(/server returned a\s*"?(40\d)/i);
    return m ? Number(m[1]) : 500;
  }
  if (/404\s*Not Found|page not found/i.test(title) && html.length < 30_000) return 404;
  return undefined;
}

/** True when the landed URL matches what we asked for (not a silent bounce to the hub). */
function landedOnExpectedUrl(requested: string, href: string): boolean {
  if (/\/v\/[A-HJ-NPR-Z0-9]{17}/i.test(requested)) {
    return /\/v\/[A-HJ-NPR-Z0-9]{17}/i.test(href);
  }
  const country = requested.match(/\/buyer-locations\/([a-z]{2})(?:[/?#]|$)/i);
  if (country) {
    return new RegExp(`/buyer-locations/${country[1]}(?:[/?#]|$)`, "i").test(href);
  }
  return true;
}

function isBareBuyerLocationsHub(href: string): boolean {
  return /\/buyer-locations\/?(\?|#|$)/i.test(href) && !/\/buyer-locations\/[a-z]{2}/i.test(href);
}

async function navigateAndRead(session: CdpSession, url: string): Promise<CdpResult> {
  await applyImportMotorCookies(session);
  await session.send("Page.navigate", { url, transitionType: "typed" });

  await new Promise((r) => setTimeout(r, 250));

  const deadline = Date.now() + 45_000;
  let lastTitle = "";
  let lastHref = url;
  let pollMs = 200;
  let sawWrongHub = false;
  let challengeSince: number | null = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    if (pollMs < 450) pollMs = Math.min(450, pollMs + 50);

    // Lightweight poll — never ship full HTML until the page is ready.
    const evalResult = await session.send<{
      result: {
        value?: { title?: string; href?: string; len?: number; ready?: boolean; challenge?: boolean };
      };
    }>("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const title = document.title || '';
        const href = location.href || '';
        const len = document.documentElement ? document.documentElement.outerHTML.length : 0;
        const head = document.documentElement
          ? document.documentElement.outerHTML.slice(0, 5000)
          : '';
        const challenge =
          /Just a moment|Attention Required/i.test(title) ||
          /cf-challenge-running/i.test(head);
        const err =
          challenge ||
          /Method Not Allowed|An Error Occurred/i.test(title) ||
          /Method Not Allowed/i.test(head);
        const ready =
          !err &&
          len > 15000 &&
          (/\\/v\\/[A-HJ-NPR-Z0-9]{17}/i.test(href) ||
            /\\/buyer-locations\\/[a-z]{2}(?:[/?#]|$)/i.test(href) ||
            /\\/buyer-locations\\/?([?#]|$)/i.test(href) ||
            /Lot number|Primary damage|Odometer|Buy now|Vin:/i.test(head));
        return { title, href, len, ready, challenge };
      })()`,
    });
    const value = evalResult.result?.value;
    if (!value) continue;
    lastTitle = value.title ?? "";
    lastHref = value.href ?? url;

    if (value.challenge) {
      // Expired cf_clearance never auto-clears — don't burn 45s per VIN.
      if (challengeSince == null) challengeSince = Date.now();
      else if (Date.now() - challengeSince >= 8_000) {
        throw new KrRequestError(
          403,
          `Import Motor Cloudflare challenge stuck (refresh IMPORT_MOTOR_COOKIE / pass CF in the debug Chrome window) for ${url}`,
          url,
        );
      }
      pollMs = 400;
      continue;
    }
    challengeSince = null;

    const httpErr = looksLikeHttpErrorPage(lastTitle, "");
    if (httpErr && /Method Not Allowed|An Error Occurred|404/i.test(lastTitle)) {
      throw new KrRequestError(httpErr, `Import Motor returned HTTP ${httpErr} for ${url}`, url);
    }

    if (!landedOnExpectedUrl(url, lastHref) && isBareBuyerLocationsHub(lastHref)) {
      sawWrongHub = true;
      if (Date.now() + 2_000 >= deadline || pollMs >= 400) break;
      continue;
    }

    if (value.ready && landedOnExpectedUrl(url, lastHref)) {
      try {
        const html = await withHtmlFetchSlot(async () => readPageHtml(session));
        if (html.length < 10_000) {
          pollMs = 300;
          continue;
        }
        const titleErr = looksLikeHttpErrorPage(lastTitle, html);
        if (titleErr) {
          throw new KrRequestError(titleErr, `Import Motor returned HTTP ${titleErr} for ${url}`, url);
        }
        if (looksLikeChallenge(lastTitle, html)) {
          pollMs = 500;
          continue;
        }
        return { url: lastHref, status: 200, text: html };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/timed out/i.test(msg)) {
          // Page is ready but HTML export wedged — retry poll rather than CF error.
          pollMs = 400;
          continue;
        }
        throw err;
      }
    }
  }

  if (sawWrongHub || !landedOnExpectedUrl(url, lastHref)) {
    throw new KrRequestError(
      403,
      `Import Motor redirected to hub instead of ${url} (refresh IMPORT_MOTOR_COOKIE / pass Cloudflare in the debug Chrome window)`,
      url,
    );
  }

  throw new KrRequestError(
    403,
    `Import Motor CDP page not readable in time (${lastTitle || "no title"} @ ${lastHref}). Pass Cloudflare once in the debug Chrome window and keep DevTools closed on those tabs.`,
    url,
  );
}

async function readPageHtml(session: CdpSession): Promise<string> {
  // Prefer DOM.getOuterHTML — Runtime.evaluate(returnByValue) often wedges on large IM pages
  // when several tabs finish at once.
  try {
    const doc = await session.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: 0 }, 8_000);
    const nodeId = doc.root?.nodeId;
    if (nodeId) {
      const got = await session.send<{ outerHTML?: string }>("DOM.getOuterHTML", { nodeId }, 15_000);
      if (got.outerHTML && got.outerHTML.length > 10_000) return got.outerHTML;
    }
  } catch {
    /* fall through */
  }

  const htmlResult = await session.send<{ result: { value?: string } }>(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `(() => {
        const root = document.documentElement;
        if (!root) return '';
        const clone = root.cloneNode(true);
        clone.querySelectorAll('script,noscript').forEach((n) => n.remove());
        return clone.outerHTML;
      })()`,
    },
    15_000,
  );
  return htmlResult.result?.value ?? "";
}

let cdpOpsInFlight = 0;

function maxCdpParallel(): number {
  const tabs = desiredTabCount();
  const raw = Number(process.env.IMPORT_MOTOR_CDP_PARALLEL ?? String(tabs));
  if (!Number.isFinite(raw) || raw < 1) return tabs;
  return Math.min(tabs, Math.floor(raw));
}

/**
 * Bound parallel CDP navigations to IMPORT_MOTOR_CDP_PARALLEL (default = tab count).
 * Keep this ≤ IMPORT_MOTOR_CDP_TABS.
 */
export async function importMotorGetViaCdp(url: string): Promise<CdpResult> {
  const limit = maxCdpParallel();
  await new Promise<void>((resolve) => {
    const wait = (): void => {
      if (cdpOpsInFlight < limit) {
        cdpOpsInFlight += 1;
        resolve();
        return;
      }
      setTimeout(wait, 25);
    };
    wait();
  });

  try {
    return await importMotorGetViaCdpUnlocked(url);
  } finally {
    cdpOpsInFlight = Math.max(0, cdpOpsInFlight - 1);
  }
}

async function importMotorGetViaCdpUnlocked(url: string): Promise<CdpResult> {
  const base = cdpEndpoint();
  if (!base) {
    throw new KrRequestError(503, "IMPORT_MOTOR_CDP_URL is not set", url);
  }

  const tabs = await ensurePool(base);
  const tab = await acquireTab(tabs);
  try {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (tab.session) {
          try {
            tab.session.close();
          } catch {
            /* ignore */
          }
          tab.session = null;
        }
        const session = await sessionForTab(base, tab);
        return await navigateAndRead(session, url);
      } catch (err) {
        lastErr = err;
        if (tab.session) {
          try {
            tab.session.close();
          } catch {
            /* ignore */
          }
          tab.session = null;
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0 && /redirected to hub|not readable|timed out|Cloudflare/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  } finally {
    releaseTab(tab);
  }
}

/** Drop the in-memory pool so the next fetch rebinds to live Chrome tabs. */
export function resetImportMotorCdpPool(): void {
  if (pool) {
    for (const tab of pool) {
      try {
        tab.session?.close();
      } catch {
        /* ignore */
      }
      tab.session = null;
      tab.busy = false;
    }
  }
  pool = null;
  poolInit = null;
  waiters.length = 0;
}

/** Force pool rebuild and open Chrome tabs until IMPORT_MOTOR_CDP_TABS is met. */
export async function healImportMotorCdpPool(): Promise<{
  desired: number;
  poolSize: number;
  chromePages: number;
}> {
  const base = cdpEndpoint();
  if (!base) {
    throw new Error("IMPORT_MOTOR_CDP_URL is not set");
  }
  resetImportMotorCdpPool();
  const tabs = await ensurePool(base);
  const live = pageTargets(await listTargets(base));
  return {
    desired: desiredTabCount(),
    poolSize: tabs.length,
    chromePages: live.length,
  };
}
