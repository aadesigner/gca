import pg from "pg";
import fs from "fs";

const LOCAL = "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";

function loadProd() {
  for (const f of [".env", ".env.local", "artifacts/api-server/.env", "scripts/.env"]) {
    try {
      const t = fs.readFileSync(f, "utf8");
      for (const key of ["PROD_DATABASE_URL", "DATABASE_URL"]) {
        const m = t.match(new RegExp(`^${key}=(.+)$`, "m"));
        if (m) {
          const v = m[1].trim().replace(/^["']|["']$/g, "");
          if (!/127\.0\.0\.1|localhost/i.test(v)) return v;
        }
      }
    } catch {}
  }
  return process.env.PROD_DATABASE_URL || null;
}

async function audit(label, cs) {
  const c = new pg.Client({
    connectionString: cs,
    ssl: /127\.0\.0\.1|localhost/i.test(cs) ? false : { rejectUnauthorized: false },
  });
  await c.connect();
  const names = await c.query(
    `SELECT id, internal_name FROM providers WHERE internal_name ILIKE '%bidrive%' OR internal_name ILIKE '%bid%drive%'`,
  );
  console.log(label, "providers", names.rows);
  if (!names.rows.length) {
    await c.end();
    return;
  }
  const name = names.rows[0].internal_name;
  const recent = await c.query(
    `
    SELECT left(p.source_url, 160) AS url, count(*)::int AS n
    FROM photos p
    JOIN listings l ON l.vehicle_id = p.vehicle_id OR l.id = p.listing_id
    JOIN providers pr ON pr.id = l.provider_id
    WHERE pr.internal_name = $1
      AND COALESCE(l.created_at, l.last_seen_at) > now() - interval '14 days'
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 40
  `,
    [name],
  );
  console.log(label, "top_urls", recent.rows);

  const suspicious = await c.query(
    `
    SELECT v.vin, left(l.source_url, 90) AS listing,
      count(p.id)::int AS pc,
      array_agg(left(p.source_url, 120) ORDER BY p.sort_order NULLS LAST) AS urls
    FROM listings l
    JOIN providers pr ON pr.id = l.provider_id
    JOIN vehicles v ON v.id = l.vehicle_id
    JOIN photos p ON p.vehicle_id = v.id
    WHERE pr.internal_name = $1
      AND COALESCE(l.created_at, l.last_seen_at) > now() - interval '14 days'
      AND (
        p.source_url ILIKE '%og-default%'
        OR p.source_url ILIKE '%no%image%'
        OR p.source_url ILIKE '%nophoto%'
        OR p.source_url ILIKE '%placeholder%'
        OR p.source_url ILIKE '%no-photo%'
        OR p.source_url ILIKE '%default%png%'
        OR p.source_url ILIKE '%blank%'
        OR p.source_url ~* 'no[_-]?img'
      )
    GROUP BY v.vin, l.source_url
    ORDER BY max(l.created_at) DESC NULLS LAST
    LIMIT 15
  `,
    [name],
  );
  console.log(label, "suspicious", JSON.stringify(suspicious.rows, null, 2));

  const onePhoto = await c.query(
    `
    SELECT v.vin, left(l.source_url, 90) AS listing,
      min(p.source_url) AS url
    FROM listings l
    JOIN providers pr ON pr.id = l.provider_id
    JOIN vehicles v ON v.id = l.vehicle_id
    JOIN photos p ON p.vehicle_id = v.id
    WHERE pr.internal_name = $1
      AND COALESCE(l.created_at, l.last_seen_at) > now() - interval '7 days'
    GROUP BY v.vin, l.source_url
    HAVING count(p.id) = 1
    ORDER BY max(l.created_at) DESC NULLS LAST
    LIMIT 20
  `,
    [name],
  );
  console.log(label, "single_photo", JSON.stringify(onePhoto.rows, null, 2));
  await c.end();
}

await audit("LOCAL", LOCAL);
const prod = loadProd();
if (prod) await audit("PROD", prod);
else console.log("no prod url");
