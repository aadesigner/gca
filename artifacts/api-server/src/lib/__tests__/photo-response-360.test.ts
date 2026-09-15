/**
 * Run with: pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/__tests__/photo-response-360.test.ts
 */
import assert from "node:assert/strict";
import {
  filterOrphan360Photos,
  isAuctionCdnPhotoUrl,
  shouldMirrorPhotoUrl,
  splitPhotosNewOld,
} from "../photo-response";

{
  assert.equal(isAuctionCdnPhotoUrl("https://cs.copart.com/v1/AUTH/foo.jpg"), true);
  assert.equal(isAuctionCdnPhotoUrl("https://vis.iaai.com/resizer?imageKeys=x"), true);
  assert.equal(
    isAuctionCdnPhotoUrl("https://mediaretriever.iaai.com/api/ThreeSixtyImageRetriever?tenant=iaai"),
    true,
  );
  assert.equal(isAuctionCdnPhotoUrl("https://cars.import-motor.com/iaa/foo.jpg"), false);
  assert.equal(shouldMirrorPhotoUrl("https://cs.copart.com/v1/AUTH/foo.jpg"), false);
  assert.equal(shouldMirrorPhotoUrl("https://cars.import-motor.com/iaa/foo.jpg"), true);
  assert.equal(shouldMirrorPhotoUrl("https://ci.encar.com/carpicture/x.jpg"), true);
}

{
  const rows = [
    {
      id: 1,
      sourceUrl: "https://cars.import-motor.com/gallery/1.jpg",
      storedPath: "https://imgsv.getcarapi.com/p/a.jpg",
      photoGroup: "gallery",
      isPrimary: true,
      sortOrder: 0,
    },
    {
      id: 2,
      sourceUrl: "https://mediaretriever.iaai.com/api/ThreeSixtyImageRetriever?tenant=iaai&partitionKey=1&imageOrder=0",
      storedPath: null,
      photoGroup: "exterior_3d",
      isPrimary: false,
      sortOrder: 0,
    },
    {
      id: 4,
      sourceUrl: "https://mediaretriever.iaai.com/api/InteriorImageRetriever?tenant=iaai&partitionKey=1",
      storedPath: "https://imgsv.getcarapi.com/p/spin0.jpg",
      photoGroup: "interior_3d",
      isPrimary: false,
      sortOrder: 0,
    },
  ];

  const split = splitPhotosNewOld(rows);
  assert.equal(split.photosNew.length, 1);
  assert.equal(split.photosNew[0]!.group, "gallery");
  assert.equal(split.photosOld.length, 0);
  assert.equal(split.photosExterior3d.length, 0);
  assert.equal(split.photosExterior3dOld.length, 1);
  assert.equal(split.photosExterior3dOld[0]!.provider, "iaa");
  assert.equal("photosInterior3d" in split, false);
}

{
  // Interior always dropped; Encar + foreign exterior 360 also dropped.
  const encar = [
    {
      id: 1,
      listingId: 10,
      sourceUrl: "https://cars2.import-motor.com/encar/mercedes-benz/gle/2021/123/W1NFD2DB6MA507466-1.webp",
      photoGroup: "gallery",
      isPrimary: true,
      sortOrder: 0,
    },
    {
      id: 2,
      listingId: 10,
      sourceUrl: "https://mediaretriever.iaai.com/api/ThreeSixtyImageRetriever?tenant=iaai&partitionKey=999&imageOrder=1",
      photoGroup: "exterior_3d",
      isPrimary: false,
      sortOrder: 0,
    },
    {
      id: 3,
      listingId: 10,
      sourceUrl: "https://mediaretriever.iaai.com/api/InteriorImageRetriever?tenant=iaai&partitionKey=999",
      photoGroup: "interior_3d",
      isPrimary: false,
      sortOrder: 0,
    },
  ];
  const filtered = filterOrphan360Photos(encar);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.photoGroup, "gallery");
}

{
  // Real IAA listing: gallery stills unlock exterior 360; interior still dropped.
  const iaa = [
    {
      id: 1,
      listingId: 20,
      sourceUrl: "https://vis.iaai.com/resizer?imageKeys=123456~SID~STP~S0~001",
      photoGroup: "gallery",
      sortOrder: 0,
    },
    {
      id: 2,
      listingId: 20,
      sourceUrl: "https://mediaretriever.iaai.com/api/ThreeSixtyImageRetriever?tenant=iaai&partitionKey=123456&imageOrder=1",
      photoGroup: "exterior_3d",
      sortOrder: 0,
    },
    {
      id: 3,
      listingId: 20,
      sourceUrl: "https://mediaretriever.iaai.com/api/InteriorImageRetriever?tenant=iaai&partitionKey=123456",
      photoGroup: "interior_3d",
      sortOrder: 0,
    },
  ];
  const filtered = filterOrphan360Photos(iaa);
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((p) => p.photoGroup !== "interior_3d"));
}

console.log("photo-response-360: ok");
