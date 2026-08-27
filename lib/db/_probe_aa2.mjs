import https from "https";
import http from "http";
import { writeFileSync } from "fs";

function get(url, redirects = 0) {
  return new Promise((res, rej) => {
    const lib = url.startsWith("https") ? https : http;
    lib
      .get(
        url,
        {
          headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            accept: "text/html,application/json",
            "accept-language": "en",
          },
          timeout: 30000,
        },
        (r) => {
          if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && redirects < 5) {
            const next = new URL(r.headers.location, url).href;
            return res(get(next, redirects + 1));
          }
          const chunks = [];
          r.on("data", (c) => chunks.push(c));
          r.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            res({ status: r.statusCode, url, body, headers: r.headers });
          });
        },
      )
      .on("error", rej);
  });
}

const id = "67c74659b790f06fe91bdef1";
const api = await get(`https://auctionauto.org/api/catalog/${id}`);
const item = JSON.parse(api.body);
writeFileSync("_aa_detail.json", JSON.stringify(item, null, 2));
console.log("api odo", item.odometer, "vin", item.vin, "title", item.title);
console.log(
  "all numeric-ish",
  Object.fromEntries(
    Object.entries(item).filter(
      ([, v]) => typeof v === "number" || (typeof v === "string" && /\d/.test(v) && String(v).length < 40),
    ),
  ),
);

const page = await get(`https://auctionauto.org/catalog/vehicle/${id}`);
console.log("page", page.status, page.url, page.body.length);
writeFileSync("_aa_page.html", page.body.slice(0, 500000));
const nuxt = page.body.match(/window\.__NUXT__=([\s\S]*?)<\/script>/);
if (nuxt) {
  const text = nuxt[1];
  for (const re of [/odometer.{0,80}/gi, /mileage.{0,80}/gi, /\d{4,7}\s*k\.?m/gi, /"km"\s*:\s*\d+/gi]) {
    console.log(re, [...text.matchAll(re)].slice(0, 8).map((m) => m[0]));
  }
} else {
  console.log("no nuxt; body sample", page.body.slice(0, 500));
}

// USA auction sample with real odo - verify our parser path
const auction = JSON.parse((await get("https://auctionauto.org/api/auction?limit=5&offset=0")).body);
for (const it of auction.items || []) {
  console.log("usa", { title: it.title, odo: it.odometer, vin: it.vin });
}
