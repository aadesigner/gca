import fs from "fs";
const t = fs.readFileSync(new URL("../../_probe/charancha_cars.html", import.meta.url), "utf8");
console.log("len", t.length);
for (const pat of ["sellNo", "carId", "carSeq", "vin", "VIN", "mileage", "sellKey", "goodsNo"]) {
  const re = new RegExp(`${pat}[\"':=\\s]+([A-Za-z0-9_-]+)`, "gi");
  const m = [...t.matchAll(re)].slice(0, 5).map((x) => x[0]);
  if (m.length) console.log(pat, m);
}
const links = [...new Set([...t.matchAll(/href=\"(\/bu\/[^\"]+)\"/g)].map((m) => m[1]))].slice(0, 20);
console.log("bu links", links);
const rsc = t.match(/self\.__next_f\.push\(\[1,\"([^\"]{0,500})/);
console.log("rsc sample", rsc?.[1]?.slice(0, 200));
