const vin = "5XYPH4A57GG162866";
const html = await (
  await fetch(`https://bidscan.vin/cars/${vin}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(25_000),
  })
).text();
const cut = html.search(/Similar\s+Lots/i);
console.log({ len: html.length, cut });
const lower = html.toLowerCase();
let i = 0;
while ((i = lower.indexOf(">condition<", i)) >= 0) {
  console.log({
    kind: "exact",
    pos: i,
    afterSimilar: i > cut,
    snip: html.slice(i, i + 100).replace(/\s+/g, " "),
  });
  i += 10;
}
i = 0;
while ((i = lower.indexOf("condition:", i)) >= 0) {
  const snip = html.slice(i, i + 80);
  if (/schema\.org/i.test(snip)) {
    i += 10;
    continue;
  }
  console.log({
    kind: "colon",
    pos: i,
    afterSimilar: i > cut,
    snip: snip.replace(/\s+/g, " "),
  });
  i += 10;
}
