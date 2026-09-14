const id = "IC5494339";
const base = {
  "User-Agent": "Mozilla/5.0 (iPhone)",
  Accept: "application/json",
  Origin: "https://m.autowini.com",
  "wini-code-select-country": "C1570",
};

const paramSets = [
  { condition: "C020", keyword: id, pageSize: 5, includePhotos: true },
  { condition: "C020", keyword: id, pageSize: 5, photoDetail: true },
  { condition: "C020", keyword: id, pageSize: 5, detailPhoto: true },
  { condition: "C020", keyword: id, pageSize: 5, fullPhoto: true },
  { condition: "C020", listingId: id },
  { condition: "C020", itemCode: "CI202609130005303570" },
];

for (const params of paramSets) {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
  const r = await fetch(`https://v2api.autowini.com/items/cars?${qs}`, { headers: base });
  const j = await r.json();
  const item = j.data?.items?.[0];
  const thumbLen = item?.thumbnails?.length ?? 0;
  const extraKeys = item ? Object.keys(item).filter((k) => /photo|image|gallery/i.test(k)) : [];
  console.log(JSON.stringify(params), "status", r.status, "thumbs", thumbLen, "keys", extraKeys);
  for (const k of extraKeys) {
    const v = item[k];
    if (Array.isArray(v)) console.log(" ", k, "len", v.length);
  }
}

// photos with aw-auth-token empty
for (const hdr of [
  {},
  { "aw-auth-token": "" },
  { Authorization: "Bearer " },
]) {
  const r = await fetch(`https://v2api.autowini.com/items/${id}/photos`, {
    headers: { ...base, ...hdr },
  });
  console.log("photos hdr", hdr, r.status, (await r.text()).slice(0, 120));
}
