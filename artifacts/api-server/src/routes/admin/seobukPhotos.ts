import { Router, type IRouter } from "express";
import { requireAdmin } from "../../middlewares/auth";
import { writeAuditLog } from "../../lib/audit";
import {
  getSeobukPhotoBackfillStatus,
  startSeobukPhotoBackfill,
  stopSeobukPhotoBackfill,
} from "../../lib/collector/backfill-seobuk-photos";

const router: IRouter = Router();

router.get("/admin/seobuk/photos/backfill", requireAdmin, (_req, res): void => {
  res.json(getSeobukPhotoBackfillStatus());
});

router.post("/admin/seobuk/photos/backfill/stop", requireAdmin, async (req, res): Promise<void> => {
  const stopped = stopSeobukPhotoBackfill();
  await writeAuditLog({
    req,
    action: "seobuk.photos.backfill.stop",
    entityType: "provider",
    entityId: "seobuk",
    details: { stopped },
  });
  res.json({ stopped, ...getSeobukPhotoBackfillStatus() });
});

router.post("/admin/seobuk/photos/backfill", requireAdmin, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const vin = typeof body.vin === "string" ? body.vin.trim().toUpperCase() : undefined;
  const listingId = Number(body.listingId);
  const started = startSeobukPhotoBackfill({
    all: body.all === true,
    limit: Number(body.limit) > 0 ? Number(body.limit) : 600,
    delayMs: Number(body.delayMs) >= 0 ? Number(body.delayMs) : 1500,
    minPhotos: Number(body.minPhotos) > 0 ? Number(body.minPhotos) : 8,
    vin: vin || undefined,
    listingId: Number.isFinite(listingId) && listingId > 0 ? listingId : undefined,
  });
  await writeAuditLog({
    req,
    action: "seobuk.photos.backfill",
    entityType: "provider",
    entityId: "seobuk",
    details: { started, vin: vin || null, listingId: Number.isFinite(listingId) ? listingId : null },
  });
  res.json({ started, ...getSeobukPhotoBackfillStatus() });
});

router.get("/admin/seobuk/debug-photos/:sourceId", requireAdmin, async (req, res): Promise<void> => {
  const sourceId = String(req.params.sourceId || "")
    .trim()
    .toUpperCase();
  if (!/^[A-F0-9]{32}$/.test(sourceId)) {
    res.status(400).json({ error: "sourceId must be a 32-char hex Seobuk id" });
    return;
  }
  try {
    const { load } = await import("cheerio");
    const { SeobukHistoricalAdapter, seobukDetailUrl, SEOBUK_WEB_BASE } = await import(
      "../../lib/providers/seobuk"
    );
    const { krFetch } = await import("../../lib/providers/kr-http");
    const adapter = new SeobukHistoricalAdapter();
    const fetched = await adapter.fetchListing(seobukDetailUrl(sourceId));
    const html = fetched.html ?? "";
    const $ = load(html);
    const parsed = await adapter.parseListing(fetched);
    const userMatches = [...html.matchAll(/images\/user\/[^"'\\\s<>]+/gi)].map((m) => m[0]);
    const cmMatches = [...html.matchAll(/img\.carmanager\.co\.kr\/[^"'\\\s<>]+/gi)].map((m) => m[0]);
    const scriptHints = [...html.matchAll(/["']([^"']*(?:photo|gallery|thumb|imageList|imgList|carImg)[^"']*)["']/gi)]
      .map((m) => m[1])
      .filter((s) => s.length < 200)
      .slice(0, 40);
    const carNo = $("#car-no").attr("data-car-no") || sourceId;
    const photoSection = html.match(/Photo information[\s\S]{0,2500}/i)?.[0] ?? null;
    const carAttrs: Record<string, string> = {};
    const el = $("#car-no");
    const raw = el.get(0) as { attribs?: Record<string, string> } | undefined;
    if (raw?.attribs) {
      for (const [k, v] of Object.entries(raw.attribs)) carAttrs[k] = String(v);
    }

    const probeUrls = [
      `${SEOBUK_WEB_BASE}/search/detail/photo/${sourceId}`,
      `${SEOBUK_WEB_BASE}/search/detail/${sourceId}/photo`,
      `${SEOBUK_WEB_BASE}/search/photo/${sourceId}`,
      `${SEOBUK_WEB_BASE}/search/ajax/photo?carNo=${encodeURIComponent(carNo)}`,
      `${SEOBUK_WEB_BASE}/search/ajax/carPhoto?carNo=${encodeURIComponent(carNo)}`,
    ];
    const probes: Array<Record<string, unknown>> = [];
    for (const probe of probeUrls) {
      try {
        const got = await krFetch(probe, { referer: seobukDetailUrl(sourceId) });
        const body = got.text;
        const users = [...body.matchAll(/images\/user\/[^"'\\\s<>]+/gi)].map((m) => m[0]);
        const cms = [...body.matchAll(/img\.carmanager\.co\.kr\/[^"'\\\s<>]+/gi)].map((m) => m[0]);
        probes.push({
          url: probe,
          status: got.status,
          len: body.length,
          user: [...new Set(users)].length,
          cm: [...new Set(cms)].length,
          sample: [...new Set([...users, ...cms])].slice(0, 8),
          head: body.slice(0, 180).replace(/\s+/g, " "),
        });
      } catch (err) {
        probes.push({
          url: probe,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const probePosts = [
      { url: `${SEOBUK_WEB_BASE}/search/imageList`, data: { carNo } },
      { url: `${SEOBUK_WEB_BASE}/search/imageListDiv`, data: { carNo } },
    ];
    for (const probe of probePosts) {
      try {
        const got = await krFetch(probe.url, {
          method: "POST",
          body: new URLSearchParams(probe.data),
          referer: seobukDetailUrl(sourceId),
          accept: "application/json, text/javascript, */*; q=0.01",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        });
        const body = got.text;
        let parsedJson: unknown = null;
        try {
          parsedJson = JSON.parse(body);
        } catch {
          /* html */
        }
        const users = [...body.matchAll(/images\/user\/[^"'\\\s<>]+/gi)].map((m) => m[0]);
        const cms = [...body.matchAll(/img\.carmanager\.co\.kr\/[^"'\\\s<>]+/gi)].map((m) => m[0]);
        probes.push({
          url: probe.url,
          method: "POST",
          status: got.status,
          len: body.length,
          user: [...new Set(users)].length,
          cm: [...new Set(cms)].length,
          sample: [...new Set([...users, ...cms])].slice(0, 12),
          jsonKeys:
            parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)
              ? Object.keys(parsedJson as object).slice(0, 30)
              : Array.isArray(parsedJson)
                ? [`array:${parsedJson.length}`]
                : null,
          head: body.slice(0, 400).replace(/\s+/g, " "),
        });
      } catch (err) {
        probes.push({
          url: probe.url,
          method: "POST",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const scriptSrcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
    const inlineAjax = [...html.matchAll(/\$\.(?:ajax|get|post|getJSON)\([\s\S]{0,500}?url\s*:\s*['"]([^'"]+)['"]/gi)].map(
      (m) => m[1],
    );
    const carImgMentions = [...html.matchAll(/car-img-div[\s\S]{0,200}|car-option-ul[\s\S]{0,200}/gi)].map((m) =>
      m[0].replace(/\s+/g, " ").slice(0, 180),
    );

    res.json({
      sourceId,
      statusCode: fetched.statusCode,
      htmlLen: html.length,
      blocked: /차단|blocked\s*ip/i.test(html),
      carAttrs,
      photoSection,
      parsedPhotos: parsed.photos ?? [],
      userMatches: [...new Set(userMatches)].slice(0, 30),
      cmMatches: [...new Set(cmMatches)].slice(0, 20),
      scriptHints: [...new Set(scriptHints)],
      scriptSrcs,
      inlineAjax: [...new Set(inlineAjax)],
      carImgMentions,
      hasImgWrap: html.includes("img-wrap"),
      hasMainImg: /id=["']main_img["']/i.test(html),
      title: parsed.title ?? null,
      vin: parsed.vehicle?.vin ?? null,
      probes,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
