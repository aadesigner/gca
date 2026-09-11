/**
 * Backfill Seobuk model/trim from listing titles (literal tokens only).
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-seobuk-title-enrich.mjs
 *   DRY_RUN=1 node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-seobuk-title-enrich.mjs
 */
import fs from "node:fs";
import pg from "pg";

function seobukTitleEnrichment(title) {
  const body = String(title ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\[[^\]]+\]\s*/, "")
    .trim();
  if (!body) return {};
  const paren = body.match(/\(([A-Za-z][0-9]{2}[A-Za-z]?)\)/);
  if (paren?.[1] && paren.index != null) {
    const chassis = paren[1].toUpperCase();
    const titleTrim = body
      .slice(paren.index + paren[0].length)
      .replace(/^[\s\-–—|/.,]+/, "")
      .trim();
    return { chassis, titleTrim: titleTrim || undefined };
  }
  const mb = body.match(/\b((?:W|C|V|X|A)\d{3})\b/i);
  if (mb?.[1] && mb.index != null) {
    const chassis = mb[1].toUpperCase();
    const titleTrim = body
      .slice(mb.index + mb[0].length)
      .replace(/^[\s\-–—|/.,]+/, "")
      .trim();
    return { chassis, titleTrim: titleTrim || undefined };
  }
  return {};
}

function cleanDisplacement(raw) {
  const text = raw?.replace(/\s+/g, " ").trim();
  if (!text || text === "-" || /^0+(\.0+)?(?:\s*cc)?$/i.test(text)) return undefined;
  return text;
}

function applySeobukTitleEnrichment(title, parts) {
  const { chassis, titleTrim } = seobukTitleEnrichment(title);
  let model = parts.model?.replace(/\s+/g, " ").trim() || undefined;
  let trim = parts.trim?.replace(/\s+/g, " ").trim() || undefined;
  const engineDisplacement = cleanDisplacement(parts.engineDisplacement);

  if (chassis) {
    const hasChassis =
      (model && new RegExp(`\\b${chassis}\\b`, "i").test(model)) ||
      (trim && new RegExp(`\\b${chassis}\\b`, "i").test(trim));
    if (!hasChassis && model) {
      model = /\([A-Za-z][0-9]{2}[A-Za-z]?\)/.test(model) ? model : `${model} (${chassis})`;
    } else if (!hasChassis && !model) {
      model = chassis;
    }
  }
  if ((!trim || trim === "-") && titleTrim) trim = titleTrim;
  return { model, trim, engineDisplacement };
}

function loadProdUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const dry = process.env.DRY_RUN === "1";
const c = new pg.Client({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0,
});
await c.connect();

for (const t of [
  "[BMW] 5 Series (F10) 528i xDrive M Aerodynamics Special Edition",
  "[BMW] 5 Series (G30) 520d xDrive M Sport Plus",
  "[Mercedes Benz] E-Class W213 E220d 4MATIC Avantgarde",
  "[Land Rover] Discovery Sport 2.0 TD4 HSE Luxury",
]) {
  console.log("sample", t, "→", seobukTitleEnrichment(t));
}

const rows = await c.query(`
  SELECT v.id AS vehicle_id, l.title, v.model, v.trim, v.engine_displacement
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE p.internal_name = 'seobuk'
    AND l.title IS NOT NULL AND l.title <> ''
`);

let updated = 0;
let clearedEngine = 0;
for (const row of rows.rows) {
  const next = applySeobukTitleEnrichment(row.title, {
    model: row.model ?? undefined,
    trim: row.trim ?? undefined,
    engineDisplacement: row.engine_displacement ?? undefined,
  });
  const patch = {};
  if (next.model && next.model !== row.model) patch.model = next.model;
  if (next.trim && next.trim !== row.trim && (!row.trim || !String(row.trim).trim())) {
    patch.trim = next.trim;
  }
  if (row.engine_displacement && /^0+(\.0+)?(?:\s*cc)?$/i.test(String(row.engine_displacement).trim())) {
    patch.engine_displacement = null;
    clearedEngine += 1;
  }
  if (!Object.keys(patch).length) continue;
  updated += 1;
  if (dry) {
    if (updated <= 10) {
      console.log("would_update", {
        title: row.title,
        from: { model: row.model, trim: row.trim, engine: row.engine_displacement },
        patch,
      });
    }
    continue;
  }
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = $${i++}`);
    vals.push(v);
  }
  vals.push(row.vehicle_id);
  await c.query(`UPDATE vehicles SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${i}`, vals);
}

console.log({ dry, scanned: rows.rows.length, updated, clearedEngine });
await c.end();
