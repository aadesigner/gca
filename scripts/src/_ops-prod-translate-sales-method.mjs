import fs from "node:fs";
import pg from "pg";

function translateExtraValue(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  if (!t || !/[가-힣]/.test(t)) return t;
  t = t.replace(/^\?\s*/, "");
  const phraseMap = [
    [/판매상사\s*[：:]/g, "Selling dealer: "],
    [/판매방식\s*[：:]/g, "Sales method: "],
    [/광고동의여부\s*[：:]/g, "Ad consent: "],
    [/판매자\s*[：:]/g, "Seller: "],
    [/딜러\s*[：:]/g, "Dealer: "],
    [/매매상사\s*[：:]/g, "Dealer: "],
    [/미동의|비동의|부동의/g, "Not agreed"],
    [/동의/g, "Agreed"],
    [/없음/g, "None"],
    [/있음/g, "Yes"],
    [/\(주\)/g, "Co. "],
    [/주식회사/g, "Co. "],
    [/\(수원\)/g, "(Suwon)"],
    [/\(안산\)/g, "(Ansan)"],
    [/\(인천\)/g, "(Incheon)"],
    [/\(서울\)/g, "(Seoul)"],
    [/\(부산\)/g, "(Busan)"],
    [/\(대구\)/g, "(Daegu)"],
    [/\(대전\)/g, "(Daejeon)"],
    [/\(광주\)/g, "(Gwangju)"],
    [/\(울산\)/g, "(Ulsan)"],
    [/\(경기\)/g, "(Gyeonggi)"],
    [/\(성남\)/g, "(Seongnam)"],
    [/\(용인\)/g, "(Yongin)"],
    [/\(고양\)/g, "(Goyang)"],
    [/\(부천\)/g, "(Bucheon)"],
    [/\(화성\)/g, "(Hwaseong)"],
    [/\(평택\)/g, "(Pyeongtaek)"],
    [/\(천안\)/g, "(Cheonan)"],
    [/\(청주\)/g, "(Cheongju)"],
  ];
  for (const [re, en] of phraseMap) t = t.replace(re, en);
  return t.replace(/\s{2,}/g, " ").trim();
}

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => (vars[n] && typeof vars[n]==="object" && "value" in vars[n] ? vars[n].value : vars[n]);
const url = `postgresql://${encodeURIComponent(get("PGUSER")||get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD")||get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE")||"railway"}`;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 0 });
await c.connect();
const { rows } = await c.query(`
  SELECT id, metadata, description
  FROM vehicle_events
  WHERE metadata::jsonb->>'field' = 'sales_method'
    AND metadata::jsonb->>'value' ~ '[가-힣]'
`);
console.log("to_update", rows.length);
let updated = 0;
for (const row of rows) {
  const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
  const next = translateExtraValue(meta.value);
  if (!next || next === meta.value) continue;
  meta.value = next;
  const desc = `Sales method: ${next}`;
  await c.query(`UPDATE vehicle_events SET metadata=$2, description=$3 WHERE id=$1`, [row.id, JSON.stringify(meta), desc]);
  updated++;
  if (updated % 500 === 0) console.log("updated", updated);
}
console.log("done", updated);
const sample = await c.query(`
  SELECT metadata::jsonb->>'value' AS val, count(*)::int AS n
  FROM vehicle_events WHERE metadata::jsonb->>'field'='sales_method'
  GROUP BY 1 ORDER BY n DESC LIMIT 5
`);
console.log(sample.rows);
await c.end();
