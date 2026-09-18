const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const headers = { "User-Agent": UA, Accept: "application/json", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8", Referer: "https://www.encar.com/" };

async function get(url) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, len: text.length };
}

// Find a live listing with vehicleId
const list = await get("https://api.encar.com/search/car/list/general?count=true&q=(And.Hidden.N._.CarType.Y.)&sr=%7CModifiedDate%7C0%7C5");
const cars = list.json?.SearchResults ?? list.json?.searchResults ?? list.json?.Result ?? [];
console.log("list status", list.status, "keys", Object.keys(list.json||{}), "n", Array.isArray(cars)?cars.length:typeof cars);
const sample = Array.isArray(cars) ? cars[0] : null;
console.log("sample keys", sample && Object.keys(sample).slice(0,30));
const carId = sample?.Id ?? sample?.id ?? sample?.CarId;
console.log("carId", carId);

if (carId) {
  const detail = await get(`https://api.encar.com/v1/readside/vehicle/${carId}`);
  const view = await get(`https://api.encar.com/v1/readside/vehicle/${carId}/view`);
  const vehicleId = view.json?.vehicleId ?? carId;
  console.log("vehicleId", vehicleId, "detail keys", Object.keys(detail.json||{}).slice(0,20));
  const record = await get(`https://api.encar.com/v1/readside/record/vehicle/${vehicleId}/open`);
  const inspection = await get(`https://api.encar.com/v1/readside/inspection/vehicle/${vehicleId}`);
  const diagnosis = await get(`https://api.encar.com/v1/readside/diagnosis/vehicle/${vehicleId}`);
  console.log("record status", record.status, "keys", Object.keys(record.json||{}));
  console.log("inspection status", inspection.status, "keys", Object.keys(inspection.json||{}));
  console.log("diagnosis status", diagnosis.status, "keys", Object.keys(diagnosis.json||{}).slice(0,20));
  if (record.json) {
    const r = record.json;
    console.log(JSON.stringify({
      openData: r.openData,
      ownerChangeCnt: r.ownerChangeCnt,
      ownerChanges: r.ownerChanges,
      ownerChangesType: Array.isArray(r.ownerChanges) ? typeof r.ownerChanges[0] : typeof r.ownerChanges,
      myAccidentCnt: r.myAccidentCnt,
      otherAccidentCnt: r.otherAccidentCnt,
      accidentsLen: Array.isArray(r.accidents)?r.accidents.length:null,
      carInfoChangesLen: Array.isArray(r.carInfoChanges)?r.carInfoChanges.length:null,
      firstDate: r.firstDate,
      recall: r.recall ?? r.recalls ?? r.recallCnt,
      mileages: r.mileages ?? r.mileageHistory ?? r.mileageList ?? r.useHistory,
      allKeys: Object.keys(r),
    }, null, 2));
    // dump any key that looks mileage/recall related
    for (const k of Object.keys(r)) {
      if (/mile|odo|recall|inspect|check|history|use|drive|km/i.test(k)) {
        console.log("KEY", k, JSON.stringify(r[k]).slice(0,300));
      }
    }
  }
  if (inspection.json?.master?.detail) {
    const d = inspection.json.master.detail;
    console.log("inspection detail keys", Object.keys(d));
    console.log("inspection mileage", d.mileage, "issue", d.issueDate ?? inspection.json.master.registrationDate);
  }
}
