const url = process.argv[2];
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
const idx = html.indexOf("getListing");
console.log("getListing at", idx);
if (idx > 0) {
  const chunk = html.slice(idx, idx + 8000);
  const images = [...chunk.matchAll(/https:\\\/\\\/cdn\.thebidrive\.com[^"\\]+/g)].map((m) =>
    m[0].replace(/\\\//g, "/"),
  );
  console.log("images in chunk", images.length, images.slice(0, 15));
  const ic = chunk.match(/IC\d{7}/)?.[0];
  console.log("ic", ic);
}
