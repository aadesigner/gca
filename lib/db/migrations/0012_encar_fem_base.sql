-- Point Encar provider at fem.encar.com detail pages; bump parser version
UPDATE providers
SET base_url = 'https://fem.encar.com',
    parser_version = 'encar-v2.1.0',
    notes = 'Encar import listings via api.encar.com (mobile search compatible)'
WHERE internal_name = 'encar';
