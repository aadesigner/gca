/**
 * Carstat CDP fetch — dedicated Chrome tabs (does not reuse Import Motor pool tabs).
 * Shares the same debug endpoint (IMPORT_MOTOR_CDP_URL / CARSTAT_CDP_URL) and cookies.
 */

type CdpResult = { url: string; status: number; text: string };

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

function isCfChallenge(html: string): boolean {
  return /just a moment|cf-challenge|attention required|challenge-platform/i.test(html.slice(0, 8_000));
}

let inFlight = 0;
const MAX_PARALLEL = Math.max(1, Math.min(3, Number(process.env.CARSTAT_CDP_PARALLEL || 2) || 2));

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => {
    const wait = (): void => {
      if (inFlight < MAX_PARALLEL) {
        inFlight += 1;
        resolve();
        return;
      }
      setTimeout(wait, 40);
    };
    wait();
  });
  try {
    return await fn();
  } finally {
    inFlight = Math.max(0, inFlight - 1);
  }
}

async function openTab(base: string, url: string): Promise<{ id: string; wsUrl: string }> {
  const endpoint = `${base.replace(/\/$/, "")}/json/new?${encodeURIComponent(url)}`;
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

function pageReadyExpression(url: string): string {
  if (/\/catalog/i.test(url)) {
    return `(!/just a moment/i.test(document.title)) && (/\\/lot\\//.test(document.documentElement.outerHTML) || document.documentElement.outerHTML.includes('"lots":['))`;
  }
  return `(!/just a moment/i.test(document.title)) && (/application\\/ld\\+json/i.test(document.documentElement.outerHTML) || /\\b[A-HJ-NPR-Z0-9]{17}\\b/.test(document.body?.innerText||''))`;
}

async function readTab(wsUrl: string, url: string): Promise<CdpResult> {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

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

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    if (msg.id == null) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
    else p.resolve(msg.result);
  });

  const send = <T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 60_000): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Carstat CDP ${method} timed out`));
        }
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  try {
    await send("Page.enable");
    await send("Runtime.enable");
    // json/new already navigates; re-navigate to be sure we land on the target.
    await send("Page.navigate", { url });

    const readyExpr = pageReadyExpression(url);
    let ready = false;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 700));
      const probe = await send<{ result?: { value?: boolean } }>("Runtime.evaluate", {
        expression: readyExpr,
        returnByValue: true,
      });
      if (probe.result?.value) {
        ready = true;
        break;
      }
      const titleRes = await send<{ result?: { value?: string } }>("Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
      });
      const title = titleRes.result?.value ?? "";
      if (/just a moment|attention required/i.test(title) && i === 49) {
        throw new Error(`Carstat CDP stuck on Cloudflare for ${url}`);
      }
    }
    if (!ready) {
      // Soft-accept: title cleared CF; content may still be useful.
      const titleRes = await send<{ result?: { value?: string } }>("Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
      });
      if (/just a moment|attention required/i.test(titleRes.result?.value ?? "")) {
        throw new Error(`Carstat CDP stuck on Cloudflare for ${url}`);
      }
    }

    const htmlRes = await send<{ result?: { value?: string } }>("Runtime.evaluate", {
      expression: "document.documentElement.outerHTML",
      returnByValue: true,
    });
    const hrefRes = await send<{ result?: { value?: string } }>("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    });
    const text = htmlRes.result?.value ?? "";
    if (!text || isCfChallenge(text)) {
      throw new Error(`Carstat CDP returned Cloudflare challenge for ${url}`);
    }
    return { text, status: 200, url: hrefRes.result?.value ?? url };
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
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
    const tab = await openTab(endpoint, url);
    try {
      return await readTab(tab.wsUrl, url);
    } finally {
      await closeTab(endpoint, tab.id);
    }
  });
}
