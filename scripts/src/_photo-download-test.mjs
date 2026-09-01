import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

for (const provider of ["copart", "autowini", "encar"]) {
  const { rows } = await pool.query(
    `SELECT ph.id, ph.source_url FROM photos ph
     JOIN listings l ON l.id = ph.listing_id
     JOIN providers p ON p.id = l.provider_id
     WHERE ph.stored_path IS NULL AND p.internal_name = $1
     ORDER BY ph.id DESC LIMIT 2`,
    [provider],
  );
  console.log("\n===", provider, "===");
  for (const r of rows) {
    let referer = "https://www.copart.com/";
    if (provider === "encar") referer = "https://www.encar.com/";
    if (provider === "autowini") referer = "https://www.autowini.com/";
    try {
      const res = await fetch(r.source_url, {
        headers: { "User-Agent": "Mozilla/5.0", Referer: referer },
        redirect: "follow",
      });
      console.log(r.id, res.status, r.source_url.slice(0, 100));
    } catch (e) {
      console.log(r.id, "ERR", e.message);
    }
  }
}

const { rows: sample } = await pool.query(
  `SELECT stored_path FROM photos WHERE stored_path ~* 'imgsv\\.getcarapi\\.com' ORDER BY id DESC LIMIT 1`,
);
if (sample[0]) {
  const url = sample[0].stored_path;
  console.log("\n=== CDN sample ===", url);
  try {
    const res = await fetch(url, { method: "HEAD" });
    console.log("HEAD", res.status);
  } catch (e) {
    console.log("HEAD ERR", e.message);
  }
}

await pool.end();
