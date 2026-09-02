-- Purchases without proof were incorrectly marked pending at checkout.
UPDATE "credit_purchases"
SET "status" = 'awaiting_proof'
WHERE "status" = 'pending'
  AND "proof_path" IS NULL
  AND ("tx_hash" IS NULL OR btrim("tx_hash") = '');
