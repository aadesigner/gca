-- Switch from AMS Auto to Encar direct; raise collection limits
UPDATE providers
SET
  name = 'Encar',
  internal_name = 'encar',
  type = 'auction',
  base_url = 'https://www.encar.com',
  parser_version = 'encar-v2.0.0',
  rate_limit = 30,
  notes = 'Encar import listings via api.encar.com (Korean used-car marketplace)'
WHERE internal_name = 'ams';

DELETE FROM providers WHERE internal_name = 'ams';

UPDATE settings
SET
  default_max_pages = 200,
  default_max_listings = 5000,
  default_delay_ms = 1500
WHERE id = 1;
