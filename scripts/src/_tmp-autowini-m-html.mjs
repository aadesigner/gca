import fs from "node:fs";

const id = process.argv[2] || "IC5494339";
const r = await fetch(`https://m.autowini.com/s/item/${id}`, {
  headers: {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    Accept: "text/html",
  },
});
const html = await r.text();
fs.writeFileSync("scripts/src/_tmp-autowini-m.html", html);

const imagebox = [...html.matchAll(/https?:\\\/\\\/imagebox\.autowini\.com[^"'\\\s]+/gi)].map((m) =>
  m[0].replace(/\\+/g, ""),
);
const imagebox2 = [...html.matchAll(/https?:\/\/imagebox\.autowini\.com[^"'\\\s<>]+/gi)].map((m) => m[0]);
const all = [...new Set([...imagebox, ...imagebox2])];
console.log("unique imagebox", all.length);
console.log(all.slice(0, 25));

const photoCount = html.match(/photoCount[^0-9]{0,10}(\d+)/i);
console.log("photoCount in html", photoCount?.[1]);

const apiPaths = [...html.matchAll(/\/items\/[^"'\\\s]+/g)].map((m) => m[0]).slice(0, 20);
console.log("api paths sample", [...new Set(apiPaths)].slice(0, 10));
