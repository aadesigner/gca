const id = "42305041";
for (const u of [
  `https://fem.encar.com/cars/detail/${id}`,
  `https://www.encar.com/dc/dc_cardetailview.do?carid=${id}`,
]) {
  try {
    const r = await fetch(u, {
      headers: { "user-agent": "Mozilla/5.0", Referer: "https://fem.encar.com/" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const t = await r.text();
    const pics = [...t.matchAll(/https?:\/\/ci\.encar\.com\/[^"'\\\s>]+/gi)].map((m) => m[0]);
    console.log({ u, status: r.status, len: t.length, pics: new Set(pics).size, sample: [...new Set(pics)].slice(0, 5) });
  } catch (e) {
    console.log({ u, err: e.message });
  }
}

// BidDrive CDN keyed frames sometimes exist even when 0.webp 404s
for (let i = 0; i < 3; i++) {
  for (const ext of ["webp", "avif", "jpg"]) {
    const u = `https://cdn.thebidrive.com/encar/${id}/${i}.${ext}`;
    try {
      const h = await fetch(u, { method: "HEAD", signal: AbortSignal.timeout(8000) });
      if (h.ok) console.log("cdn_hit", u);
    } catch {}
  }
}
