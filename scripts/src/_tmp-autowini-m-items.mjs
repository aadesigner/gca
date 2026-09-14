const id = process.argv[2] || "IC5494339";
const r = await fetch(`https://m.autowini.com/items/${id}`, {
  headers: {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    Accept: "text/html",
  },
});
const html = await r.text();
console.log("status", r.status, "len", html.length);
const imgs = [...html.matchAll(/https?:\/\/imagebox\.autowini\.com[^"'\\\s<>]+/gi)].map((m) => m[0]);
const unique = [...new Set(imgs.map((u) => u.replace(/_320\./, "_720.")))];
console.log("unique imgs", unique.length);
console.log(unique.slice(0, 25));
