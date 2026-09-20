/**
 * Carstat CDP fetch — persistent Chrome tab pool (does not reuse Import Motor tabs).
 * Shares the same debug endpoint (IMPORT_MOTOR_CDP_URL / CARSTAT_CDP_URL) and cookies.
 *
 * Env:
 *   CARSTAT_CDP_TABS      pool size (default 16, max 20)
 *   CARSTAT_CDP_PARALLEL  concurrent navigations (default = tabs, capped to tabs)
 */

type CdpResult = { url: string; status: number; text: string };

type PoolTab = {
  id: string;
  wsUrl: string;
  busy: boolean;
  ws: WebSocket | null;
  nextId: number;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
};

function cdpEndpoint(): string | undefined {
  return (
    process.env.CARSTAT_CDP_URL?.trim() ||
    process.env.IMPORT_MOTOR_CDP_URL?.trim() ||
    process.env.AUTOPLAC_CDP_URL?.trim() ||
    undefined
  );
}

export function carstatCdpConfigured(): boolean {
  return Boolean(cdpEndpoint());
}

function desiredTabs(): number {
  const raw = Number(process.env.CARSTAT_CDP_TABS ?? "16");
  if (!Number.isFinite(raw) || raw < 1) return 16;
  return Math.min(20, Math.floor(raw));
}

function maxParallel(): number {
  const tabs = desiredTabs();
  const raw = Number(process.env.CARSTAT_CDP_PARALLEL ?? String(tabs));
  if (!Number.isFinite(raw) || raw < 1) return tabs;
  return Math.min(tabs, Math.floor(raw));
}

function isCfChallenge(html: string): boolean {
  return /just a moment|cf-challenge|attention required|challenge-platform/i.test(html.slice(0, 8_000));
}

let pool: PoolTab[] | null = null;
let poolInit: Promise<PoolTab[]> | null = null;
const waiters: Array<() => void> = [];
let inFlight = 0;

function wakeWaiters(): void {
  while (waiters.length > 0) {
    const w = waiters.shift();
    if (w) w();
  }
}

async function listTargets(base: string): Promise<Array<{ id: string; type?: string; url?: string; webSocketDebuggerUrl?: string }>> {
  const res = await fetch(`${base.replace(/\/$/, "")}/json/list`);
  if (!res.ok) throw new Error(`Carstat CDP list failed: ${res.status}`);
  return (await res.json()) as Array<{ id: string; type?: string; url?: string; webSocketDebuggerUrl?: string }>;
}

async function openNewTab(base: string, url: string): Promise<{ id: string; wsUrl: string }> {
  // Chrome wants the raw URL after `?` (not encodeURIComponent).
  const endpoint = `${base.replace(/\/$/, "")}/json/new?${url}`;
  for (const method of ["PUT", "GET"] as const) {
    try {
      const res = await fetch(endpoint, { method });
      if (!res.ok) continue;
      const target = (await res.json()) as { id?: string; webSocketDebuggerUrl?: string };
      if (target?.id && target.webSocketDebuggerUrl) {
        return { id: target.id, wsUrl: target.webSocketDebuggerUrl };
      }
    } catch {
      /* try next */
    }
  }
  throw new Error(`Carstat CDP could not open a tab for ${url}`);
}

async function closeTab(base: string, id: string): Promise<void> {
  try {
    await fetch(`${base.replace(/\/$/, "")}/json/close/${id}`);
  } catch {
    /* ignore */
  }
}

async function connectWs(wsUrl: string): Promise<WebSocket> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Carstat CDP websocket connect timed out")), 15_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Carstat CDP websocket failed"));
    });
  });
  return ws;
}

function attachTab(tab: PoolTab, ws: WebSocket): void {
  tab.ws = ws;
  tab.nextId = 1;
  tab.pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    if (msg.id == null) return;
    const p = tab.pending.get(msg.id);
    if (!p) return;
    tab.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
    else p.resolve(msg.result);
  });
  ws.addEventListener("close", () => {
    for (const [, p] of tab.pending) p.reject(new Error("Carstat CDP websocket closed"));
    tab.pending.clear();
    tab.ws = null;
  });
}

async function send<T = unknown>(
  tab: PoolTab,
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 45_000,
): Promise<T> {
  if (!tab.ws || tab.ws.readyState !== WebSocket.OPEN) {
    throw new Error("Carstat CDP websocket not open");
  }
  const id = tab.nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (tab.pending.has(id)) {
        tab.pending.delete(id);
        reject(new Error(`Carstat CDP ${method} timed out`));
      }
    }, timeoutMs);
    tab.pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v as T);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    tab.ws!.send(JSON.stringify({ id, method, params }));
  });
}

async function ensurePool(base: string): Promise<PoolTab[]> {
  if (pool && pool.length > 0) return pool;
  if (poolInit) return poolInit;
  poolInit = (async () => {
    const want = desiredTabs();
    const tabs: PoolTab[] = [];
    const existing = await listTargets(base);
    for (const t of existing) {
      if (tabs.length >= want) break;
      if (t.type && t.type !== "page") continue;
      if (!t.webSocketDebuggerUrl) continue;
      // Only adopt idle about:blank / carstat tabs — never steal IM/Autoplac pages.
      const u = String(t.url ?? "");
      if (u && !/^(about:blank|chrome:\/\/newtab\/?|https?:\/\/([^/]*\.)?carstat\.info)/i.test(u)) {
        continue;
      }
      tabs.push({
        id: t.id,
        wsUrl: t.webSocketDebuggerUrl,
        busy: false,
        ws: null,
        nextId: 1,
        pending: new Map(),
      });
    }
    while (tabs.length < want) {
      const opened = await openNewTab(base, "about:blank");
      tabs.push({
        id: opened.id,
        wsUrl: opened.wsUrl,
        busy: false,
        ws: null,
        nextId: 1,
        pending: new Map(),
      });
    }
    for (const tab of tabs) {
      try {
        const ws = await connectWs(tab.wsUrl);
        attachTab(tab, ws);
        await send(tab, "Page.enable");
        await send(tab, "Runtime.enable");
      } catch {
        /* reconnect on first use */
        tab.ws = null;
      }
    }
    pool = tabs;
    return tabs;
  })().finally(() => {
    poolInit = null;
  });
  return poolInit;
}

async function acquireTab(base: string): Promise<PoolTab> {
  const tabs = await ensurePool(base);
  for (;;) {
    const free = tabs.find((t) => !t.busy);
    if (free) {
      free.busy = true;
      if (!free.ws || free.ws.readyState !== WebSocket.OPEN) {
        try {
          const ws = await connectWs(free.wsUrl);
          attachTab(free, ws);
          await send(free, "Page.enable");
          await send(free, "Runtime.enable");
        } catch (err) {
          // Tab died — open a replacement.
          try {
            await closeTab(base, free.id);
          } catch {
            /* ignore */
          }
          const opened = await openNewTab(base, "about:blank");
          free.id = opened.id;
          free.wsUrl = opened.wsUrl;
          const ws = await connectWs(opened.wsUrl);
          attachTab(free, ws);
          await send(free, "Page.enable");
          await send(free, "Runtime.enable");
        }
      }
      return free;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
}

function releaseTab(tab: PoolTab): void {
  tab.busy = false;
  wakeWaiters();
}

function pageReadyExpression(url: string): string {
  if (/\/catalog/i.test(url)) {
    // Wait for RSC flight lots payload (plain or escaped inside __next_f.push).
    // Href-only readiness races the shell and yields 0 parseable cards.
    return `(() => {
      if (/just a moment/i.test(document.title)) return false;
      const h = document.body ? document.body.innerHTML : "";
      return h.includes('"lots":[') || h.includes('\\\\"lots\\\\":[');
    })()`;
  }
  // Keep probes cheap: querySelector + short marker includes. Never use body.innerText
  // (layout + full text) or outerHTML in the poll loop — that dominated backfill latency.
  return `(() => {
    if (/just a moment/i.test(document.title)) return false;
    if (document.querySelector('script[type="application/ld+json"]')) return true;
    const h = document.body ? document.body.innerHTML : "";
    return h.includes("vehicleIdentificationNumber") || h.includes('"@type":"Vehicle"') || h.includes('"@type": "Vehicle"');
  })()`;
}

async function navigateAndRead(tab: PoolTab, url: string): Promise<CdpResult> {
  await send(tab, "Page.navigate", { url });

  const readyExpr = pageReadyExpression(url);
  const isCatalog = /\/catalog/i.test(url);
  let ready = false;
  // Probe immediately, then 40ms ticks. Cap waits so failed ready still yields HTML fast.
  // Catalog needs longer for Next flight / RSC lots payload after shell paints.
  const ticks = isCatalog ? 150 : 35;
  const tickMs = 40;
  for (let i = 0; i < ticks; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, tickMs));
    const probe = await send<{ result?: { value?: boolean } }>(tab, "Runtime.evaluate", {
      expression: readyExpr,
      returnByValue: true,
    });
    if (probe.result?.value) {
      ready = true;
      break;
    }
    if (i > 0 && i % 15 === 0) {
      const titleRes = await send<{ result?: { value?: string } }>(tab, "Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
      });
      const title = titleRes.result?.value ?? "";
      if (/just a moment|attention required/i.test(title) && i >= Math.floor(ticks * 0.7)) {
        throw new Error(`Carstat CDP stuck on Cloudflare for ${url}`);
      }
    }
  }
  if (!ready) {
    const titleRes = await send<{ result?: { value?: string } }>(tab, "Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    });
    if (/just a moment|attention required/i.test(titleRes.result?.value ?? "")) {
      throw new Error(`Carstat CDP stuck on Cloudflare for ${url}`);
    }
  }

  const htmlRes = await send<{ result?: { value?: string } }>(tab, "Runtime.evaluate", {
    expression: "document.documentElement.outerHTML",
    returnByValue: true,
  });
  const hrefRes = await send<{ result?: { value?: string } }>(tab, "Runtime.evaluate", {
    expression: "location.href",
    returnByValue: true,
  });
  const text = htmlRes.result?.value ?? "";
  if (!text || isCfChallenge(text)) {
    throw new Error(`Carstat CDP returned Cloudflare challenge for ${url}`);
  }
  return { text, status: 200, url: hrefRes.result?.value ?? url };
}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  const limit = maxParallel();
  await new Promise<void>((resolve) => {
    const wait = (): void => {
      if (inFlight < limit) {
        inFlight += 1;
        resolve();
        return;
      }
      setTimeout(wait, 25);
    };
    wait();
  });
  try {
    return await fn();
  } finally {
    inFlight = Math.max(0, inFlight - 1);
  }
}

export async function carstatGetViaCdp(url: string): Promise<CdpResult> {
  const endpoint = cdpEndpoint();
  if (!endpoint) {
    throw new Error(
      `Carstat CDP required for ${url} — set IMPORT_MOTOR_CDP_URL or CARSTAT_CDP_URL (Chrome --remote-debugging-port=9222)`,
    );
  }
  return withSlot(async () => {
    const tab = await acquireTab(endpoint);
    try {
      return await navigateAndRead(tab, url);
    } catch (err) {
      // Drop dead socket so next acquire reconnects.
      try {
        tab.ws?.close();
      } catch {
        /* ignore */
      }
      tab.ws = null;
      throw err;
    } finally {
      releaseTab(tab);
    }
  });
}

/**
 * Download a Carstat lot-image (or any authenticated asset) via the CDP tab pool.
 * Uses the logged-in Chrome session cookies — Node fetch always gets CF 403.
 */
export async function carstatFetchBinaryViaCdp(
  url: string,
): Promise<{ body: Buffer; contentType: string }> {
  const endpoint = cdpEndpoint();
  if (!endpoint) {
    throw new Error(
      `Carstat CDP required for image mirror — set IMPORT_MOTOR_CDP_URL or CARSTAT_CDP_URL`,
    );
  }
  return withSlot(async () => {
    const tab = await acquireTab(endpoint);
    try {
      const hrefRes = await send<{ result?: { value?: string } }>(tab, "Runtime.evaluate", {
        expression: "location.href",
        returnByValue: true,
      });
      const href = hrefRes.result?.value ?? "";
      if (!/carstat\.info/i.test(href)) {
        await send(tab, "Page.navigate", { url: "https://carstat.info/" });
        await new Promise((r) => setTimeout(r, 1000));
      }

      const evaluated = await send<{
        result?: {
          value?: { status?: number; ct?: string | null; b64?: string; len?: number; error?: string };
          description?: string;
        };
      }>(tab, "Runtime.evaluate", {
        expression: `(async()=>{
          try {
            const r = await fetch(${JSON.stringify(url)}, { credentials: "include" });
            const buf = await r.arrayBuffer();
            const u8 = new Uint8Array(buf);
            let s = "";
            const chunk = 0x8000;
            for (let i = 0; i < u8.length; i += chunk) {
              s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)));
            }
            return { status: r.status, ct: r.headers.get("content-type"), len: u8.length, b64: btoa(s) };
          } catch (e) {
            return { error: String(e && e.message ? e.message : e) };
          }
        })()`,
        awaitPromise: true,
        returnByValue: true,
      }, 60_000);

      const value = evaluated?.result?.value;
      if (!value || value.error) {
        throw new Error(value?.error || evaluated?.result?.description || "Carstat CDP image fetch failed");
      }
      if (value.status && value.status >= 400) {
        throw new Error(`HTTP ${value.status}`);
      }
      if (!value.b64 || !value.len || value.len < 100) {
        throw new Error(`Carstat CDP image too small (${value.len ?? 0} bytes)`);
      }
      const body = Buffer.from(value.b64, "base64");
      const contentType = (value.ct || "image/jpeg").split(";")[0]!.trim();
      return {
        body,
        contentType: contentType.startsWith("image/") ? contentType : "image/jpeg",
      };
    } catch (err) {
      try {
        tab.ws?.close();
      } catch {
        /* ignore */
      }
      tab.ws = null;
      throw err;
    } finally {
      releaseTab(tab);
    }
  });
}

