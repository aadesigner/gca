const PROD = process.env.PROD_API_URL || "https://getcarapi.com";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const sourceId = process.argv[2] || "C6EE310DB77E790F0A7716C9CD800D98";

const login = await fetch(`${PROD}/api/admin/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

// Reuse kr fetch indirectly: ask debug, then also hit a new lightweight HTML analysis via login + custom?
// Instead, call debug and also request the detail HTML through a tiny admin helper if present.
const debug = await fetch(`${PROD}/api/admin/seobuk/debug-photos/${sourceId}`, {
  headers: { Cookie: cookie },
  signal: AbortSignal.timeout(90_000),
});
const data = await debug.json();
console.log(
  JSON.stringify(
    {
      vin: data.vin,
      parsed: data.parsedPhotos?.length,
      parsedUrls: data.parsedPhotos?.map((p) => p.sourceUrl),
      probes: data.probes,
      carAttrs: data.carAttrs,
      photoSectionHasImgs: (data.photoSection || "").match(/<img/gi)?.length ?? 0,
    },
    null,
    2,
  ),
);

// Fetch public JS candidates that might populate #car-img-div
const bases = ["https://www.seobuk.org", "https://www.seobuk.org/assets", "https://www.seobuk.org/assets/admin"];
const names = [
  "/js/common.js",
  "/js/search.js",
  "/js/detail.js",
  "/custom/js/common.js",
  "/admin/js/common.js",
  "/admin/js/search.js",
  "/admin/js/detail.js",
  "/admin/js/car.js",
  "/js/car.js",
];
for (const base of bases) {
  for (const name of names) {
    const url = base.replace(/\/$/, "") + name;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!r.ok) continue;
      const t = await r.text();
      if (/car-img-div|thumnail|thumbnailImage|getPhoto|carImg/i.test(t)) {
        console.log("HIT", url, "len", t.length);
        const lines = t.split(/\n/).filter((l) => /car-img-div|thumnail|getPhoto|photo|ajax|images\/user/i.test(l));
        console.log(lines.slice(0, 30).join("\n").slice(0, 2500));
      }
    } catch {
      /* ignore */
    }
  }
}
