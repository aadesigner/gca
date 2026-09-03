const html = await (
  await fetch("https://getcarapi.com/api/admin/seobuk/debug-photos/C6EE310DB77E790F0A7716C9CD800D98", {
    headers: {
      Cookie: await (async () => {
        const login = await fetch("https://getcarapi.com/api/admin/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: process.env.ADMIN_EMAIL,
            password: process.env.ADMIN_PASSWORD,
          }),
        });
        return (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
      })(),
    },
  })
).then((r) => r.json());

// We don't have raw HTML from debug. Probe likely detail scripts.
const candidates = [
  "https://www.seobuk.org/assets/admin/js/search.js",
  "https://www.seobuk.org/assets/admin/js/detail.js",
  "https://www.seobuk.org/assets/admin/js/car_detail.js",
  "https://www.seobuk.org/assets/admin/js/car.js",
  "https://www.seobuk.org/assets/admin/js/export.js",
  "https://www.seobuk.org/assets/admin/js/view.js",
  "https://www.seobuk.org/assets/admin/js/product.js",
  "https://www.seobuk.org/assets/admin/js/product_detail.js",
  "https://www.seobuk.org/assets/admin/custom/js/common.js",
  "https://www.seobuk.org/assets/custom/js/common.js",
  "https://www.seobuk.org/assets/admin/js/jquery.common.js",
  "https://www.seobuk.org/assets/admin/js/ui.js",
];

for (const url of candidates) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) {
      console.log(r.status, url);
      continue;
    }
    const t = await r.text();
    const hit = /car-img-div|car-option-ul|thumnail|images\/user|getCarImage|carImg|img_list/i.test(t);
    console.log("OK", url, "len", t.length, "hit", hit);
    if (hit) {
      for (const needle of ["car-img-div", "car-option-ul", "img_list", "images/user", "$.ajax", "$.post", "$.get"]) {
        let i = t.indexOf(needle);
        if (i >= 0) console.log(t.slice(Math.max(0, i - 80), i + 350), "\n----");
      }
    }
  } catch (e) {
    console.log("ERR", url, e.message);
  }
}

console.log("debug vin", html.vin, "photos", html.parsedPhotos?.length);
