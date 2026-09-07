/**
 * Model label unification: 5-Series ↔ 5 Series, C Class ↔ C-Class.
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
assert.equal(canonicalizeModelLabel("C Class"), "C-Class");
assert.equal(canonicalizeModelLabel("c-class"), "C-Class");
assert.equal(canonicalizeModelLabel("GLC Class"), "GLC-Class");
assert.equal(canonicalizeModelLabel("M3"), "M3");
assert.equal(canonicalizeModelLabel("X5"), "X5");
assert.equal(canonicalizeModelLabel("CX-5"), "CX-5");

const merged = mergeModelCounts([
  { model: "5-Series", count: 10 },
  { model: "5 Series", count: 7 },
  { model: "5 series", count: 3 },
  { model: "M3", count: 2 },
]);
assert.equal(merged.length, 2);
assert.equal(merged[0]!.model, "5 Series");
assert.equal(merged[0]!.count, 20);
assert.equal(merged[1]!.model, "M3");

const variants = modelFilterValues("5 Series");
assert.ok(variants.includes("5-Series"));
assert.ok(variants.includes("5 Series"));

console.log("model-normalize: ok");
