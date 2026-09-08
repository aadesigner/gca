/**
 * Model label unification: 5-Series / 5er / 5 er ↔ 5 Series, C Class ↔ C-Class.
 */
import assert from "node:assert/strict";
import {
  canonicalizeModelLabel,
  mergeModelCounts,
  modelFilterValues,
} from "../model-normalize";

assert.equal(canonicalizeModelLabel("5-series"), "5 Series");
assert.equal(canonicalizeModelLabel("5-Series"), "5 Series");
assert.equal(canonicalizeModelLabel("5 series"), "5 Series");
assert.equal(canonicalizeModelLabel("5er"), "5 Series");
assert.equal(canonicalizeModelLabel("5 er"), "5 Series");
assert.equal(canonicalizeModelLabel("5-er"), "5 Series");
assert.equal(canonicalizeModelLabel("3ER"), "3 Series");
assert.equal(canonicalizeModelLabel("C Class"), "C-Class");
assert.equal(canonicalizeModelLabel("c-class"), "C-Class");
assert.equal(canonicalizeModelLabel("GLC Class"), "GLC-Class");
assert.equal(canonicalizeModelLabel("M3"), "M3");
assert.equal(canonicalizeModelLabel("X5"), "X5");
assert.equal(canonicalizeModelLabel("CX-5"), "CX-5");
assert.equal(canonicalizeModelLabel("530i"), "530i");
assert.equal(canonicalizeModelLabel("Tourer"), "Tourer");

const merged = mergeModelCounts([
  { model: "5-Series", count: 10 },
  { model: "5 Series", count: 7 },
  { model: "5 series", count: 3 },
  { model: "5 er", count: 4 },
  { model: "5er", count: 2 },
  { model: "M3", count: 2 },
]);
assert.equal(merged.length, 2);
assert.equal(merged[0]!.model, "5 Series");
assert.equal(merged[0]!.count, 26);
assert.equal(merged[1]!.model, "M3");

const variants = modelFilterValues("5 Series");
assert.ok(variants.includes("5-Series"));
assert.ok(variants.includes("5 Series"));
assert.ok(variants.includes("5er"));
assert.ok(variants.includes("5 er"));

console.log("model-normalize: ok");
