#!/usr/bin/env node
const id = process.argv[2] || "C6EE310DB77E790F0A7716C9CD800D98";
const url = `https://www.seobuk.org/search/detail/${id}`;
const r = await fetch(url, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
  },
  signal: AbortSignal.timeout(35_000),
});
const t = await r.text();
const user = [...t.matchAll(/https?:\/\/(?:www\.)?seobuk\.org\/assets\/admin\/images\/user\/[^"'\\\s<>]+/gi)].map(
  (m) => m[0],
);
const cm = [...t.matchAll(/https?:\/\/(?:www\.)?img\.carmanager\.co\.kr\/[^"'\\\s<>]+/gi)].map((m) => m[0]);
const scripts = [...t.matchAll(/src=["']([^"']+\.js[^"']*)["']/gi)].map((m) => m[1]);
const ajax = [...t.matchAll(/["'](\/[^"']*(?:photo|gallery|thumb|imageList|imgList)[^"']*)["']/gi)].map((m) => m[1]);
console.log(
  JSON.stringify(
    {
      status: r.status,
      len: t.length,
      blocked: /차단|blocked\s*ip/i.test(t),
      user: [...new Set(user)].length,
      cm: [...new Set(cm)].length,
      userUrls: [...new Set(user)].slice(0, 20),
      cmUrls: [...new Set(cm)].slice(0, 10),
      scripts: scripts.slice(0, 25),
      ajax: [...new Set(ajax)].slice(0, 25),
      hasImgWrap: t.includes("img-wrap"),
      hasMain: /id=["']main_img["']/i.test(t),
    },
    null,
    2,
  ),
);
