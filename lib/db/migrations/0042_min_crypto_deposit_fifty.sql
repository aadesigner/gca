-- Minimum USDT top-up: $50 (= 25 credits at $2/retrieve).
UPDATE "settings"
SET "min_crypto_deposit_usd" = 50.00
WHERE "min_crypto_deposit_usd" < 50.00;
