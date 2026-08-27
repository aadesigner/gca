import https from "https";
import { writeFileSync } from "fs";

function get(url, redirects = 0) {
  return new Promise((res, rej) => {
    https
      .get(
        url,
        {
          headers: {
            "user-agent": "Mozilla/5.0",
            accept: "text/html",
            "accept-language": "en",
          },
          timeout: 30000,
        },
        (r) => {
          if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && redirects < 5) {
            return res(get(new URL(r.headers.location, url).href, redirects + 1));
          }
          const chunks = [];
          r.on("data", (c) => chunks.push(c));
          r.on("end", () => res({ status: r.statusCode, url, body: Buffer.concat(chunks).toString("utf8") }));
        },
      )
      .on("error", rej);
  });
}

const id = "67c74659b790f06fe91bdef1";
const page = await get(`https://auctionauto.org/catalog/vehicle/${id}`);
const m = page.body.match(/<script>\s*window\.__NUXT__=([\s\S]*?)<\/script>/);
if (!m) {
  console.log("no nuxt");
  process.exit(1);
}

let nuxt;
try {
  nuxt = new Function(`return ${m[1]}`)();
} catch (e) {
  console.log("eval fail", e.message);
  // try to find vehicle by id in raw
  const idx = m[1].indexOf(id);
  console.log("id idx", idx);
  console.log(m[1].slice(Math.max(0, idx - 200), idx + 800));
  process.exit(0);
}

writeFileSync("_aa_nuxt_keys.json", JSON.stringify(Object.keys(nuxt), null, 2));
const dump = JSON.stringify(nuxt);
const idIdx = dump.indexOf(id);
console.log("id in dump", idIdx);
console.log(dump.slice(Math.max(0, idIdx - 300), idIdx + 1200));

// walk for objects containing this _id
function walk(node, path = "") {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((x, i) => walk(x, `${path}[${i}]`));
    return;
  }
  if (node._id === id || node.id === id) {
    console.log("FOUND at", path);
    console.log(
      JSON.stringify(
        {
          _id: node._id,
          title: node.title,
          odometer: node.odometer,
          mileage: node.mileage,
          vin: node.vin,
          keys: Object.keys(node),
        },
        null,
        2,
      ),
    );
  }
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === "object") walk(v, path ? `${path}.${k}` : k);
  }
}
walk(nuxt);
