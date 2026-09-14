/**
 * Run with: pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/__tests__/photo-response-360.test.ts
 */
import assert from "node:assert/strict";
import {
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
      id: 3,
      sourceUrl: "https://mediaretriever.iaai.com/api/ThreeSixtyImageRetriever?tenant=iaai&partitionKey=1&imageOrder=1",
      storedPath: null,
      photoGroup: "exterior_3d",
      isPrimary: false,
      sortOrder: 1,
    },
    {
      id: 4,
      sourceUrl: "https://cars.import-motor.com/spin/0.jpg",
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
  assert.equal(split.photosExterior3dOld.length, 2);
  assert.equal(split.photosExterior3dOld[0]!.provider, "iaa");
  assert.equal(split.photosInterior3d.length, 1);
  assert.equal(split.photosInterior3d[0]!.provider, "cloudflare");
  assert.equal(split.photosInterior3dOld.length, 0);
}

console.log("photo-response-360: ok");
