const id = "IC5494339";
const vin = "WBALM710X9E162658";

async function head(url) {
  const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
  return r.status;
}

// bidrive CDN
let bidrive = 0;
for (let i = 0; i < 25; i++) {
  const st = await head(`https://cdn.thebidrive.com/autowini/catalog/${id}/${i}.jpg`);
  if (st === 200) bidrive++;
  else if (i > 0 && bidrive === 0) break;
}
console.log("bidrive catalog hits", bidrive);

// encar search by VIN
const encarHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
  Accept: "application/json",
  Referer: "https://www.encar.com/",
};
const encSearch = await fetch(
  `https://api.encar.com/search/car/list/general?count=true&q=(And.Hidden.N._.CarType.Y._.ServiceCopyCar.N._.SellType.%EC%9D%BC%EB%B0%98.)&sr=%7CModifiedDate%7C0%7C1&inav=%7CMetadata%7CSort`,
  { headers: encarHeaders },
).catch(() => null);
console.log("encar generic", encSearch?.status);

// try fem encar detail search - common pattern
for (const url of [
  `https://fem.encar.com/cars/detail/search?keyword=${vin}`,
  `https://api.encar.com/search/car/list/premium?count=true&q=(And.Hidden.N._.(C.CarNo.${vin}.))`,
]) {
  try {
    const r = await fetch(url, { headers: encarHeaders });
    console.log(url.slice(0, 80), r.status, (await r.text()).slice(0, 200));
  } catch (e) {
    console.log(url, e.message);
  }
}
