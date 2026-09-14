const url = process.argv[2];
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
const apis = [...html.matchAll(/https:\\\/\\\/api\.thebidrive\.com[^"\\]+/g)].map((m) =>
  m[0].replace(/\\\//g, "/"),
);
console.log("escaped api", [...new Set(apis)].slice(0, 5));
const plain = [...html.matchAll(/https:\/\/api\.thebidrive\.com[^"'\\\s]+/g)].map((m) => m[0]);
console.log("plain api", [...new Set(plain)].slice(0, 5));
const uuid = url.match(/([a-f0-9-]{36})/i)?.[1];
if (uuid) {
  for (const base of ["https://api.thebidrive.com", "https://thebidrive.com/api"]) {
    for (const path of [`/listings/${uuid}`, `/listing/${uuid}`, `/en/listings/${uuid}`]) {
      const u = base + path;
      const res = await fetch(u, { headers: { Accept: "application/json" } });
      console.log(u, res.status, (await res.text()).slice(0, 200));
    }
  }
}
