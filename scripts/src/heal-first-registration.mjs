/**
 * Deduplicate first-registration delivery events: keep one best row per VIN.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/heal-first-registration.mjs
 *   node --import ./scripts/load-env.mjs ./scripts/src/heal-first-registration.mjs --apply
 */
import pg from "pg";

const apply = process.argv.includes("--apply");
const url =
  process.env.LOCAL_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function score(row) {
  const meta = parseMeta(row.metadata);
  const value = String(meta.value ?? "").trim() ||
    (String(row.description ?? "").match(/First registration:\s*(.+)$/i)?.[1]?.trim() ?? "");
  let s = 0;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) s += 100;
  else if (/^\d{4}-\d{2}$/.test(value)) s += 50;
  else if (/^\d{4}$/.test(value)) s += 10;
  else if (value) s += 5;
  const source = String(meta.source ?? "");
  if (source === "productionYear") s -= 40;
  if (/kbchachacha|encar|autowini|inspection|autoplac|mobilede|autoscout/i.test(source)) s += 25;
  return s;
}

const c = new pg.Client({ connectionString: url });
await c.connect();

const multi = await c.query(`
  SELECT vehicle_id
  FROM vehicle_events
  WHERE event_type = 'delivery'
    AND (
      description ILIKE '%first registration%'
      OR metadata::text ILIKE '%firstRegistration%'
    )
  GROUP BY vehicle_id
  HAVING count(*) > 1
`);

let deleted = 0;
for (const { vehicle_id } of multi.rows) {
  const rows = (
    await c.query(
      `
    SELECT id, description, metadata, occurred_at
    FROM vehicle_events
    WHERE vehicle_id = $1
      AND event_type = 'delivery'
      AND (
        description ILIKE '%first registration%'
        OR metadata::text ILIKE '%firstRegistration%'
      )
    ORDER BY id
  `,
      [vehicle_id],
    )
  ).rows;

  rows.sort((a, b) => {
    const ds = score(b) - score(a);
    if (ds !== 0) return ds;
    return new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime();
  });
  const keep = rows[0];
  const drop = rows.slice(1).map((r) => r.id);
  if (!drop.length) continue;
  deleted += drop.length;
  if (apply) {
    await c.query(`DELETE FROM vehicle_events WHERE id = ANY($1::int[])`, [drop]);
  }
}

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      vins_with_multi: multi.rows.length,
      rows_to_delete: deleted,
    },
    null,
    2,
  ),
);
await c.end();
