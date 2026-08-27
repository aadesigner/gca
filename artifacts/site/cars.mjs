/** Car listings for marketing pages — loaded from DB export only (site-cars.json). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const _dir = path.dirname(fileURLToPath(import.meta.url));
const SITE = JSON.parse(fs.readFileSync(path.join(_dir, "public/assets/site-cars.json"), "utf8"));

function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(_dir, rel), "utf8"));
  } catch {
    return null;
  }
}

function stripMeta(c) {
  if (!c) return c;
  const { _prefix, ...rest } = c;
  return rest;
}

function uniqueByImg(cars, n = cars.length) {
  const out = [];
  const seen = new Set();
  for (const c of cars) {
    if (!c?.img || seen.has(c.img)) continue;
    seen.add(c.img);
    out.push(stripMeta(c));
    if (out.length >= n) break;
  }
  return out;
}

const NON_CAR_TEXT =
  /\b(trailer|motorcycle|motorbike|atv|utv|snowmobile|boat|jet\s*ski|\brv\b|camper|coachmen|carry-on|big\s*tex|cf\s*moto|taizhou|uforce|dirt\s*bike|scooter|moped|semi\b|tractor|forklift|\bbus\b|chassis|flatbed|pontoon|golf\s*cart|axle|motorhome|side\s*by\s*side|pro\s*xd|q-max|just\s*a\s*moment|polaris|zhilong|spartan\s*motors)\b/i;
const NON_CAR_MAKE =
  /^(carry-on|big\s*tex|cf\s*moto|taizhou|coachmen|polaris|zhilong|spartan\s*motors|just)$/i;

function isPassengerVehicle(c) {
  const make = String(c?.make || "").trim();
  const model = String(c?.model || "").trim();
  const text = `${make} ${model}`.trim();
  const img = String(c?.img || "");
  if (!make || !model) return false;
  if (!c?.year || Number(c.year) < 1990) return false;
  if (/moment/i.test(text)) return false;
  if (NON_CAR_TEXT.test(text)) return false;
  if (NON_CAR_MAKE.test(make)) return false;
  if (model.toLowerCase() === make.toLowerCase()) return false;
  // Old stock filenames that used to ship on USA / header.
  if (/\/us-(camry|stinger|civic|salvage)/i.test(img)) return false;
  // Marketing pages may only show DB-exported listing photos.
  if (img && !/\/(real|db)-/i.test(img) && !/\/hist-/i.test(img)) return false;
  if (/unsplash|istock|shutterstock|getty/i.test(img)) return false;
  return true;
}

function belongsToMarket(c, key) {
  const img = String(c?.img || "");
  if (c?._prefix && c._prefix !== key) return false;
  // Cross-market real-* assets (e.g. Canadian AutoTrader on USA).
  if (/\/real-[a-z]{2}-/.test(img) && !img.includes(`/real-${key}-`)) return false;
  return true;
}

function marketingCars(cars, n) {
  return uniqueByImg(cars.filter(isPassengerVehicle), n);
}

export const SLUG_TO_MARKET = {
  "south-korea": "kr",
  usa: "us",
  canada: "ca",
  dubai: "ae",
  europe: "eu",
  china: "cn",
  japan: "jp",
};

function market(key) {
  return (SITE.markets[key] || [])
    .filter((c) => belongsToMarket(c, key) && isPassengerVehicle(c))
    .map(stripMeta);
}

export const KR = market("kr");
export const US = market("us");
export const CA = market("ca");
export const AE = market("ae");
export const CN = market("cn");
export const EU = market("eu");
export const JP = market("jp");

const heroFromExport = marketingCars(
  (SITE.heroSalvage || []).filter((c) => belongsToMarket(c, "us")),
  8,
);
export const HERO_SALVAGE = heroFromExport.length ? heroFromExport : marketingCars(US, 8);

function liveSampleHeroCars() {
  const pack = readJson("public/assets/live-sample.json");
  return (pack?.vehicles || [])
    .map((v) => ({
      make: v.make,
      model: v.model,
      year: v.year,
      img: v.photos?.[0],
    }))
    .filter((c) => c.img);
}

/** Prefer live-sample DB exports (visually distinct) then site-cars KR heroes. */
export const HERO_LIVE_KR = uniqueByImg([...liveSampleHeroCars(), ...(SITE.heroLiveKr || KR)], 9);

export function photo(src, alt = "", eager = false) {
  const load = eager ? `fetchpriority="high" decoding="async"` : `loading="lazy" decoding="async"`;
  return `<img src="${src}" alt="${alt}" width="640" height="420" ${load} />`;
}

export function titleOf(c) {
  return [c.year, c.make, c.model].filter(Boolean).join(" ");
}

export function heroShot(car) {
  return `<div class="hero-photo"><img src="${car.img}" alt="${titleOf(car)}" fetchpriority="high" decoding="async" /></div>`;
}

export function heroSlideshow(cars, { eager = false } = {}) {
  const slides = uniqueByImg(cars, cars.length);
  const imgs = slides.map((c, i) => {
    const alt = titleOf(c);
    const priority = i === 0 && eager ? ` fetchpriority="high"` : "";
    const active = i === 0 ? " is-active" : "";
    return `<img class="land-slide${active}" src="${c.img}" alt="${alt}" width="1280" height="840" decoding="async"${priority} />`;
  });
  return `<div class="land-slides" data-hero-slideshow>${imgs.join("")}</div>`;
}

export function uniqueCars(cars, n = 4) {
  return uniqueByImg(cars, n);
}

export function recordForSlug(slug) {
  const key = SLUG_TO_MARKET[slug];
  if (!key) return null;
  const cars = market(key);
  return cars[0] || null;
}

export function carsForSlug(slug) {
  const key = SLUG_TO_MARKET[slug];
  return key ? market(key) : [];
}
