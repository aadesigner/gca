import fs from "node:fs";

const h = fs.readFileSync(`${process.env.TEMP}/carstat-catalog.html`, "utf8");
const i = h.indexOf("lots");
console.log("lots_idx", i);
console.log("around", h.slice(Math.max(0, i - 40), i + 250));

const hrefs = [...h.matchAll(/href="(\/lot\/[^"]+)"/g)].map((x) => x[1]);
console.log("lot_hrefs", hrefs.length);
console.log(hrefs.slice(0, 5));

const pages = [...h.matchAll(/\/catalog\/page\/(\d+)/g)].map((x) => Number(x[1]));
console.log("max_page", pages.length ? Math.max(...pages) : null);

// Unescape next_f payloads and find lots
const pushes = [...h.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g)].map((m) => {
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
});
console.log("pushes", pushes.length);
const withLots = pushes.find((p) => typeof p === "string" && p.includes('"lots":['));
if (withLots) {
  const idx = withLots.indexOf('"lots":[');
  console.log("found lots in push, around:", withLots.slice(idx, idx + 400));
  // extract array
  let start = withLots.indexOf("[", idx);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < withLots.length; j++) {
    const c = withLots[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        const arr = JSON.parse(withLots.slice(start, j + 1));
        console.log("parsed_lots", arr.length);
        console.log("keys", Object.keys(arr[0] || {}));
        console.log("sample", JSON.stringify(arr[0], null, 2));
        console.log("sample2", JSON.stringify(arr[1], null, 2));
        break;
      }
    }
  }
}
