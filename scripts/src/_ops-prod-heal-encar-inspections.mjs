/**
 * Heal Encar inspection events on prod (batched).
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-heal-encar-inspections.mjs
 */
import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

function formatEncarDate(raw) {
  if (!raw) return undefined;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(raw))) return String(raw).slice(0, 10);
  return undefined;
}

function normalizeStatus(raw) {
  if (!raw) return undefined;
  const map = {
    양호: "Good",
    불량: "Defective",
    없음: "None",
    해당없음: "None",
    정상: "Normal",
    Good: "Good",
    Defective: "Defective",
    None: "None",
    Normal: "Normal",
  };
  const t = String(raw).trim();
  return map[t] ?? (/[가-힣]/.test(t) ? undefined : t);
}

function meaningful(status) {
  if (!status) return false;
  const s = status.toLowerCase();
  return s !== "none" && s !== "n/a" && s !== "absent";
}

function buildSummary(meta) {
  const issueDate = formatEncarDate(meta.issueDate) ?? formatEncarDate(meta.validityStartDate);
  const firstReg = formatEncarDate(meta.firstRegistrationDate);
  const validFrom = formatEncarDate(meta.validityStartDate);
  const validTo = formatEncarDate(meta.validityEndDate);
  const board = normalizeStatus(meta.boardState);
  const car = normalizeStatus(meta.carState);
  const parts = ["Korean performance inspection"];
  if (meta.recordNo) parts.push(`record #${meta.recordNo}`);
  if (issueDate) parts.push(`issued ${issueDate}`);
  if (meta.mileage != null) parts.push(`${Number(meta.mileage).toLocaleString("en-US")} km`);
  if (meaningful(board)) parts.push(`structure/frame: ${board}`);
  if (meaningful(car)) parts.push(`vehicle condition: ${car}`);
  if (!meaningful(board) && !meaningful(car) && (board || car || meta.boardState || meta.carState)) {
    parts.push("no defects noted on structure or condition check");
  }
  if (validFrom && validTo) parts.push(`valid ${validFrom} → ${validTo}`);
  else if (validTo) parts.push(`valid until ${validTo}`);
  if (firstReg) parts.push(`first registered ${firstReg}`);
  return {
    description: parts.join(" — "),
    meta: {
      ...meta,
      boardState: board ?? meta.boardState,
      carState: car ?? meta.carState,
      issueDate: issueDate ?? meta.issueDate,
      firstRegistrationDate: firstReg ?? meta.firstRegistrationDate,
      validityStartDate: validFrom ?? meta.validityStartDate,
      validityEndDate: validTo ?? meta.validityEndDate,
      healedAt: new Date().toISOString(),
    },
    issueDate,
    firstReg,
    validFrom,
    validTo,
    board,
    car,
  };
}

function isGarbagePanel(desc, meta) {
  if (!/Inspection panel notes/i.test(desc || "")) return false;
  if (/\(\): None/i.test(desc) || /\/:\s*None/i.test(desc)) return true;
  const panels = meta?.panels;
  if (Array.isArray(panels) && panels.length) {
    return panels.every((p) => /none/i.test(String(p)) && String(p).length < 20);
  }
  return false;
}

const dry = process.env.DRY_RUN === "1";
const limit = Number(process.env.LIMIT || 100000);
const c = new pg.Client({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0,
});
await c.connect();

console.log("loading candidates…");
const rows = await c.query(
  `
  SELECT ve.id, ve.vehicle_id, ve.description, ve.metadata, ve.occurred_at
  FROM vehicle_events ve
  WHERE EXISTS (
    SELECT 1 FROM listings l
    JOIN providers p ON p.id = l.provider_id
    WHERE l.vehicle_id = ve.vehicle_id AND p.internal_name = 'encar'
  )
  AND (
    ve.description ILIKE 'Performance inspection%'
    OR ve.description ILIKE 'Inspection panel notes%'
  )
  ORDER BY ve.id DESC
  LIMIT $1
  `,
  [limit],
);
console.log("scanned", rows.rows.length);

const deleteIds = [];
const rewrites = [];
const extras = [];
const samples = [];

for (const row of rows.rows) {
  let meta = {};
  try {
    meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata || {};
  } catch {
    meta = {};
  }

  if (isGarbagePanel(row.description, meta)) {
    deleteIds.push(row.id);
    if (samples.length < 6) samples.push({ action: "delete", description: row.description });
    continue;
  }

  if (meta.source === "encar_inspection" && /Performance inspection/i.test(row.description || "")) {
    const built = buildSummary(meta);
    if (built.description !== row.description) {
      rewrites.push({
        id: row.id,
        description: built.description,
        metadata: JSON.stringify(built.meta),
        vehicleId: row.vehicle_id,
        occurredAt: row.occurred_at,
        built,
      });
      if (samples.length < 6) {
        samples.push({ action: "rewrite", before: row.description, after: built.description });
      }
    }
  }
}

console.log("planned", { delete: deleteIds.length, rewrite: rewrites.length });

if (!dry) {
  for (let i = 0; i < deleteIds.length; i += 1000) {
    const chunk = deleteIds.slice(i, i + 1000);
    await c.query(`DELETE FROM vehicle_events WHERE id = ANY($1::int[])`, [chunk]);
    process.stdout.write(`\rdeleted ${Math.min(i + chunk.length, deleteIds.length)}/${deleteIds.length}`);
  }
  console.log("\ndeletes done");

  for (let i = 0; i < rewrites.length; i += 200) {
    const chunk = rewrites.slice(i, i + 200);
    const ids = chunk.map((r) => r.id);
    const descs = chunk.map((r) => r.description);
    const metas = chunk.map((r) => r.metadata);
    await c.query(
      `
      UPDATE vehicle_events AS v SET
        description = u.description,
        metadata = u.metadata
      FROM unnest($1::int[], $2::text[], $3::text[]) AS u(id, description, metadata)
      WHERE v.id = u.id
      `,
      [ids, descs, metas],
    );

    // Insert unified extras for this chunk
    for (const r of chunk) {
      const b = r.built;
      const pairs = [];
      if (b.meta.mileage != null) {
        pairs.push(["inspection_mileage", "Inspection odometer", `${Number(b.meta.mileage).toLocaleString("en-US")} km`]);
      }
      if (b.meta.recordNo) pairs.push(["inspection_record_no", "Inspection record #", String(b.meta.recordNo)]);
      if (b.issueDate) pairs.push(["inspection_issued", "Inspection issued", b.issueDate]);
      if (b.validFrom) pairs.push(["inspection_valid_from", "Inspection valid from", b.validFrom]);
      if (b.validTo) pairs.push(["inspection_valid_to", "Inspection valid until", b.validTo]);
      if (b.firstReg) pairs.push(["first_registration", "First registration", b.firstReg]);
      if (meaningful(b.board)) pairs.push(["inspection_structure", "Inspection structure/frame", b.board]);
      if (meaningful(b.car)) pairs.push(["inspection_condition", "Inspection vehicle condition", b.car]);

      for (const [field, label, value] of pairs) {
        extras.push({
          vehicleId: r.vehicleId,
          description: `${label}: ${value}`,
          occurredAt: r.occurredAt,
          metadata: JSON.stringify({
            source: "encar_inspection",
            field,
            value,
            date: b.issueDate,
          }),
        });
      }
    }
    process.stdout.write(`\rrewritten ${Math.min(i + chunk.length, rewrites.length)}/${rewrites.length}`);
  }
  console.log("\nrewrites done");

  for (let i = 0; i < extras.length; i += 500) {
    const chunk = extras.slice(i, i + 500);
    const vids = chunk.map((e) => e.vehicleId);
    const descs = chunk.map((e) => e.description);
    const times = chunk.map((e) => e.occurredAt);
    const metas = chunk.map((e) => e.metadata);
    await c.query(
      `
      INSERT INTO vehicle_events (vehicle_id, event_type, description, occurred_at, metadata)
      SELECT t.vehicle_id, 'other', t.description, t.occurred_at, t.metadata
      FROM unnest($1::int[], $2::text[], $3::timestamptz[], $4::text[])
        AS t(vehicle_id, description, occurred_at, metadata)
      ON CONFLICT DO NOTHING
      `,
      [vids, descs, times, metas],
    );
    process.stdout.write(`\rextras ${Math.min(i + chunk.length, extras.length)}/${extras.length}`);
  }
  console.log("\nextras done");
}

console.log(JSON.stringify({ dry, scanned: rows.rows.length, deleted: deleteIds.length, rewritten: rewrites.length, extras: extras.length || rewrites.length * 6, samples }, null, 2));
await c.end();
