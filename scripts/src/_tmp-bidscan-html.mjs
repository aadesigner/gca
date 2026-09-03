import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`
  SELECT v.vin, ve.metadata::text AS meta, ve.description,
    (SELECT ve2.metadata::text FROM vehicle_events ve2
      WHERE ve2.vehicle_id=v.id AND ve2.event_type='title_status' LIMIT 1) AS title_meta
  FROM vehicles v
  JOIN vehicle_events ve ON ve.vehicle_id=v.id
  WHERE ve.event_type='accident'
    AND ve.metadata::text ILIKE '%RUN AND DRIVE%'
    AND ve.description ILIKE '%BURN%'
  LIMIT 5
`);
console.log(r.rows);
const vin = r.rows[0]?.vin || '5XYKT4A11BG060946';
await c.end();
const url = 'https://bidscan.vin/cars/' + vin;
try {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  console.log('fetch', res.status, text.length);
  // Find Condition occurrences
  const idx = [];
  let i = 0;
  const lower = text.toLowerCase();
  while ((i = lower.indexOf('condition', i)) >= 0) {
    idx.push(text.slice(Math.max(0,i-80), i+120).replace(/\s+/g,' '));
    i += 9;
    if (idx.length > 12) break;
  }
  console.log('condition contexts', idx);
  // suggested section
  for (const key of ['suggest','similar','related','also like','more cars']) {
    const p = lower.indexOf(key);
    if (p>=0) console.log('found', key, 'at', p, text.slice(p, p+200).replace(/\s+/g,' '));
  }
} catch (e) {
  console.log('fetch err', e.message);
}
