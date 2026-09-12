import assert from "node:assert/strict";
import {
  NEW_LISTING_PREPEND_COUNT,
  pickRandomPhotos,
  selectMixedVehiclePhotos,
  type MixablePhoto,
} from "../collector/photo-mix.ts";

type P = MixablePhoto<{ id: number }>;

function photo(partial: Partial<P> & { id: number; listingId: number; identityKey: string }): P {
  return {
    isPrimary: false,
    sortOrder: partial.id,
    photoGroup: "gallery",
    ...partial,
  };
}

// random() === 0 is enough to prove we do not always take sortOrder 0..3.
const biasedRandom = () => 0;

{
  const listingA = Array.from({ length: 10 }, (_, i) =>
    photo({ id: i + 1, listingId: 1, identityKey: `a-${i}`, sortOrder: i, isPrimary: i === 0 }),
  );
  const listingB = Array.from({ length: 10 }, (_, i) =>
    photo({ id: 100 + i, listingId: 2, identityKey: `b-${i}`, sortOrder: i, isPrimary: i === 0 }),
  );

  const picked = pickRandomPhotos(listingB, 4, biasedRandom).map((p) => p.identityKey);
  assert.notDeepEqual(picked, ["b-0", "b-1", "b-2", "b-3"]);
  assert.equal(picked.length, 4);

  const mixed = selectMixedVehiclePhotos(
    [...listingA, ...listingB],
    40,
    undefined,
    2,
    biasedRandom,
  );
  const gallery = mixed.filter((p) => (p.photoGroup || "gallery") === "gallery");

  assert.equal(gallery.length, 10 + NEW_LISTING_PREPEND_COUNT);
  const head = gallery.slice(0, NEW_LISTING_PREPEND_COUNT);
  assert.equal(head.length, NEW_LISTING_PREPEND_COUNT);
  assert.ok(head.every((p) => p.listingId === 2));
  assert.notDeepEqual(
    head.map((p) => p.identityKey),
    ["b-0", "b-1", "b-2", "b-3"],
  );

  // Old listing follows as a block — no A/B/A/B interleave.
  const restListingIds = gallery.slice(NEW_LISTING_PREPEND_COUNT).map((p) => p.listingId);
  assert.ok(restListingIds.every((id) => id === 1));
  assert.equal(gallery[0]!.isPrimary, true);
  assert.equal(gallery[0]!.sortOrder, 0);
}

{
  // First listing only → keep full gallery, not just 4.
  const only = Array.from({ length: 12 }, (_, i) =>
    photo({ id: i + 1, listingId: 9, identityKey: `only-${i}`, sortOrder: i, isPrimary: i === 0 }),
  );
  const selected = selectMixedVehiclePhotos(only, 40, undefined, 9);
  assert.equal(selected.length, 12);
  assert.ok(selected.every((p) => p.listingId === 9));
}

{
  // No preferred → preserve existing order across listings (reconcile).
  const photos = [
    photo({ id: 1, listingId: 1, identityKey: "x", sortOrder: 0, isPrimary: true }),
    photo({ id: 2, listingId: 2, identityKey: "y", sortOrder: 1, isPrimary: false }),
    photo({ id: 3, listingId: 1, identityKey: "z", sortOrder: 2, isPrimary: false }),
  ];
  const selected = selectMixedVehiclePhotos(photos, 40);
  assert.deepEqual(
    selected.map((p) => p.identityKey),
    ["x", "y", "z"],
  );
}

console.log("photo-mix tests ok");
