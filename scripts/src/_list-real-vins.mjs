import pg from "pg";

const testVins = [
  "1FA6P8CF5K5120103",
  "ZAM57XSA5H1238315",
  "WDDUX8GB8JA397509",
  "ZAM57XSA4E1123233",
  "WBS3C910XFP708160",
];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const placeholders = testVins.map((_, i) => `$${i + 1}`).join(",");
const q = `SELECT vin FROM vehicles WHERE vin NOT IN (${placeholders}) LIMIT 5`;
const { rows } = await pool.query(q, testVins);
console.log(rows.map((r) => r.vin).join("\n"));
await pool.end();
