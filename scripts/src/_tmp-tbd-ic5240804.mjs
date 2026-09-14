const url =
  "https://thebidrive.com/en/listing/72197a6f-d266-4d17-acb0-4ec94c8666b2/2017-honda-accord-jhmcr6650hc200324";
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
for (const ic of ["IC5240804", "IC5265489"]) {
  const idx = html.indexOf(ic);
  console.log("\n", ic, idx);
  if (idx >= 0) console.log(html.slice(Math.max(0, idx - 150), idx + 250).replace(/\s+/g, " "));
}
