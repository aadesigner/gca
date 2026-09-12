const detailUrl = "https://www.sauto.cz/osobni/detail/hyundai/i30/211091421";
const img =
  "https://d19-a.sdn.cz/d_19/c_img_qF_A/k0OqwCKRB7OXgCijHvwogO/f507.jpeg?fl=exf|res,1024,768,1|wrm,/watermark/sauto.png,10,10|jpg,80,,1";

const page = await fetch(detailUrl, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
  },
});
const set = page.headers.getSetCookie?.() ?? [];
console.log("page cookies", set);
const cookie = set.map((c) => c.split(";")[0]).join("; ");

const tries = [
  { label: "exact-fl", url: img, headers: { Referer: detailUrl, Cookie: cookie } },
  { label: "exact-fl-no-cookie", url: img, headers: { Referer: detailUrl } },
  {
    label: "sec-fetch",
    url: img,
    headers: {
      Referer: detailUrl,
      Cookie: cookie,
      "Sec-Fetch-Dest": "image",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site",
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  },
];

for (const t of tries) {
  const r = await fetch(t.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept-Language": "cs-CZ,cs;q=0.9",
      ...t.headers,
    },
  });
  const b = Buffer.from(await r.arrayBuffer());
  console.log(t.label, r.status, r.headers.get("www-authenticate"), r.headers.get("content-type"), b.length, b.slice(0, 40).toString());
}

// Check if aaaauto (also Czech sdn?) works - compare hosts in prod for aaaauto
