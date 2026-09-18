/**
 * ru-locale English normalizers
 * Run: ../../scripts/node_modules/.bin/tsx src/lib/__tests__/ru-locale.test.ts
 */
import assert from "node:assert/strict";
import {
  isPollutedSpec,
  normalizeRuBody,
  normalizeRuColor,
  normalizeRuDrive,
  normalizeRuFuel,
  normalizeRuTransmission,
  parseRuDisplayDate,
} from "../providers/ru-locale";

assert.equal(normalizeRuDrive("Передний"), "FWD");
assert.equal(normalizeRuDrive("Полный"), "AWD");
assert.equal(normalizeRuFuel("Гибрид"), "Hybrid");
assert.equal(normalizeRuFuel("Пропан"), "LPG");
assert.equal(normalizeRuFuel("Бензин"), "Gasoline");
assert.equal(normalizeRuTransmission("АКПП"), "Automatic");
assert.equal(normalizeRuColor("Синий"), "Blue");
assert.equal(normalizeRuBody("Внедорожник"), "SUV");
assert.equal(parseRuDisplayDate("18 августа 2026")?.toISOString().slice(0, 10), "2026-08-18");
assert.ok(isPollutedSpec("Передний Топливо Бензин Цена объявления 58215 BYN"));
assert.equal(normalizeRuDrive("Передний Топливо Бензин Цена объявления 58215 BYN"), undefined);
console.log("ru-locale: all ok");
