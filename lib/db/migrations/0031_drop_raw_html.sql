-- Never persist provider HTML. JSON / parsed fields / photo URLs only.
DELETE FROM "raw_source_records"
WHERE "raw_json" IS NULL OR btrim("raw_json") = '' OR "raw_json" = 'null';
--> statement-breakpoint
ALTER TABLE "raw_source_records" DROP COLUMN IF EXISTS "raw_html";
