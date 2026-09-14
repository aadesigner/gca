const r = await fetch("https://image.autowini.com/SCRIPT/mobile/js/common.js", {
  headers: { "User-Agent": "Mozilla/5.0" },
});
const t = await r.text();
const needles = ["photos", "photoCount", "thumbnail", "imagebox", "/items/", "v2api"];
for (const n of needles) {
  let idx = 0;
  let count = 0;
  while ((idx = t.indexOf(n, idx)) !== -1 && count < 5) {
    console.log(n, ":", t.slice(Math.max(0, idx - 60), idx + 80).replace(/\s+/g, " "));
    idx += n.length;
    count++;
  }
}
