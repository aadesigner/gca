import type { IncomingMessage, ServerResponse } from "node:http";

const AUTWINI_PHOTO_HOSTS = new Set(["imagebox.autowini.com", "image.autowini.com"]);
const MAX_BYTES = 8 * 1024 * 1024;
const PREFIX = "/media/autowini";
const PREFIX_IMG = "/media/autowini-img";

function send(res: ServerResponse, status: number, body: string | Buffer, headers?: Record<string, string>) {
  if (res.headersSent || res.writableEnded) return;
  res.statusCode = status;
  if (headers) {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  }
  res.end(body);
}

function isAllowedPhotoHost(hostname: string): boolean {
  return AUTWINI_PHOTO_HOSTS.has(hostname.toLowerCase());
}

function targetFromRequest(req: IncomingMessage): string | null {
  const full = req.url ?? "";
  const qIndex = full.indexOf("?");
  const pathname = qIndex >= 0 ? full.slice(0, qIndex) : full;
  const search = qIndex >= 0 ? full.slice(qIndex) : "";

  if (pathname === "/api/admin/media/proxy") {
    const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("url") ?? "";
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "https:" && isAllowedPhotoHost(parsed.hostname)) return parsed.toString();
    } catch {
      return null;
    }
    return null;
  }

  if (!pathname.startsWith(`${PREFIX}/`) && !pathname.startsWith(`${PREFIX_IMG}/`)) return null;
  if (pathname.startsWith(`${PREFIX_IMG}/`)) {
    const rest = pathname.slice(PREFIX_IMG.length);
    if (!rest.startsWith("/") || rest.includes("..") || rest.includes("//")) return null;
    try {
      const parsed = new URL(`https://image.autowini.com${rest}${search}`);
      if (parsed.protocol !== "https:" || !isAllowedPhotoHost(parsed.hostname)) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }
  const rest = pathname.slice(PREFIX.length);
  if (!rest.startsWith("/upload/") || rest.includes("..") || rest.includes("//")) return null;
  try {
    const parsed = new URL(`https://imagebox.autowini.com${rest}${search}`);
    if (parsed.protocol !== "https:" || !isAllowedPhotoHost(parsed.hostname)) return null;
    if (!parsed.pathname.startsWith("/upload/")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function fetchImage(target: string): Promise<{ status: number; contentType: string; body: Buffer } | null> {
  let current = target;
  for (let hop = 0; hop < 4; hop++) {
    const upstream = await fetch(current, {
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "image/jpeg,image/webp,image/png,image/*,*/*;q=0.8",
        Referer: "https://www.autowini.com/",
        Origin: "https://www.autowini.com",
      },
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location");
      if (!location) return null;
      const nextUrl = new URL(location, current);
      if (nextUrl.protocol !== "https:" || !isAllowedPhotoHost(nextUrl.hostname)) return null;
      current = nextUrl.toString();
      continue;
    }
    if (upstream.status !== 200) return null;
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) return null;
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length === 0 || body.length > MAX_BYTES) return null;
    return { status: 200, contentType, body };
  }
  return null;
}

export async function proxyAutowiniPhoto(
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
): Promise<void> {
  const target = targetFromRequest(req);
  if (!target) {
    send(res, 400, "Unsupported media URL");
    return;
  }
  try {
    const image = await fetchImage(target);
    if (!image) {
      send(res, 502, "Upstream media unavailable");
      return;
    }
    send(res, 200, image.body, {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    });
  } catch {
    next();
  }
}

function attach(server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void) => void } }) {
  server.middlewares.use((req, res, next) => {
    const pathname = (req.url ?? "").split("?")[0] ?? "";
    if (
      pathname.startsWith(`${PREFIX}/`) ||
      pathname.startsWith(`${PREFIX_IMG}/`) ||
      pathname === "/api/admin/media/proxy"
    ) {
      void proxyAutowiniPhoto(req, res, next);
      return;
    }
    next();
  });
}

export function autowiniPhotoProxyPlugin() {
  return {
    name: "autowini-photo-proxy",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
