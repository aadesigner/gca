const url =
  "https://thebidrive.com/en/listing/b84418cc-7c42-4da3-ba17-0a65793cc40d/2023-kg-mobility-ssangyong-torres-kpbph3at1pp024362";
const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", "accept-language": "en" } });
const html = await r.text();
console.log({ status: r.status, len: html.length });

const imgs = [
  ...html.matchAll(
    /https:\/\/(?:cdn\.thebidrive\.com|ci\.encar\.com|imagebox\.autowini\.com)[^"'\\\s>]+/gi,
  ),
].map((m) => m[0]);
const uniq = [...new Set(imgs)];
console.log("cdn_urls", uniq.length);
for (const u of uniq.slice(0, 50)) console.log(u);

const og =
  html.match(/property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ??
  html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
console.log("og", og);

const encar = [...html.matchAll(/encar[/=](\d{6,})/gi)].map((m) => m[0]);
console.log("encar_refs", [...new Set(encar)].slice(0, 15));

const noPhoto = /no[- ]?photo|without.?photo|image.?not.?found|og-default/i.test(html);
console.log({ noPhotoHint: noPhoto });

// Probe first few candidate frames
for (const u of uniq.slice(0, 8)) {
  try {
    const h = await fetch(u, { method: "HEAD", signal: AbortSignal.timeout(8000) });
    console.log("HEAD", h.status, u.slice(-80));
  } catch (e) {
    console.log("HEAD FAIL", e.message, u.slice(-80));
  }
}
