import assert from "node:assert/strict";
import {
  NEW_LISTING_PREPEND_COUNT,
  pickOrderedPhotos,
  providerFrameOrder,
  selectMixedVehiclePhotos,
  type MixablePhoto,
} from "../collector/photo-mix.ts";

type P = MixablePhoto<{ id: number }>;

function photo(
  partial: Partial<P> & { id: number; listingId: number; identityKey: string; sourceUrl?: string },
): P {
  return {
    isPrimary: false,
    sortOrder: partial.id,
    photoGroup: "gallery",
    sourceUrl: partial.sourceUrl,
    ...partial,
  };
}

{
  assert.equal(
    providerFrameOrder("https://ci.encar.com/carpicture/carpicture04/pic4204/42040331_001.jpg"),
    1,
  );
  // Inspection / VIN-plate frames (_010+) must rank after car covers.
  assert.ok(
    providerFrameOrder("https://ci.encar.com/carpicture/carpicture04/pic4204/42040331_024.jpg") >= 2000,
  );
  assert.ok(
    providerFrameOrder("https://ci.encar.com/carpicture/carpicture04/pic4204/42040331_001.jpg") <
      providerFrameOrder("https://ci.encar.com/carpicture/carpicture04/pic4204/42040331_024.jpg"),
  );
  assert.equal(
    providerFrameOrder("https://cdn.thebidrive.com/autowini/catalog/IC5373645/3.avif"),
    3,
  );
}

{
  // Stale isPrimary on Encar inspection must not beat a real car cover.
  const mixed = selectMixedVehiclePhotos(
    [
      photo({
        id: 1,
        listingId: 1,
        identityKey: "plate",
        isPrimary: true,
        sortOrder: 0,
        sourceUrl: "https://ci.encar.com/carpicture/carpicture02/pic4272/42723886_024.jpg",
      }),
      photo({
        id: 2,
        listingId: 1,
        identityKey: "cover",
        isPrimary: false,
        sortOrder: 1,
        sourceUrl: "https://ci.encar.com/carpicture/carpicture02/pic4272/42723886_003.jpg",
      }),
      photo({
        id: 3,
        listingId: 1,
        identityKey: "side",
        isPrimary: false,
        sortOrder: 2,
        sourceUrl: "https://ci.encar.com/carpicture/carpicture02/pic4272/42723886_001.jpg",
      }),
    ],
    10,
  );
  assert.equal(mixed[0]!.identityKey, "side", "Encar _001 should be primary over _024");
  assert.equal(mixed[0]!.isPrimary, true);
}

{
  const listingA = Array.from({ length: 10 }, (_, i) =>
    photo({
      id: i + 1,
      listingId: 1,
      identityKey: `a-${i}`,
      sortOrder: 10000 + i, // polluted
      sourceUrl: `https://ci.encar.com/x_${String(i + 1).padStart(3, "0")}.jpg`,
      isPrimary: i === 0,
    }),
  );
  const listingB = Array.from({ length: 10 }, (_, i) =>
    photo({
      id: 100 + i,
      listingId: 2,
      identityKey: `b-${i}`,
      sortOrder: i,
      sourceUrl: `https://cdn.thebidrive.com/autowini/catalog/IC1/${i}.avif`,
      isPrimary: i === 0,
    }),
  );

  const picked = pickOrderedPhotos(listingA, 4).map((p) => p.identityKey);
  assert.deepEqual(picked, ["a-0", "a-1", "a-2", "a-3"]);

  // Preferred BidDrive must NOT steal head when Encar gallery exists.
  const mixed = selectMixedVehiclePhotos([...listingA, ...listingB], 40, undefined, 2);
  const gallery = mixed.filter((p) => (p.photoGroup || "gallery") === "gallery");
  assert.equal(gallery.length, 20);
  assert.deepEqual(
    gallery.slice(0, 10).map((p) => p.identityKey),
    ["a-0", "a-1", "a-2", "a-3", "a-4", "a-5", "a-6", "a-7", "a-8", "a-9"],
  );
  assert.ok(gallery.slice(10).every((p) => p.listingId === 2));
  // BidDrive block stays in frame order after Encar.
  assert.deepEqual(
    gallery.slice(10).map((p) => p.identityKey),
    ["b-0", "b-1", "b-2", "b-3", "b-4", "b-5", "b-6", "b-7", "b-8", "b-9"],
  );
  assert.equal(gallery[0]!.isPrimary, true);
  assert.equal(gallery[0]!.sortOrder, 0);
  void NEW_LISTING_PREPEND_COUNT;
}

{
  const only = Array.from({ length: 12 }, (_, i) =>
    photo({
      id: i + 1,
      listingId: 9,
      identityKey: `only-${i}`,
      sortOrder: i,
      sourceUrl: `https://ci.encar.com/x_${String(i + 1).padStart(3, "0")}.jpg`,
      isPrimary: i === 0,
    }),
  );
  const selected = selectMixedVehiclePhotos(only, 40, undefined, 9);
  assert.equal(selected.length, 12);
  assert.ok(selected.every((p) => p.listingId === 9));
}

{
  // No preferred → contiguous listing blocks (not interleaved by sortOrder).
  const photos = [
    photo({
      id: 1,
      listingId: 1,
      identityKey: "x",
      sortOrder: 0,
      isPrimary: true,
      sourceUrl: "https://ci.encar.com/x_001.jpg",
    }),
    photo({
      id: 2,
      listingId: 2,
      identityKey: "y",
      sortOrder: 1,
      isPrimary: false,
      sourceUrl: "https://cdn.thebidrive.com/autowini/catalog/IC1/0.avif",
    }),
    photo({
      id: 3,
      listingId: 1,
      identityKey: "z",
      sortOrder: 2,
      isPrimary: false,
      sourceUrl: "https://ci.encar.com/x_002.jpg",
    }),
  ];
  const selected = selectMixedVehiclePhotos(photos, 40);
  assert.deepEqual(
    selected.map((p) => p.identityKey),
    ["x", "z", "y"],
  );
}

console.log("photo-mix tests ok");
