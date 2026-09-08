-- Fold German BMW "Ner" / "N er" / "N-er" and Series spellings into "N Series".
-- Hyphen must be last inside the character class (Postgres POSIX regex).
UPDATE "vehicles"
SET "model" = (regexp_match(lower(btrim("model")), '^([1-8])'))[1] || ' Series'
WHERE lower(btrim("model")) ~ '^[1-8][[:space:]/_-]*er$';
--> statement-breakpoint
UPDATE "vehicles"
SET "model" = (regexp_match(lower(btrim("model")), '^([1-8])'))[1] || ' Series'
WHERE lower(btrim("model")) ~ '^[1-8][[:space:]/_-]*series$'
  AND "model" IS DISTINCT FROM ((regexp_match(lower(btrim("model")), '^([1-8])'))[1] || ' Series');
