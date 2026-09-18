const headers = { "User-Agent": "Mozilla/5.0", Accept: "application/json", Referer: "https://www.encar.com/" };
async function get(url) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  const json = await r.json().catch(()=>null);
  return { status: r.status, json };
}

// Find a car with many owner changes and inspection recall data
const list = await get("https://api.encar.com/search/car/list/general?count=true&q=(And.Hidden.N._.CarType.Y.)&sr=%7CModifiedDate%7C0%7C40");
const cars = list.json?.SearchResults ?? [];
let best = null;
for (const c of cars.slice(0, 25)) {
  const id = c.Id;
  const view = await get(`https://api.encar.com/v1/readside/vehicle/${id}/view`);
  const vehicleId = view.json?.vehicleId ?? id;
  const record = await get(`https://api.encar.com/v1/readside/record/vehicle/${vehicleId}/open`);
  const insp = await get(`https://api.encar.com/v1/readside/inspection/vehicle/${vehicleId}`);
  const r = record.json || {};
  const d = insp.json?.master?.detail || {};
  const owners = Array.isArray(r.ownerChanges) ? r.ownerChanges.length : 0;
  const row = {
    id, vehicleId, owners, ownerChangeCnt: r.ownerChangeCnt,
    ownerChanges: r.ownerChanges,
    accidents: (r.accidents||[]).map(a => ({ date:a.date, type:a.type, keys: Object.keys(a), mileage:a.mileage, km:a.km })),
    carInfoChanges: r.carInfoChanges,
    carInfoUse1s: r.carInfoUse1s,
    carInfoUse2s: r.carInfoUse2s,
    inspMileage: d.mileage, mileageStateType: d.mileageStateType,
    recall: d.recall, recallFullFillTypes: d.recallFullFillTypes,
    seriousTypes: d.seriousTypes, usageChangeTypes: d.usageChangeTypes,
    engineCheck: d.engineCheck, trnsCheck: d.trnsCheck,
    issueDate: d.issueDate, validity: [d.validityStartDate, d.validityEndDate],
  };
  if (!best || owners > best.owners) best = row;
  if (owners >= 5 || d.recall === true || (Array.isArray(d.recallFullFillTypes) && d.recallFullFillTypes.length)) {
    console.log("HIT", JSON.stringify(row, null, 2));
  }
}
console.log("BEST_OWNERS", JSON.stringify(best, null, 2));

// Try alternate endpoints that might hold mileage history / car check
const vid = best?.vehicleId;
const probes = [
  `https://api.encar.com/v1/readside/record/vehicle/${vid}`,
  `https://api.encar.com/v1/readside/record/vehicle/${vid}/open`,
  `https://api.encar.com/v1/readside/vehicle/${best?.id}/record`,
  `https://api.encar.com/v1/readside/inspection/vehicle/${vid}/history`,
  `https://api.encar.com/v1/readside/vehicle/${vid}/inspection/history`,
  `https://fem.encar.com/cars/detail/${best?.id}`,
];
for (const u of probes) {
  try {
    const r = await get(u);
    console.log("PROBE", r.status, u.replace(/https:\/\/[^/]+/,""), "keys", r.json && typeof r.json==='object' ? Object.keys(r.json).slice(0,15) : typeof r.json);
  } catch(e) { console.log("PROBE fail", u, e.message); }
}
