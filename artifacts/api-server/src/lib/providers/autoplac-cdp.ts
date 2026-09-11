/**
 * Autoplac list discovery via Chrome CDP.
 *
 * Cold navigations to ?p=N reset to page 1. Real pagination is Angular SPA:
 * click a `custom-paginator__link` (mutating href when needed) and capture
 *   GET https://api.autoplac.pl/offers/search?vehicleType=PASSENGER&p={n}
 *
 * Pool: AUTOPLAC_CDP_TABS (default 5). Endpoint: AUTOPLAC_CDP_URL or IMPORT_MOTOR_CDP_URL.
 * Keep Autoplac tabs on autoplac.pl — do not share Import Motor tabs.
 */

type CdpTarget = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

type PoolTab = {
  id: string;
  wsUrl: string;
  busy: boolean;
  session: CdpSession | null;
};

type SearchHit = {
  offerList: unknown[];
  offerCount?: number;
};

const LIST_URL = "https://autoplac.pl/oferty/samochody-osobowe";
const SEARCH_RE = /api\.autoplac\.pl\/offers\/search/i;

function brandListUrl(brandSlug?: string): string {
  const slug = brandSlug?.trim().toLowerCase();
  if (!slug) return LIST_URL;
  return `${LIST_URL}/${encodeURIComponent(slug)}`;
}

export function autoplacBrandSlug(displayName: string): string {
  return displayName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Popular + full brand list for Autoplac shards (Node API — no CDP). */
export async function fetchAutoplacBrandSlugs(): Promise<Array<{ id: number; name: string; slug: string }>> {
  const res = await fetch(`${"https://api.autoplac.pl"}/vehicle-dictionary/search/brand?vehicleType=PASSENGER`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: "https://autoplac.pl",
      Referer: "https://autoplac.pl/oferty/samochody-osobowe",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Autoplac brand dictionary HTTP ${res.status}`);
  const body = (await res.json()) as {
    popularBrands?: Array<{ value?: number; displayName?: string }>;
    brands?: Array<{ value?: number; displayName?: string }>;
  };
  const seen = new Set<string>();
  const out: Array<{ id: number; name: string; slug: string }> = [];
  for (const row of [...(body.popularBrands ?? []), ...(body.brands ?? [])]) {
    const name = String(row.displayName ?? "").trim();
    if (!name) continue;
    const slug = autoplacBrandSlug(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ id: Number(row.value) || 0, name, slug });
  }
  return out;
}

let pool: PoolTab[] | null = null;
let poolInit: Promise<PoolTab[]> | null = null;
const waiters: Array<() => void> = [];

function cdpEndpoint(): string | undefined {
  return process.env.AUTOPLAC_CDP_URL?.trim() || process.env.IMPORT_MOTOR_CDP_URL?.trim() || undefined;
}

export function autoplacUsesCdp(): boolean {
  return Boolean(cdpEndpoint());
}

export function autoplacDesiredTabCount(): number {
  const raw = Number(process.env.AUTOPLAC_CDP_TABS ?? "5");
  if (!Number.isFinite(raw) || raw < 1) return 5;
  return Math.min(10, Math.floor(raw));
}

function maxCdpParallel(): number {
  const tabs = autoplacDesiredTabCount();
  const raw = Number(process.env.AUTOPLAC_CDP_PARALLEL ?? String(tabs));
  if (!Number.isFinite(raw) || raw < 1) return tabs;
  return Math.min(tabs, Math.floor(raw));
}

async function listTargets(base: string): Promise<CdpTarget[]> {
  const res = await fetch(`${base.replace(/\/$/, "")}/json/list`);
  if (!res.ok) throw new Error(`Autoplac CDP list failed: ${res.status}`);
  return (await res.json()) as CdpTarget[];
}

function pageTargets(targets: CdpTarget[]): CdpTarget[] {
  return targets.filter(
    (t) => t.type === "page" && t.webSocketDebuggerUrl && !/^chrome/i.test(t.url || ""),
  );
}

function isAutoplacTab(t: CdpTarget): boolean {
  return /autoplac\.pl/i.test(t.url || "");
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
      /* try next */
    }
  }
  throw new Error(`Failed to open Autoplac CDP tab via ${endpoint}`);
}

export function resetAutoplacCdpPool(): void {
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

async function ensurePool(base: string): Promise<PoolTab[]> {
  const want = autoplacDesiredTabCount();

  if (pool && pool.length > 0 && !poolInit) {
    try {
      const live = pageTargets(await listTargets(base)).filter(isAutoplacTab);
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
        const created = await openNewTab(base, LIST_URL);
        if (!created.webSocketDebuggerUrl || !created.id) {
          throw new Error("Autoplac CDP opened a tab without a debugger URL");
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
      resetAutoplacCdpPool();
    } catch {
      resetAutoplacCdpPool();
    }
  }

  if (pool && pool.length > 0) return pool;
  if (poolInit) return poolInit;

  poolInit = (async () => {
    const targets = pageTargets(await listTargets(base)).filter(isAutoplacTab);
    const tabs: PoolTab[] = [];
    for (const t of targets) {
      if (!t.webSocketDebuggerUrl || !t.id) continue;
      tabs.push({ id: t.id, wsUrl: t.webSocketDebuggerUrl, busy: false, session: null });
      if (tabs.length >= want) break;
    }
    while (tabs.length < want) {
      const created = await openNewTab(base, LIST_URL);
      if (!created.webSocketDebuggerUrl || !created.id) {
        throw new Error("Autoplac CDP opened a tab without a debugger URL");
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
      throw new Error("No Chrome page for Autoplac CDP — start Chrome with --remote-debugging-port=9222");
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

function acquireTab(tabs: PoolTab[], timeoutMs = 45_000): Promise<PoolTab> {
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
      resetAutoplacCdpPool();
      settled = true;
      reject(new Error(`Autoplac CDP tab acquire timed out after ${timeoutMs}ms`));
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
  private searchEvents: Array<{
    requestId: string;
    url: string;
    status: number;
    done: boolean;
    body?: string;
  }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
        error?: { message?: string };
      };
      if (msg.method === "Network.responseReceived") {
        const response = msg.params?.response as { url?: string; status?: number } | undefined;
        const requestId = String(msg.params?.requestId ?? "");
        const url = response?.url ?? "";
        if (requestId && SEARCH_RE.test(url) && /vehicleType=PASSENGER/i.test(url)) {
          this.searchEvents.push({
            requestId,
            url,
            status: Number(response?.status ?? 0),
            done: false,
          });
        }
      }
      if (msg.method === "Network.loadingFinished") {
        const requestId = String(msg.params?.requestId ?? "");
        const hit = this.searchEvents.find((h) => h.requestId === requestId && !h.done);
        if (hit) {
          hit.done = true;
          // Capture immediately — a follow-up 423 can evict the 200 body from CDP buffers.
          void this.fetchBody(hit);
        }
      }
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
  }

  private async fetchBody(hit: { requestId: string; body?: string }): Promise<void> {
    try {
      const body = await this.send<{ body?: string; base64Encoded?: boolean }>(
        "Network.getResponseBody",
        { requestId: hit.requestId },
        15_000,
      );
      hit.body = body.base64Encoded
        ? Buffer.from(body.body ?? "", "base64").toString("utf8")
        : (body.body ?? "");
    } catch {
      /* body may already be evicted */
    }
  }

  get isOpen(): boolean {
    return this.alive && this.ws.readyState === WebSocket.OPEN;
  }

  static async connect(wsUrl: string, timeoutMs = 8_000): Promise<CdpSession> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Autoplac CDP websocket connect timed out")), timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Autoplac CDP websocket failed"));
      });
    });
    return new CdpSession(ws);
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
    if (!this.isOpen) return Promise.reject(new Error("Autoplac CDP websocket not open"));
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
            reject(new Error(`Autoplac CDP ${method} timed out`));
          }
        }, timeoutMs);
      }),
    ]);
  }

  clearSearchEvents(): void {
    this.searchEvents = [];
  }

  findSearch(page: number, _sinceMs: number): { status: number; url: string; body?: string; done: boolean } | undefined {
    const matches = this.searchEvents.filter((h) => {
      if (!h.done) return false;
      if (page <= 1) {
        return /[?&]p=1(?:&|$)/.test(h.url) || !/[?&]p=\d+/.test(h.url);
      }
      return new RegExp(`[?&]p=${page}(?:&|$)`).test(h.url);
    });
    // Prefer HTTP 200 — Autoplac often fires a duplicate 423 right after a good response.
    return matches.find((h) => h.status === 200) ?? matches[matches.length - 1];
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
    const live = pageTargets(await listTargets(base)).find((t) => t.id === tab.id);
    if (live?.webSocketDebuggerUrl) {
      tab.wsUrl = live.webSocketDebuggerUrl;
    }
    tab.session = await CdpSession.connect(tab.wsUrl);
  }
  await tab.session.send("Page.enable", undefined, 5_000);
  await tab.session.send("Runtime.enable", undefined, 5_000);
  await tab.session.send(
    "Network.enable",
    { maxResourceBufferSize: 20 * 1024 * 1024, maxTotalBufferSize: 40 * 1024 * 1024 },
    5_000,
  );
  return tab.session;
}

async function ensureOnList(session: CdpSession, brandSlug?: string): Promise<void> {
  const want = brandListUrl(brandSlug);
  const href = await session.send<{ result?: { value?: string } }>("Runtime.evaluate", {
    expression: "location.href",
    returnByValue: true,
  });
  const current = href.result?.value ?? "";
  const onBrand =
    brandSlug
      ? new RegExp(`/oferty/samochody-osobowe/${brandSlug}(?:\\?|$|#)`, "i").test(current)
      : /autoplac\.pl\/oferty\/samochody-osobowe\/?(?:\?|$|#)/i.test(current) &&
        !/\/oferty\/samochody-osobowe\/[^/?#]+/i.test(current);

  if (onBrand || (!brandSlug && /\/oferty\/samochody-osobowe/i.test(current))) {
    for (let i = 0; i < 20; i++) {
      const ready = await session.send<{ result?: { value?: boolean } }>("Runtime.evaluate", {
        expression: "!!document.querySelector('a.custom-paginator__link') || !!document.getElementById('ng-state')",
        returnByValue: true,
      });
      if (ready.result?.value) return;
      await new Promise((r) => setTimeout(r, 400));
    }
    return;
  }
  session.clearSearchEvents();
  await session.send("Page.navigate", { url: want });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const ready = await session.send<{ result?: { value?: boolean } }>("Runtime.evaluate", {
      expression:
        "(!/just a moment/i.test(document.title)) && (!!document.querySelector('a.custom-paginator__link') || !!document.getElementById('ng-state'))",
      returnByValue: true,
    });
    if (ready.result?.value) return;
  }
  throw new Error(`Autoplac CDP list page did not become ready (${want})`);
}

async function clickToPage(session: CdpSession, page: number, brandSlug?: string): Promise<void> {
  const basePath = brandSlug
    ? `/oferty/samochody-osobowe/${brandSlug}`
    : "/oferty/samochody-osobowe";
  const href = page <= 1 ? basePath : `${basePath}?p=${page}`;
  const result = await session.send<{ result?: { value?: { ok?: boolean; reason?: string } } }>(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const href = ${JSON.stringify(href)};
        const page = ${page};
        const links = [...document.querySelectorAll("a.custom-paginator__link")];
        let a = links.find((el) => el.textContent.trim() === String(page));
        if (!a && page > 1) {
          a = links.find((el) => (el.getAttribute("href") || "").includes("p="));
        }
        if (!a) a = links[0];
        if (!a) return { ok: false, reason: "no-paginator" };
        if (page > 1) a.setAttribute("href", href);
        a.click();
        return { ok: true };
      })()`,
      returnByValue: true,
    },
  );
  if (!result.result?.value?.ok) {
    throw new Error(`Autoplac paginator click failed: ${result.result?.value?.reason ?? "unknown"}`);
  }
}

async function searchOnce(session: CdpSession, page: number, brandSlug?: string): Promise<SearchHit> {
  await ensureOnList(session, brandSlug);
  session.clearSearchEvents();
  const since = Date.now();

  if (page <= 1) {
    // Fresh SSR navigation is reliable for page 1 (brand or all).
    session.clearSearchEvents();
    await session.send("Page.navigate", { url: brandListUrl(brandSlug) });
    await new Promise((r) => setTimeout(r, 2_000));
  } else {
    await clickToPage(session, page, brandSlug);
  }

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (page <= 1) {
      const ngHit = await readNgStateSearch(session);
      if (ngHit) return ngHit;
    }
    const hit = session.findSearch(page, since);
    if (hit?.done) {
      if (hit.status === 423 && !hit.body) {
        // Ignore lone 423 if a 200 sibling may still arrive.
        await new Promise((r) => setTimeout(r, 300));
        const ok = session.findSearch(page, since);
        if (ok?.status === 200) {
          for (let i = 0; i < 30 && !ok.body; i++) await new Promise((r) => setTimeout(r, 100));
          const parsedOk = parseSearchBody(ok.body);
          if (parsedOk) return parsedOk;
        }
        throw Object.assign(new Error(`Autoplac search 423 Locked for p=${page}`), { statusCode: 423 });
      }
      if (hit.status >= 400 && hit.status !== 423) {
        throw new Error(`Autoplac search HTTP ${hit.status} for p=${page}`);
      }
      for (let i = 0; i < 30 && !hit.body; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const parsed = parseSearchBody(hit.body);
      if (parsed) return parsed;
      if (page <= 1) {
        const ngHit = await readNgStateSearch(session);
        if (ngHit) return ngHit;
      }
      if (hit.status === 423) {
        throw Object.assign(new Error(`Autoplac search 423 Locked for p=${page}`), { statusCode: 423 });
      }
      throw new Error(`Autoplac search p=${page} empty body (status ${hit.status})`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Autoplac search p=${page} timed out waiting for vehicleType=PASSENGER response`);
}

let searchInFlight = 0;
let lastSearchAt = 0;
const MIN_SEARCH_GAP_MS = Math.max(
  2_500,
  Number(process.env.AUTOPLAC_CDP_SEARCH_GAP_MS || 4_000) || 4_000,
);

async function waitSearchGap(): Promise<void> {
  const wait = lastSearchAt + MIN_SEARCH_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSearchAt = Date.now();
}

/**
 * Discover one Autoplac list page through a pooled Chrome tab.
 * Pass brandSlug (e.g. "bmw") to crawl brand shards — SPA pagination works with brandModelIds.
 */
export async function autoplacSearchViaCdp(
  page: number,
  opts: { brandSlug?: string } = {},
): Promise<SearchHit> {
  const endpoint = cdpEndpoint();
  if (!endpoint) {
    throw new Error("Autoplac CDP required — set AUTOPLAC_CDP_URL or IMPORT_MOTOR_CDP_URL");
  }
  const base = endpoint.replace(/\/$/, "");
  const limit = maxCdpParallel();
  const brandSlug = opts.brandSlug?.trim().toLowerCase() || undefined;

  await new Promise<void>((resolve) => {
    const tryStart = (): void => {
      if (searchInFlight >= limit) {
        setTimeout(tryStart, 40);
        return;
      }
      searchInFlight += 1;
      resolve();
    };
    tryStart();
  });

  const tabs = await ensurePool(base);
  const tab = await acquireTab(tabs);
  try {
    const session = await sessionForTab(base, tab);
    let lastErr: Error | null = null;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await waitSearchGap();
        return await searchOnce(session, Math.max(1, page), brandSlug);
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        const locked = /423|Locked/i.test(lastErr.message);
        // 423 = rate lock — cool the tab, then either retry briefly or bail for shard rotate.
        const backoff = locked ? 10_000 * attempt : 1_000 * attempt;
        if (locked && attempt >= 2) break;
        await new Promise((r) => setTimeout(r, backoff));
        try {
          session.clearSearchEvents();
          await session.send("Page.navigate", { url: brandListUrl(brandSlug) });
          await new Promise((r) => setTimeout(r, locked ? 4_000 : 1_200));
        } catch {
          /* ignore */
        }
      }
    }
    throw lastErr ?? new Error(`Autoplac CDP search failed for p=${page}`);
  } finally {
    releaseTab(tab);
    searchInFlight = Math.max(0, searchInFlight - 1);
  }
}

function parseSearchBody(raw: string | undefined): SearchHit | null {
  if (!raw) return null;
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const offerList = Array.isArray(body.offerList) ? body.offerList : [];
    const offerCount = typeof body.offerCount === "number" ? body.offerCount : undefined;
    if (!offerList.length) return null;
    return { offerList, offerCount };
  } catch {
    return null;
  }
}

async function readNgStateSearch(session: CdpSession): Promise<SearchHit | null> {
  const ng = await session.send<{ result?: { value?: string } }>("Runtime.evaluate", {
    expression: `document.getElementById('ng-state')?.textContent || ''`,
    returnByValue: true,
  });
  const text = ng.result?.value ?? "";
  if (!text) return null;
  try {
    const state = JSON.parse(text) as Record<string, unknown>;
    const key = Object.keys(state).find((k) => /offers\/search/i.test(k));
    if (!key) return null;
    const wrap = state[key] as Record<string, unknown> | undefined;
    const body = (wrap?.body as Record<string, unknown> | undefined) ?? wrap;
    const offerList = Array.isArray(body?.offerList) ? (body.offerList as unknown[]) : [];
    const offerCount = typeof body?.offerCount === "number" ? body.offerCount : undefined;
    if (!offerList.length) return null;
    return { offerList, offerCount };
  } catch {
    return null;
  }
}
