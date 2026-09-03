const id = "C6EE310DB77E790F0A7716C9CD800D98";
const target = `https://www.seobuk.org/search/detail/${id}`;
const proxies = [
  `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
  `https://corsproxy.io/?${encodeURIComponent(target)}`,
];

for (const u of proxies) {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(30_000) });
    const t = await r.text();
    const blocked = /차단된|blocked\s*ip/i.test(t);
    const user = [...t.matchAll(/seobuk\.org\/assets\/admin\/images\/user\/[^"'\\\s<>]+/gi)].map((m) => m[0]);
    const cm = [...t.matchAll(/img\.carmanager\.co\.kr\/[^"'\\\s<>]+/gi)].map((m) => m[0]);
    console.log({
      proxy: u.slice(0, 48),
      status: r.status,
      len: t.length,
      blocked,
      user: user.length,
      cm: cm.length,
    });
    if (user[0]) console.log("sample user", user.slice(0, 5));
    if (cm[0]) console.log("sample cm", cm.slice(0, 5));
    const scripts = [...t.matchAll(/src=["']([^"']+\.js[^"']*)["']/gi)].map((m) => m[1]).slice(0, 30);
    console.log("scripts", scripts);
    const photoHints = [...t.matchAll(/["'](\/[^"']*(?:photo|image|gallery|thumb|img)[^"']*)["']/gi)]
      .map((m) => m[1])
      .filter((s) => !/\.(png|jpe?g|gif|webp|svg)$/i.test(s))
      .slice(0, 40);
    console.log("photoHints", [...new Set(photoHints)].slice(0, 25));
    const main = t.match(/id=["']main_img["'][^>]*value=["']([^"']+)["']/i);
    console.log("main_img", main?.[1] ?? null);
    const imgWrap = (t.match(/class=["'][^"']*img-wrap[^"']*["'][\s\S]{0,2000}/i) || [""])[0].slice(0, 500);
    console.log("img-wrap snippet", imgWrap);
  } catch (e) {
    console.log(u.slice(0, 48), e instanceof Error ? e.message : e);
  }
}
