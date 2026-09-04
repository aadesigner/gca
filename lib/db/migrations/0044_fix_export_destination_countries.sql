-- Buyer/export destinations (Georgia, Balkans, …) were wrongly stored as vehicle/listing origin
-- for Korean-market providers (GetCarAPI/KMCheck, Encar, Autowini). Country = market origin.

--> statement-breakpoint
UPDATE listings AS l
SET country = 'South Korea'
FROM providers AS p
WHERE p.id = l.provider_id
  AND lower(p.internal_name) IN ('getcarapi', 'encar', 'autowini', 'kbchachacha', 'kmcheck', 'carstat')
  AND lower(btrim(coalesce(l.country, ''))) IN (
    'georgia','ge','geo',
    'albania','al',
    'montenegro','me',
    'serbia','rs',
    'north macedonia','macedonia','mk',
    'bosnia','bosnia and herzegovina','ba',
    'kosovo','xk',
    'bulgaria','bg',
    'romania','ro',
    'croatia','hr',
    'slovenia','si',
    'greece','gr',
    'turkey','türkiye','tr',
    'armenia','am',
    'azerbaijan','az',
    'united arab emirates','uae','ae',
    'poland','pl',
    'austria','at',
    'europe','eu'
  );
--> statement-breakpoint
UPDATE vehicles AS v
SET country = 'South Korea'
WHERE lower(btrim(coalesce(v.country, ''))) IN (
    'georgia','ge','geo',
    'albania','al',
    'montenegro','me',
    'serbia','rs',
    'north macedonia','macedonia','mk',
    'bosnia','bosnia and herzegovina','ba',
    'kosovo','xk',
    'bulgaria','bg',
    'romania','ro',
    'croatia','hr',
    'slovenia','si',
    'greece','gr',
    'turkey','türkiye','tr',
    'armenia','am',
    'azerbaijan','az',
    'united arab emirates','uae','ae',
    'poland','pl',
    'austria','at',
    'europe','eu'
  )
  AND EXISTS (
    SELECT 1
    FROM listings AS l
    JOIN providers AS p ON p.id = l.provider_id
    WHERE l.vehicle_id = v.id
      AND lower(p.internal_name) IN ('getcarapi', 'encar', 'autowini', 'kbchachacha', 'kmcheck', 'carstat')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM listings AS l
    JOIN providers AS p ON p.id = l.provider_id
    WHERE l.vehicle_id = v.id
      AND lower(p.internal_name) IN ('copart', 'iaa', 'salvagebid')
  );
