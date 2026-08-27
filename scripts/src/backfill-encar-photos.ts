/**
 * Upgrade stored Encar photo URLs to high-resolution CDN links.
 * Run: pnpm backfill:encar-photos
 */
import pg from "pg";
import { upgradeEncarPhotoUrl } from "../../artifacts/api-server/src/lib/providers/encar-photos.ts";

await import("../load-env.mjs");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function backfillPhotos(): Promise<number> {
  const { rows } = await pool.query<{ id: number; source_url: string }>(
    `SELECT id, source_url FROM photos WHERE source_url LIKE '%encar.com%carpicture%'`,
  );

  let updated = 0;
  for (const row of rows) {
    const next = upgradeEncarPhotoUrl(row.source_url);
    if (next === row.source_url) continue;
    await pool.query(`UPDATE photos SET source_url = $1 WHERE id = $2`, [next, row.id]);
    updated++;
  }
  return updated;
}

console.log("Upgrading Encar photo URLs to high-resolution CDN links…");
const updated = await backfillPhotos();
console.log(`Updated ${updated} photos.`);
await pool.end();
