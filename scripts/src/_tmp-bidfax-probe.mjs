const urls = [
  "https://bidfax.info/",
  "https://bidfax.info/robots.txt",
  "https://en.bidfax.info/",
  "https://bidfax.info/?do=search&q=toyota",
];
for (const url of urls) {
  try {
    const r = await fetch(url, {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const text = await r.text();
    const headers = Object.fromEntries([...r.headers.entries()].filter(([k]) =>
      /cf-|server|set-cookie|location|content-type|x-|/i.test(k)
    ));
    const lower = text.toLowerCase();
    console.log("\n===", url, r.status, "len", text.length);
    console.log("headers", headers);
    console.log("signals", {
      cloudflare: /cloudflare|cf-ray|just a moment|attention required/i.test(text) || !!r.headers.get("cf-ray"),
      captcha: /captcha|recaptcha|hcaptcha|turnstile/i.test(lower),
      login: /login|sign in|password|auth/i.test(lower) && /form/i.test(lower),
      title: (text.match(/<title[^>]*>([^<]*)/i)?.[1] || "").trim().slice(0, 120),
      hasVinSearch: /vin|lot|copart|iaai/i.test(lower),
      robotsSnippet: url.includes("robots") ? text.slice(0, 500) : undefined,
    });
  } catch (e) {
    console.log("FAIL", url, e.message);
  }
}
