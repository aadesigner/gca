const BASE = "https://getcarapi.com";
const html = await fetch(`${BASE}/account/`).then((r) => r.text());
const assetMatch = html.match(/account\.js\?v=([^"']+)/);
const v = assetMatch?.[1] ?? "x";
console.log("asset version:", v);
const js = await fetch(`${BASE}/assets/account.js?v=${v}`).then((r) => r.text());
console.log("has authfix string:", js.includes("20260902authfix"));
console.log("post-register login comment:", js.includes("Register can return 201"));
for (const m of js.matchAll(/Could not[^"'\n]{0,80}/g)) {
  console.log("msg:", m[0]);
}
for (const m of js.matchAll(/open your account[^"'\n]{0,80}/gi)) {
  console.log("open:", m[0]);
}
