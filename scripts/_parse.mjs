import { readFileSync } from "fs";
import { parseImportMotorDetail } from "../artifacts/api-server/src/lib/providers/import-motor-parse.ts";
const html = readFileSync("_im_chevy.html", "utf8");
const vin = "1GCWGAFP6M1174039";
const listing = parseImportMotorDetail(html, "https://import-motor.com/v/" + vin);
console.log(JSON.stringify({
  title: listing.title,
  mileage: listing.mileage,
  make: listing.vehicle?.make,
  model: listing.vehicle?.model,
  year: listing.vehicle?.year,
  country: listing.country,
  origin: listing.targetProvider,
  vehicleTitleEvents: (listing.events||[]).filter(e => e.eventType === "title_status"),
  allEventTypes: [...new Set((listing.events||[]).map(e => e.eventType))],
}, null, 2));
