const base = "https://d19-a.sdn.cz/d_19/c_img_qF_A/k0OqwCKRB7OXgCijHvwogO/f507.jpeg";
const variants = [
  base,
  `${base}?fl=jpg,80,,1`,
  `${base}?fl=res,800,600,1`,
  `${base}?fl=exf`,
  `${base}?fl=exf|jpg,80,,1`,
  `${base}?fl=exf|res,800,600,1|jpg,80,,1`,
  `${base}?fl=exf|res,1024,768,1|jpg,80,,1`,
  `${base}?fl=exf|res,1024,768,1|wrm,/watermark/sauto.png,10,10|jpg,80,,1`,
];

for (const u of variants) {
  const r = await fetch(u, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://www.sauto.cz/",
      Accept: "image/*",
    },
  });
  const b = Buffer.from(await r.arrayBuffer());
  const ok = r.status === 200 && b[0] === 0xff && b[1] === 0xd8;
  console.log(ok ? "OK " : "BAD", r.status, b.length, u.slice(base.length) || "(raw)");
}
