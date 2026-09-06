/**
 * Backfill English translations for aaaauto + sauto vehicle details / events.
 *   node --import ./scripts/load-env.mjs ./scripts/src/fix-eu-english-backfill.mjs --prod
 *   node --import ./scripts/load-env.mjs ./scripts/src/fix-eu-english-backfill.mjs --prod --apply
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("../../lib/db/node_modules/pg");

const apply = process.argv.includes("--apply");

function fold(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const COLOR = [
  [/cern|cier|chern|black|schwarz/i, "Black"],
  [/biela|bila|bil[aay]|byal|white|weiss/i, "White"],
  [/siv|sed|grey|gray|grau/i, "Grey"],
  [/striebor|stribr|silver|silber/i, "Silver"],
  [/modr|sin|blue|blau/i, "Blue"],
  [/cerven|cherven|bordo|bordov|red|rot/i, "Red"],
  [/zelen|green|grun|grün/i, "Green"],
  [/zlt|zlut|zhult|yellow|gelb/i, "Yellow"],
  [/oranz|orange/i, "Orange"],
  [/hned|kafyav|brown|braun/i, "Brown"],
  [/bezov|beige/i, "Beige"],
  [/zlat|gold/i, "Gold"],
  [/fialov|purple|violet|lila/i, "Purple"],
];

const BODY = [
  [/suv|off.?road/i, "SUV"],
  [/kombi|wagon|estate|touring|break/i, "Wagon"],
  [/kompaktne\s*mpv|kompaktné\s*mpv|\bmpv\b|minivan/i, "MPV"],
  [/hatch|kompakt/i, "Hatchback"],
  [/sedan|limousine/i, "Sedan"],
  [/dodavka|uzitkov|van|transporter/i, "Van"],
  [/pickup|valnik/i, "Pickup"],
  [/cabrio|convertible/i, "Convertible"],
  [/cupe|coupe|kup/i, "Coupe"],
  [/\bbus\b/i, "Bus"],
  [/osobni|osobní/i, "Passenger"],
  [/nakladni|nákladní/i, "Truck"],
  [/obytne|obytné/i, "Motorhome"],
  [/motorky/i, "Motorcycle"],
];

const EVENT = {
  "servisna knizka": "Service book",
  "servisni knizka": "Service book",
  "kupene nove v sr": "Bought new in Slovakia",
  "kouvene nove v cr": "Bought new in Czechia",
  "kouvene nove v cr": "Bought new in Czechia",
  "po prvom majitelovi": "One previous owner",
  "po prvnim majiteli": "One previous owner",
  "predvadzacie vozidlo": "Demo vehicle",
  "predvadecí vuz": "Demo vehicle",
};

function mapList(raw, rules) {
  if (!raw) return null;
  const t = String(raw).trim();
  const f = fold(t);
  for (const [re, en] of rules) if (re.test(t) || re.test(f)) return en;
  return null;
}

function mapEvent(raw) {
  if (!raw) return null;
  const t = String(raw).trim();
  const f = fold(t);
  if (EVENT[f]) return EVENT[f];
  if (/^stk\s*\/\s*technical control valid until\s+(\d{4}-\d{2}-\d{2})$/i.test(t)) {
    return t.replace(/^STK\s*\/\s*technical control/i, "Technical inspection");
  }
  if (/servisn/i.test(f) && /knizk|knížk|knižk/i.test(t + f)) return "Service book";
  if (/kupen|koupen/i.test(f) && /nove|nové/i.test(t + f) && /\bsr\b/i.test(f)) return "Bought new in Slovakia";
  if (/po\s+prvom?\s+majitel/i.test(f)) return "One previous owner";
  if (/predvad/i.test(f)) return "Demo vehicle";
  return null;
}

const c = new pg.Client({
  host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT || 15622),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
});
await c.connect();

async function providerId(name) {
  return (await c.query(`SELECT id FROM providers WHERE internal_name=$1`, [name])).rows[0]?.id;
}

async function backfillProvider(name) {
  const pid = await providerId(name);
  if (!pid) return;
  console.log(`\n======== ${name} ========`);

  const colors = await c.query(
    `SELECT DISTINCT v.color FROM listings l JOIN vehicles v ON v.id=l.vehicle_id
     WHERE l.provider_id=$1 AND v.color IS NOT NULL`,
    [pid],
  );
  let colorUpdates = 0;
  for (const row of colors.rows) {
    const en = mapList(row.color, COLOR);
    if (!en || en === row.color) continue;
    console.log(`  color ${row.color} → ${en}`);
    if (apply) {
      const r = await c.query(
        `UPDATE vehicles v SET color=$1
         FROM listings l WHERE l.vehicle_id=v.id AND l.provider_id=$2 AND v.color=$3`,
        [en, pid, row.color],
      );
      colorUpdates += r.rowCount || 0;
    } else colorUpdates += 1;
  }

  const bodies = await c.query(
    `SELECT DISTINCT v.body_type FROM listings l JOIN vehicles v ON v.id=l.vehicle_id
     WHERE l.provider_id=$1 AND v.body_type IS NOT NULL`,
    [pid],
  );
  let bodyUpdates = 0;
  for (const row of bodies.rows) {
    const en = mapList(row.body_type, BODY);
    if (!en || en === row.body_type) continue;
    console.log(`  body ${row.body_type} → ${en}`);
    if (apply) {
      const r = await c.query(
        `UPDATE vehicles v SET body_type=$1
         FROM listings l WHERE l.vehicle_id=v.id AND l.provider_id=$2 AND v.body_type=$3`,
        [en, pid, row.body_type],
      );
      bodyUpdates += r.rowCount || 0;
    } else bodyUpdates += 1;
  }

  // Bulk-normalize STK wording (already mostly English).
  if (apply) {
    const stk = await c.query(
      `UPDATE vehicle_events e
       SET description = regexp_replace(e.description, '^STK\\s*/\\s*technical control', 'Technical inspection', 'i')
       FROM listings l
       WHERE l.vehicle_id = e.vehicle_id
         AND l.provider_id = $1
         AND e.description ~* '^STK\\s*/\\s*technical control'`,
      [pid],
    );
    console.log(`  STK wording rows=${stk.rowCount}`);
  }

  const events = await c.query(
    `SELECT DISTINCT e.description
     FROM vehicle_events e
     JOIN listings l ON l.vehicle_id = e.vehicle_id
     WHERE l.provider_id=$1
       AND e.description !~* '^STK\\s*/\\s*technical'
       AND e.description !~* '^Technical inspection'`,
    [pid],
  );
  let eventUpdates = 0;
  for (const row of events.rows) {
    const en = mapEvent(row.description);
    if (!en || en === row.description) continue;
    console.log(`  event ${row.description} → ${en}`);
    if (apply) {
      const r = await c.query(
        `UPDATE vehicle_events e SET description=$1
         FROM listings l
         WHERE l.vehicle_id=e.vehicle_id AND l.provider_id=$2 AND e.description=$3`,
        [en, pid, row.description],
      );
      eventUpdates += r.rowCount || 0;
    } else eventUpdates += 1;
  }

  console.log(`  would/did update colors≈${colorUpdates} bodies≈${bodyUpdates} events≈${eventUpdates}`);
  if (apply) {
    const ver = name === "aaaauto" ? "aaaauto-v1.0.3" : name === "sauto" ? "sauto-v1.0.1" : null;
    if (ver) await c.query(`UPDATE providers SET parser_version=$1 WHERE id=$2`, [ver, pid]);
  }
}

await backfillProvider("aaaauto");
await backfillProvider("sauto");

console.log(apply ? "\napplied" : "\ndry-run — re-run with --apply");
await c.end();
