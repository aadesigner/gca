-- Mix ISO codes with display names: KR = South Korea, US = United States, etc.
UPDATE "vehicles" SET "country" = 'South Korea'
WHERE lower(btrim("country")) IN ('kr','kor','korea','s korea','s. korea','south korea','republic of korea','rok');
--> statement-breakpoint
UPDATE "listings" SET "country" = 'South Korea'
WHERE lower(btrim("country")) IN ('kr','kor','korea','s korea','s. korea','south korea','republic of korea','rok');
--> statement-breakpoint
UPDATE "vehicles" SET "country" = 'United States'
WHERE lower(btrim("country")) IN ('us','usa','u.s.','u.s.a.','united states','united states of america','america');
--> statement-breakpoint
UPDATE "listings" SET "country" = 'United States'
WHERE lower(btrim("country")) IN ('us','usa','u.s.','u.s.a.','united states','united states of america','america');
--> statement-breakpoint
UPDATE "vehicles" SET "country" = 'Canada'
WHERE lower(btrim("country")) IN ('ca','can','canada');
--> statement-breakpoint
UPDATE "listings" SET "country" = 'Canada'
WHERE lower(btrim("country")) IN ('ca','can','canada');
--> statement-breakpoint
UPDATE "vehicles" SET "country" = 'United Arab Emirates'
WHERE lower(btrim("country")) IN ('ae','uae','united arab emirates');
--> statement-breakpoint
UPDATE "listings" SET "country" = 'United Arab Emirates'
WHERE lower(btrim("country")) IN ('ae','uae','united arab emirates');
--> statement-breakpoint
UPDATE "vehicles" SET "country" = 'United Kingdom'
WHERE lower(btrim("country")) IN ('gb','uk','united kingdom','great britain');
--> statement-breakpoint
UPDATE "listings" SET "country" = 'United Kingdom'
WHERE lower(btrim("country")) IN ('gb','uk','united kingdom','great britain');
--> statement-breakpoint
UPDATE "vehicles" SET "country" = 'Georgia'
WHERE lower(btrim("country")) IN ('ge','geo','georgia');
--> statement-breakpoint
UPDATE "listings" SET "country" = 'Georgia'
WHERE lower(btrim("country")) IN ('ge','geo','georgia');
--> statement-breakpoint
UPDATE "vehicles" SET "country" = 'Germany'
WHERE lower(btrim("country")) IN ('de','deu','germany');
--> statement-breakpoint
UPDATE "listings" SET "country" = 'Germany'
WHERE lower(btrim("country")) IN ('de','deu','germany');
--> statement-breakpoint
UPDATE "vehicles" SET "country" = 'France'
WHERE lower(btrim("country")) IN ('fr','fra','france');
--> statement-breakpoint
UPDATE "listings" SET "country" = 'France'
WHERE lower(btrim("country")) IN ('fr','fra','france');
--> statement-breakpoint
UPDATE "vehicles" SET "country" = 'Poland'
WHERE lower(btrim("country")) IN ('pl','pol','poland');
--> statement-breakpoint
UPDATE "listings" SET "country" = 'Poland'
WHERE lower(btrim("country")) IN ('pl','pol','poland');
--> statement-breakpoint
UPDATE "vehicles" SET "country" = NULL
WHERE "country" IS NOT NULL AND btrim("country") = '';
--> statement-breakpoint
UPDATE "listings" SET "country" = NULL
WHERE "country" IS NOT NULL AND btrim("country") = '';
