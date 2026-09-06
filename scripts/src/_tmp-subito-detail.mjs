const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const url = "https://www.subito.it/auto/renault-kangoo-messina-659735227.htm";
const res = await fetch(url, {
  headers: { "User-Agent": UA, "Accept-Language": "it-IT,it;q=0.9" },
  signal: AbortSignal.timeout(25000),
});
const html = await res.text();
const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
const next = m ? JSON.parse(m[1]) : null;
const pp = next?.props?.pageProps;
console.log("status", res.status, "pageProps keys", pp && Object.keys(pp));
function walk(obj, path = "", depth = 0, out = []) {
  if (!obj || typeof obj !== "object" || depth > 6) return out;
  if (Array.isArray(obj)) {
    if (obj.length && obj[0] && typeof obj[0] === "object" && ("subject" in obj[0] || "features" in obj[0] || "urn" in obj[0])) {
      out.push(path + `[arr ${obj.length}] sample keys ${Object.keys(obj[0]).slice(0, 10)}`);
    }
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (/^(ad|item|advert|listing)$/i.test(k) || k === "features" || k === "subject") {
      out.push(`${p} type=${typeof v} ${v && typeof v === "object" ? "keys=" + Object.keys(v).slice(0, 15) : String(v).slice(0, 60)}`);
    }
    if (v && typeof v === "object" && !Array.isArray(v)) walk(v, p, depth + 1, out);
  }
  return out;
}
console.log(walk(pp).slice(0, 40).join("\n"));
const state = pp?.initialState;
console.log("initialState keys", state && Object.keys(state));
if (state) {
  for (const [k, v] of Object.entries(state)) {
    if (v && typeof v === "object") console.log(" state." + k, Object.keys(v).slice(0, 20));
  }
}
