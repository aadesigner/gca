-- Fix encar provider base_url to point at AMS Auto (the actual collection target).
-- The adapter scrapes https://www.amsauto.al/korea/cars, not encar.com.
UPDATE providers
SET base_url = 'https://www.amsauto.al',
    notes    = 'AMS Auto — Korean used cars aggregated from Encar for Albanian market'
WHERE internal_name = 'encar'
  AND base_url = 'https://www.encar.com';
