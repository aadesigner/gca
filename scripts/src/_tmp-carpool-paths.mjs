const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131";
const urls = [
  "https://www.carpoolkr.com/",
  "https://www.carpoolkr.com/cars",
  "https://www.carpoolkr.com/Cars",
  "https://www.carpoolkr.com/en/Search?type=Car",
  "https://www.carpoolkr.com/Search",
  "https://carpoolkr.com/Search?type=Car&vehicle=Car&page=1",
];
for (const url of urls) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    const t = await r.text();
    const cars = [...t.matchAll(/\/Cars\/Show\/CAR\d+/gi)].length;
    const search = [...t.matchAll(/href=["']([^"']*Search[^"']*)["']/gi)].slice(0, 5).map((m) => m[1]);
    console.log(JSON.stringify({ url: r.url, status: r.status, len: t.length, carsShow: cars, searchLinks: search }));
  } catch (e) {
    console.log(JSON.stringify({ url, err: e.message }));
  }
}
