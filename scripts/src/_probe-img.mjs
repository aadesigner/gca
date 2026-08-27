const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function grab(name, url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  const t = await res.text();
  const next = t.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  let info = { name, status: res.status, len: t.length, hasNext: !!next };
  if (next) {
    const j = JSON.parse(next[1]);
    const pp = j.props?.pageProps ?? {};
    info.pageKeys = Object.keys(pp);
    const det = pp.listingDetails ?? pp.listing ?? pp.advert ?? null;
    if (det) {
      info.detKeys = Object.keys(det).slice(0, 40);
      info.imagesType = Array.isArray(det.images) ? det.images.length : typeof det.images;
      info.image0 = det.images?.[0] ? JSON.stringify(det.images[0]).slice(0, 400) : null;
      info.media = det.media ? Object.keys(det.media) : null;
      info.brand = det.brand ?? det.vehicle?.make ?? det.make;
      info.model = det.model ?? det.vehicle?.model;
      info.price = det.price ?? det.prices;
    }
    const pics = [...t.matchAll(/https:\/\/[^"'\\]+\.(?:jpe?g|webp)/gi)].slice(0, 5);
    info.imgSamples = pics.map(m => m[0].slice(0, 120));
    const as24 = [...t.matchAll(/https:\/\/[^"'\\\s]+(?:prod\.pictures|azureedge|autoscout24)[^"'\\\s]*/gi)].slice(0, 8);
    info.as24cdn = as24.map(m => m[0].slice(0, 160));
  }
  const og = t.match(/property="og:image"[^>]+content="([^"]+)"/i)?.[1];
  info.ogImage = og;
  const h1 = t.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()?.slice(0,80);
  info.h1 = h1;
  console.log(JSON.stringify(info, null, 2));
}

await grab("as24", "https://www.autoscout24.com/offers/mercedes-benz-gle-400-d-4m-9g-amg-pano-multib-np-105te-diesel-grey-cat_ma47mo20921-bd0b1d88-457c-4630-88d4-8c1ae70f047c");
await grab("oto", "https://www.otomoto.pl/osobowe/oferta/seat-ateca-ID6IcXMp.html");
