for (const url of [
  "https://www.charancha.com/cars?page=1",
  "https://www.charancha.com/bu/search/list?page=1",
  "https://api.charancha.com/api/buy/list?page=1&size=20",
  "https://www.charancha.com/api/buy/list?page=1&size=20",
]) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 Chrome/122",
      Accept: "application/json, text/html",
    },
  });
  const t = await r.text();
  console.log("\n===", url, r.status, t.length);
  const next = t.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (next) {
    const data = JSON.parse(next[1]);
    const pp = data?.props?.pageProps;
    console.log("pageProps keys:", pp ? Object.keys(pp) : null);
    console.log(JSON.stringify(pp, null, 2).slice(0, 3500));
  } else if (t.startsWith("{")) {
    console.log(t.slice(0, 1500));
  }
}
