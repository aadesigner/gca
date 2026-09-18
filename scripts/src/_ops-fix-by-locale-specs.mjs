/**
 * Fix NFS Auto / Auto Partner / Auction Auto spoiled rows:
 * - Cyrillic / page-tail polluted fuel/drive/transmission/color/body → English or NULL
 * - BYN listing currency → USD (approx NBRB scale; refresh crawl refines)
 * - Null polluted specs so API never shows Russian label dumps
 *
 *   APPLY=1 TARGET=local node --import ./load-env.mjs ./src/_ops-fix-by-locale-specs.mjs
 *   APPLY=1 TARGET=prod  node --import ./load-env.mjs ./src/_ops-fix-by-locale-specs.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const APPLY = process.env.APPLY === "1";
const TARGET = (process.env.TARGET || "local").toLowerCase();
const BYN_PER_USD = Number(process.env.BYN_PER_USD || 3.03) || 3.03;

function loadProd() {
  if (process.env.PROD_DATABASE_URL) {
    return { connectionString: process.env.PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } };
  }
  const p = path.join(os.tmpdir(), "gca-pg-vars-prod.json");
  const raw = fs.readFileSync(p, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) =>
    vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];
  return {
    host: get("RAILWAY_TCP_PROXY_DOMAIN") || process.env.PROD_PG_HOST,
    port: Number(get("RAILWAY_TCP_PROXY_PORT") || process.env.PROD_PG_PORT || 5432),
    user: get("PGUSER") || get("POSTGRES_USER") || process.env.PROD_PG_USER || "postgres",
    password: get("PGPASSWORD") || get("POSTGRES_PASSWORD") || process.env.PROD_PG_PASSWORD,
    database: get("PGDATABASE") || process.env.PROD_PG_DATABASE || "railway",
    ssl: false,
  };
}

function client() {
  if (TARGET === "prod") return new pg.Client(loadProd());
  const url =
    process.env.LOCAL_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip";
  return new pg.Client({
    connectionString: url.includes("sslmode=") ? url : `${url}${url.includes("?") ? "&" : "?"}sslmode=disable`,
  });
}

const PROVIDERS = ["nfsauto", "autopartner", "auctionauto"];

async function main() {
  const c = client();
  await c.connect();
  console.log({ APPLY, TARGET, BYN_PER_USD });

  const before = await c.query(
    `
    SELECT p.internal_name,
      count(*)::int AS obs,
      count(*) FILTER (WHERE o.price_currency = 'BYN')::int AS byn,
      count(*) FILTER (WHERE v.drive_type ~ '[А-Яа-яЁё]|Цена|Топливо')::int AS drive_bad,
      count(*) FILTER (WHERE v.fuel_type ~ '[А-Яа-яЁё]|Бренды|Цена')::int AS fuel_bad,
      count(*) FILTER (WHERE v.transmission ~ '[А-Яа-яЁё]|Цена|Привод')::int AS trans_bad
    FROM vehicle_observations o
    JOIN providers p ON p.id = o.provider_id
    LEFT JOIN vehicles v ON v.id = o.vehicle_id
    WHERE p.internal_name = ANY($1::text[])
    GROUP BY 1
    `,
    [PROVIDERS],
  );
  console.log("before", before.rows);

  if (!APPLY) {
    console.log("dry-run — set APPLY=1 to write");
    await c.end();
    return;
  }

  await c.query("BEGIN");
  try {
    // Map short Cyrillic enums; wipe polluted page-tail dumps.
    const drive = await c.query(`
      UPDATE vehicles v
      SET drive_type = CASE
        WHEN v.drive_type ~* '(полн|awd|4wd|4x4|all.?wheel)' AND v.drive_type !~ 'Цена|Топливо' AND length(v.drive_type) < 24 THEN 'AWD'
        WHEN v.drive_type ~* '(передн|fwd|front|2\\s*wd)' AND v.drive_type !~ 'Цена|Топливо' AND length(v.drive_type) < 24 THEN 'FWD'
        WHEN v.drive_type ~* '(задн|rwd|rear)' AND v.drive_type !~ 'Цена|Топливо' AND length(v.drive_type) < 24 THEN 'RWD'
        WHEN v.drive_type ~ '[А-Яа-яЁё]' OR v.drive_type ~ 'Цена|Топливо|объявлен|Доставка|Бренды'
          OR length(coalesce(v.drive_type,'')) > 24 THEN NULL
        ELSE v.drive_type
      END
      WHERE v.id IN (
        SELECT o.vehicle_id FROM vehicle_observations o
        JOIN providers p ON p.id = o.provider_id
        WHERE p.internal_name = ANY($1::text[]) AND o.vehicle_id IS NOT NULL
      )
        AND (
          v.drive_type ~ '[А-Яа-яЁё]'
          OR v.drive_type ~ 'Цена|Топливо|объявлен|Доставка|Бренды'
          OR length(coalesce(v.drive_type,'')) > 24
        )
    `, [PROVIDERS]);

    const fuel = await c.query(`
      UPDATE vehicles v
      SET fuel_type = CASE
        WHEN v.fuel_type ~* '(гибрид|hybrid)' AND length(v.fuel_type) < 24 THEN 'Hybrid'
        WHEN v.fuel_type ~* '(дизел|diesel)' AND length(v.fuel_type) < 24 THEN 'Diesel'
        WHEN v.fuel_type ~* '(бензин|gasoline|petrol)' AND length(v.fuel_type) < 24 THEN 'Gasoline'
        WHEN v.fuel_type ~* '(пропан|propan|lpg|газ)' AND length(v.fuel_type) < 24 THEN 'LPG'
        WHEN v.fuel_type ~* '(электр|electric)' AND length(v.fuel_type) < 24 THEN 'Electric'
        WHEN v.fuel_type ~ '[А-Яа-яЁё]' OR v.fuel_type ~ 'Бренды|Цена|объявлен|Доставка'
          OR length(coalesce(v.fuel_type,'')) > 24 THEN NULL
        ELSE v.fuel_type
      END
      WHERE v.id IN (
        SELECT o.vehicle_id FROM vehicle_observations o
        JOIN providers p ON p.id = o.provider_id
        WHERE p.internal_name = ANY($1::text[]) AND o.vehicle_id IS NOT NULL
      )
        AND (
          v.fuel_type ~ '[А-Яа-яЁё]'
          OR v.fuel_type ~ 'Бренды|Цена|объявлен|Доставка'
          OR length(coalesce(v.fuel_type,'')) > 24
        )
    `, [PROVIDERS]);

    const trans = await c.query(`
      UPDATE vehicles v
      SET transmission = CASE
        WHEN v.transmission ~* '(авт|акпп|акп|cvt|automatic|вариатор|робот)' AND length(v.transmission) < 24 THEN 'Automatic'
        WHEN v.transmission ~* '(механ|мкпп|мкп|manual|ручн)' AND length(v.transmission) < 24 THEN 'Manual'
        WHEN v.transmission ~ '[А-Яа-яЁё]' OR v.transmission ~ 'Цена|Привод|Топливо'
          OR length(coalesce(v.transmission,'')) > 24 THEN NULL
        ELSE v.transmission
      END
      WHERE v.id IN (
        SELECT o.vehicle_id FROM vehicle_observations o
        JOIN providers p ON p.id = o.provider_id
        WHERE p.internal_name = ANY($1::text[]) AND o.vehicle_id IS NOT NULL
      )
        AND (
          v.transmission ~ '[А-Яа-яЁё]'
          OR v.transmission ~ 'Цена|Привод|Топливо'
          OR length(coalesce(v.transmission,'')) > 24
        )
    `, [PROVIDERS]);

    const color = await c.query(`
      UPDATE vehicles v
      SET color = CASE
        WHEN v.color ~* 'бел' THEN 'White'
        WHEN v.color ~* 'чёрн|черн' THEN 'Black'
        WHEN v.color ~* 'серебр' THEN 'Silver'
        WHEN v.color ~* 'сер|т[её]мн' THEN 'Grey'
        WHEN v.color ~* 'син|голуб' THEN 'Blue'
        WHEN v.color ~* 'красн' THEN 'Red'
        WHEN v.color ~* 'зел' THEN 'Green'
        WHEN v.color ~ '[А-Яа-яЁё]' OR length(coalesce(v.color,'')) > 40 THEN NULL
        ELSE v.color
      END
      WHERE v.id IN (
        SELECT o.vehicle_id FROM vehicle_observations o
        JOIN providers p ON p.id = o.provider_id
        WHERE p.internal_name = ANY($1::text[]) AND o.vehicle_id IS NOT NULL
      )
        AND (v.color ~ '[А-Яа-яЁё]' OR length(coalesce(v.color,'')) > 40)
    `, [PROVIDERS]);

    const body = await c.query(`
      UPDATE vehicles v
      SET body_type = CASE
        WHEN v.body_type ~* 'внедорож|кроссовер|suv' THEN 'SUV'
        WHEN v.body_type ~* 'седан' THEN 'Sedan'
        WHEN v.body_type ~* 'хэтч|хетч' THEN 'Hatchback'
        WHEN v.body_type ~* 'универсал' THEN 'Wagon'
        WHEN v.body_type ~* 'купе' THEN 'Coupe'
        WHEN v.body_type ~ '[А-Яа-яЁё]' OR length(coalesce(v.body_type,'')) > 40 THEN NULL
        ELSE v.body_type
      END
      WHERE v.id IN (
        SELECT o.vehicle_id FROM vehicle_observations o
        JOIN providers p ON p.id = o.provider_id
        WHERE p.internal_name = ANY($1::text[]) AND o.vehicle_id IS NOT NULL
      )
        AND (v.body_type ~ '[А-Яа-яЁё]' OR length(coalesce(v.body_type,'')) > 40)
    `, [PROVIDERS]);

    // BYN → USD on observations + listings
    const obsPrice = await c.query(
      `
      UPDATE vehicle_observations o
      SET
        price_usd = ROUND((o.price_amount / $2::numeric)::numeric, 2),
        price_amount = ROUND((o.price_amount / $2::numeric)::numeric, 2),
        price_currency = 'USD'
      FROM providers p
      WHERE p.id = o.provider_id
        AND p.internal_name = ANY($1::text[])
        AND upper(coalesce(o.price_currency,'')) = 'BYN'
        AND o.price_amount IS NOT NULL
        AND o.price_amount > 0
      `,
      [PROVIDERS, BYN_PER_USD],
    );

    const listPrice = await c.query(
      `
      UPDATE listings l
      SET
        price_usd = ROUND((l.price_amount / $2::numeric)::numeric, 2),
        price_amount = ROUND((l.price_amount / $2::numeric)::numeric, 2),
        price_currency = 'USD'
      FROM providers p
      WHERE p.id = l.provider_id
        AND p.internal_name = ANY($1::text[])
        AND upper(coalesce(l.price_currency,'')) = 'BYN'
        AND l.price_amount IS NOT NULL
        AND l.price_amount > 0
      `,
      [PROVIDERS, BYN_PER_USD],
    );

    // NFS origin country from source id (Korea / China) — never Belarus.
    const nfsListCountry = await c.query(`
      UPDATE listings l
      SET
        country = CASE
          WHEN o.source_listing_id ILIKE 'nfs-china-%' THEN 'China'
          WHEN o.source_listing_id ILIKE 'nfs-korea-%' THEN 'South Korea'
          ELSE l.country
        END,
        location = CASE
          WHEN o.source_listing_id ILIKE 'nfs-china-%' THEN 'China'
          WHEN o.source_listing_id ILIKE 'nfs-korea-%' THEN 'South Korea'
          ELSE l.location
        END
      FROM vehicle_observations o
      JOIN providers p ON p.id = o.provider_id
      WHERE o.listing_id = l.id
        AND p.internal_name = 'nfsauto'
        AND (
          (o.source_listing_id ILIKE 'nfs-china-%' AND coalesce(l.country,'') IS DISTINCT FROM 'China')
          OR (o.source_listing_id ILIKE 'nfs-korea-%' AND coalesce(l.country,'') IS DISTINCT FROM 'South Korea')
        )
    `);

    const nfsVehCountry = await c.query(`
      UPDATE vehicles v
      SET country = CASE
        WHEN o.source_listing_id ILIKE 'nfs-china-%' THEN 'China'
        WHEN o.source_listing_id ILIKE 'nfs-korea-%' THEN 'South Korea'
        ELSE v.country
      END
      FROM vehicle_observations o
      JOIN providers p ON p.id = o.provider_id
      WHERE o.vehicle_id = v.id
        AND p.internal_name = 'nfsauto'
        AND (
          (o.source_listing_id ILIKE 'nfs-china-%' AND coalesce(v.country,'') IS DISTINCT FROM 'China')
          OR (o.source_listing_id ILIKE 'nfs-korea-%' AND coalesce(v.country,'') IS DISTINCT FROM 'South Korea')
        )
    `);

    // Wipe crawl-dated "other" events that are clearly RU dumps (if any).
    const events = await c.query(
      `
      UPDATE vehicle_events e
      SET description = regexp_replace(
        e.description,
        '^(Привод|Топливо|Коробка|Цена).*$',
        'Listing detail',
        'i'
      )
      WHERE e.id IN (
        SELECT e2.id
        FROM vehicle_events e2
        JOIN vehicle_observations o ON o.vehicle_id = e2.vehicle_id
        JOIN providers p ON p.id = o.provider_id
        WHERE p.internal_name = ANY($1::text[])
          AND e2.description ~ '[А-Яа-яЁё]'
      )
        AND e.description ~ '[А-Яа-яЁё]'
      `,
      [PROVIDERS],
    );

    await c.query("COMMIT");
    console.log({
      drive: drive.rowCount,
      fuel: fuel.rowCount,
      trans: trans.rowCount,
      color: color.rowCount,
      body: body.rowCount,
      obsPrice: obsPrice.rowCount,
      listPrice: listPrice.rowCount,
      nfsListCountry: nfsListCountry.rowCount,
      nfsVehCountry: nfsVehCountry.rowCount,
      events: events.rowCount,
    });
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }

  const after = await c.query(
    `
    SELECT p.internal_name,
      count(*)::int AS obs,
      count(*) FILTER (WHERE o.price_currency = 'BYN')::int AS byn,
      count(*) FILTER (WHERE v.drive_type ~ '[А-Яа-яЁё]|Цена|Топливо')::int AS drive_bad,
      count(*) FILTER (WHERE v.fuel_type ~ '[А-Яа-яЁё]|Бренды|Цена')::int AS fuel_bad,
      count(*) FILTER (WHERE v.transmission ~ '[А-Яа-яЁё]|Цена|Привод')::int AS trans_bad
    FROM vehicle_observations o
    JOIN providers p ON p.id = o.provider_id
    LEFT JOIN vehicles v ON v.id = o.vehicle_id
    WHERE p.internal_name = ANY($1::text[])
    GROUP BY 1
    `,
    [PROVIDERS],
  );
  console.log("after", after.rows);
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
