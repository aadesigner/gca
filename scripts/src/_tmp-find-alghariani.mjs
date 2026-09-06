import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("../../lib/db/node_modules/pg");

const c = new pg.Client({
  host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT || 15622),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
});
await c.connect();

const clients = await c.query(`
  SELECT id, name, email, company_name, credit_balance, is_active, is_demo,
         live_feed_enabled, last_login_at, created_at
  FROM api_clients
  WHERE name ILIKE '%alghariani%'
     OR email ILIKE '%alghariani%'
     OR company_name ILIKE '%alghariani%'
     OR name ILIKE '%ghariani%'
     OR email ILIKE '%ghariani%'
     OR name ILIKE '%alghar%'
     OR telegram_username ILIKE '%alghar%'
  ORDER BY id
`);
console.log("matched:", clients.rows);

if (!clients.rows.length) {
  const recent = await c.query(`
    SELECT id, name, email, company_name, credit_balance, is_active, created_at
    FROM api_clients
    WHERE created_at > now() - interval '30 days'
    ORDER BY id DESC LIMIT 50
  `);
  console.log("recent 30d:", recent.rows);
}

await c.end();
