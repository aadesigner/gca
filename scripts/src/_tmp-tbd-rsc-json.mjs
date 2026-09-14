const url =
  "https://thebidrive.com/en/listing/72197a6f-d266-4d17-acb0-4ec94c8666b2/2017-honda-accord-jhmcr6650hc200324";
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
const uuid = "72197a6f-d266-4d17-acb0-4ec94c8666b2";
const idx = html.indexOf(uuid);
const chunk = html.slice(Math.max(0, idx - 500), idx + 4000);
const ic = chunk.match(/IC(\d{7})/)?.[0];
console.log("ic near uuid", ic);
const images = [...chunk.matchAll(/https:\\\/\\\/cdn\.thebidrive\.com[^"\\]+/g)].map((m) =>
  m[0].replace(/\\u002F/g, "/").replace(/\\\//g, "/"),
);
console.log("escaped cdn urls", images.slice(0, 10));
const plain = [...chunk.matchAll(/https:\/\/cdn\.thebidrive\.com[^"\\]+/g)].map((m) => m[0]);
console.log("plain cdn urls", plain.slice(0, 10));
console.log("chunk sample", chunk.slice(0, 1200));
