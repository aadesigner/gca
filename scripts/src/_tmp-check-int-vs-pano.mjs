const stock = "46585942";
const urls = [
  `https://vis.iaai.com/resizer?imageKeys=${stock}~SID~INT~I1&width=845&height=633`,
  `https://vis.iaai.com/resizer?imageKeys=${stock}~SID~STP~I1&width=845&height=633`,
  `https://mediaretriever.iaai.com/api/InteriorImageRetriever?tenant=iaai&partitionKey=${stock}`,
  `https://mediaretriever.iaai.com/api/ThreeSixtyImageRetriever?tenant=iaai&partitionKey=${stock}&imageOrder=1`,
];
const UA = "Mozilla/5.0";
for (const u of urls) {
  const r = await fetch(u, {
    method: "HEAD",
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
    headers: { "User-Agent": UA },
  });
  console.log({
    status: r.status,
    ct: r.headers.get("content-type"),
    len: r.headers.get("content-length"),
    u: u.slice(0, 110),
  });
}
const viewer = await fetch(
  `https://vis.iaai.com/Home/ThreeSixtyView?keys=SID-${stock}~STP-1~INT-1&iframeview=true`,
  { signal: AbortSignal.timeout(15000), headers: { "User-Agent": UA } },
).then((r) => r.text());
console.log({
  viewerLen: viewer.length,
  amountX: viewer.match(/data-amount-x=["'](\d+)["']/i)?.[1],
  interiorApi: viewer.includes("InteriorImageRetriever"),
  intKey: /INT/i.test(viewer),
  snips: [...viewer.matchAll(/InteriorImageRetriever[^"'\s]{0,80}|data-[a-z-]+=["'][^"']*int[^"']*/gi)]
    .slice(0, 8)
    .map((m) => m[0]),
});

// Download first bytes / sizes via GET range to compare INT vs STP identity
async function fingerprint(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Range: "bytes=0-2047" },
    signal: AbortSignal.timeout(10000),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let h = 0;
  for (let i = 0; i < buf.length; i++) h = (h * 33 + buf[i]) >>> 0;
  return { status: r.status, bytes: buf.length, hash: h.toString(16), cl: r.headers.get("content-length") };
}
console.log("INT fp", await fingerprint(urls[0]));
console.log("STP fp", await fingerprint(urls[1]));
console.log("PANO fp", await fingerprint(urls[2]));
