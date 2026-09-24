/**
 * Inspect client 96 purchases + optionally credit BEP20 deposit.
 * CREDIT=1 APPROVE_PENDING=1 node ./scripts/src/_ops-find-usdt-deposit.mjs
 */
import fs from "node:fs";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env", override: true });
const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
const url = `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;

const BSC_TX = "0x7f01269f4641648484ec22c6ef0857751496b5e915f6b979058aa77c33864cda";
const ETH_TX = "0x4a544b38bc6531313bb3a92ce58a678ae5de705f39429e04673f6420269dbc90";
const CLIENT_ID = 96;

const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false } });

const client = await pool.query(
  `SELECT id, email, name, credit_balance, created_at FROM api_clients WHERE id = $1`,
  [CLIENT_ID],
);
console.log("client", client.rows[0]);

const purchases = await pool.query(
  `SELECT id, status, amount_usd, credits, crypto_currency, tx_hash, proof_path, payer_note, admin_note, created_at, reviewed_at
   FROM credit_purchases WHERE client_id = $1 ORDER BY id`,
  [CLIENT_ID],
);
console.log("purchases", JSON.stringify(purchases.rows, null, 2));

const ledger = await pool.query(
  `SELECT id, delta, balance_after, reason, ref_type, ref_id, created_at
   FROM credit_ledger WHERE client_id = $1 ORDER BY id DESC LIMIT 20`,
  [CLIENT_ID],
);
console.log("ledger", ledger.rows);

if (process.env.CREDIT === "1") {
  // Attach BEP20 tx to oldest open USDT_BNB purchase and mark pending, then approve via SQL mirror of approve flow.
  const { rows: openBnb } = await pool.query(
    `SELECT id FROM credit_purchases
     WHERE client_id = $1 AND status = 'awaiting_proof' AND crypto_currency = 'USDT_BNB'
     ORDER BY id ASC LIMIT 1`,
    [CLIENT_ID],
  );
  if (!openBnb[0]) throw new Error("no awaiting_proof USDT_BNB purchase");
  const purchaseId = openBnb[0].id;

  await pool.query("BEGIN");
  try {
    await pool.query(
      `UPDATE credit_purchases
       SET tx_hash = $1,
           status = 'pending',
           crypto_currency = 'USDT_BNB',
           payer_note = coalesce(payer_note, '') || ' [ops: attached client BSC tx]',
           updated_at = now()
       WHERE id = $2`,
      [BSC_TX, purchaseId],
    );

    // Reject other duplicate awaiting_proof for same client (no double credit)
    await pool.query(
      `UPDATE credit_purchases
       SET status = 'rejected',
           admin_note = 'Duplicate checkout abandoned — payment credited on purchase #' || $2,
           reviewed_at = now(),
           updated_at = now()
       WHERE client_id = $1 AND status = 'awaiting_proof' AND id <> $2`,
      [CLIENT_ID, purchaseId],
    );

    const credits = 25;
    const { rows: bal } = await pool.query(
      `UPDATE api_clients SET credit_balance = credit_balance + $1, updated_at = now()
       WHERE id = $2 RETURNING credit_balance`,
      [credits, CLIENT_ID],
    );
    await pool.query(
      `INSERT INTO credit_ledger (client_id, delta, balance_after, reason, ref_type, ref_id)
       VALUES ($1, $2, $3, 'purchase_approved', 'purchase', $4)`,
      [CLIENT_ID, credits, bal[0].credit_balance, String(purchaseId)],
    );
    await pool.query(
      `UPDATE credit_purchases
       SET status = 'approved',
           admin_note = $1,
           reviewed_at = now(),
           updated_at = now()
       WHERE id = $2`,
      [
        `Manual approve: confirmed 50 USDT BEP20 on BSC ${BSC_TX}. UI bug had mislabeled network as ERC20.`,
        purchaseId,
      ],
    );
    await pool.query("COMMIT");
    console.log("credited_bep20", { purchaseId, balance: bal[0].credit_balance });
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }
}

if (process.env.APPROVE_PENDING === "1") {
  // Approve purchase #18 if still pending with ETH tx
  const { rows } = await pool.query(
    `SELECT id, status, credits, tx_hash FROM credit_purchases WHERE id = 18 AND client_id = $1`,
    [CLIENT_ID],
  );
  const p = rows[0];
  if (!p) throw new Error("purchase 18 missing");
  if (p.status === "approved") {
    console.log("purchase 18 already approved");
  } else if (p.status !== "pending") {
    throw new Error(`purchase 18 status ${p.status}`);
  } else {
    await pool.query("BEGIN");
    try {
      const credits = Number(p.credits);
      const { rows: bal } = await pool.query(
        `UPDATE api_clients SET credit_balance = credit_balance + $1, updated_at = now()
         WHERE id = $2 RETURNING credit_balance`,
        [credits, CLIENT_ID],
      );
      await pool.query(
        `INSERT INTO credit_ledger (client_id, delta, balance_after, reason, ref_type, ref_id)
         VALUES ($1, $2, $3, 'purchase_approved', 'purchase', '18')`,
        [CLIENT_ID, credits, bal[0].credit_balance],
      );
      await pool.query(
        `UPDATE credit_purchases
         SET status = 'approved',
             admin_note = $1,
             reviewed_at = now(),
             updated_at = now()
         WHERE id = 18`,
        [`Approved: confirmed 50 USDT ERC20 on ETH ${ETH_TX}`],
      );
      await pool.query("COMMIT");
      console.log("credited_erc20", { purchaseId: 18, balance: bal[0].credit_balance });
    } catch (e) {
      await pool.query("ROLLBACK");
      throw e;
    }
  }
}

await pool.end();
