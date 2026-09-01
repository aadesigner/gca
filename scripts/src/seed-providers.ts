/**
 * Seed the Encar provider for development.
 * Run: pnpm --filter @workspace/scripts run seed-providers
 */
import pg from "pg";

const { Pool } = pg;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`DELETE FROM providers WHERE internal_name IN ('ams', 'carsensor')`);
  // BidCars / Cars & Bids stay off (Cloudflare-gated, no usable cookie path).
  await pool.query(
    `UPDATE collection_jobs
     SET status = 'cancelled',
         completed_at = COALESCE(completed_at, NOW()),
         error_message = COALESCE(error_message, 'Provider removed (Cloudflare-gated)')
     WHERE status IN ('pending', 'running', 'paused')
       AND provider_id IN (
         SELECT id FROM providers WHERE internal_name IN ('bidcars', 'carsandbids')
       )`,
  );
  await pool.query(
    `UPDATE providers
     SET enabled = false,
         notes = 'Removed from active crawl list — site is Cloudflare-gated (browser cookie required).'
     WHERE internal_name IN ('bidcars', 'carsandbids')`,
  );

  await pool.query(
    `INSERT INTO providers (name, internal_name, type, country, base_url, enabled, rate_limit, parser_version, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (internal_name) DO UPDATE SET
       name = EXCLUDED.name,
       type = EXCLUDED.type,
       base_url = EXCLUDED.base_url,
       enabled = EXCLUDED.enabled,
       rate_limit = EXCLUDED.rate_limit,
       parser_version = EXCLUDED.parser_version,
       notes = EXCLUDED.notes`,
    [
      "Encar",
      "encar",
      "auction",
      "KR",
      "https://fem.encar.com",
      true,
      30,
      "encar-v2.1.0",
      "Encar import listings via api.encar.com (mobile search compatible)",
    ],
  );

  console.log("✓ Encar provider seeded");

  await pool.query(
    `INSERT INTO providers (name, internal_name, type, country, base_url, enabled, rate_limit, parser_version, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (internal_name) DO UPDATE SET
       name = EXCLUDED.name,
       type = EXCLUDED.type,
       base_url = EXCLUDED.base_url,
       enabled = EXCLUDED.enabled,
       rate_limit = EXCLUDED.rate_limit,
       parser_version = EXCLUDED.parser_version,
       notes = EXCLUDED.notes`,
    [
      "Autowini",
      "autowini",
      "auction",
      "KR",
      "https://www.autowini.com",
      true,
      30,
      "autowini-v1.0.0",
      "Autowini used-car marketplace (South Korea). Historical persist is VIN-only; live feed shows all listings.",
    ],
  );

  await pool.query(
    `INSERT INTO live_providers (name, internal_name, is_enabled, cache_ttl_seconds)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (internal_name) DO NOTHING`,
    ["Autowini Live", "autowini_live", true, 60],
  );

  console.log("✓ Autowini provider seeded");

  await pool.query(
    `INSERT INTO providers (name, internal_name, type, country, base_url, enabled, rate_limit, parser_version, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (internal_name) DO UPDATE SET
       name = EXCLUDED.name,
       type = EXCLUDED.type,
       base_url = EXCLUDED.base_url,
       enabled = EXCLUDED.enabled,
       rate_limit = EXCLUDED.rate_limit,
       parser_version = EXCLUDED.parser_version,
       notes = EXCLUDED.notes`,
    [
      "KB ChaChaCha",
      "kbchachacha",
      "auction",
      "KR",
      "https://www.kbchachacha.com",
      true,
      30,
      "kbchachacha-v1.0.0",
      "KB ChaChaCha used-car marketplace (South Korea). Historical persist is VIN-only from the inspection sheet; live feed shows all listings. Prices in KRW.",
    ],
  );

  await pool.query(
    `INSERT INTO live_providers (name, internal_name, is_enabled, cache_ttl_seconds)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (internal_name) DO NOTHING`,
    ["KB ChaChaCha Live", "kbchachacha_live", true, 60],
  );

  console.log("✓ KB ChaChaCha provider seeded");

  const exporters: Array<[string, string, string, string, string, number, string, string]> = [
    ["Mango World Car", "mango", "classifieds", "KR", "https://mangoworldcar.com", 20, "mango-v1.1.0", "KR exporter. Public pages rarely include a VIN; history persist is VIN-only."],
    ["Seobuk", "seobuk", "dealer", "KR", "https://www.seobuk.org", 20, "seobuk-v1.1.0", "KR exporter (Carmanager). VIN on the detail page. Uses KR_PROXY/ENCAR_PROXY if this IP is blocked."],
    [
      "KAA Auction",
      "koreaauto_auction",
      "auction",
      "KR",
      "https://koreaauto.auction",
      30,
      "koreaauto_auction-v1.0.3",
      "Korea Auto Auction (~294 vehicles). WP /wp-json/wp/v2/vehicle list; VIN often in slug/content; USD price + km on detail.",
    ],
    ["SSANCAR", "ssancar", "dealer", "KR", "https://www.ssancar.com", 20, "ssancar-v1.1.0", "KR exporter. Full VIN is members-only; public detail is often masked."],
    ["Carpool Korea", "carpoolkr", "classifieds", "KR", "https://www.carpoolkr.com", 20, "carpoolkr-v1.1.0", "KR exporter. VIN on slug detail URLs from the search list."],
    ["Lotte Auto Global", "lotte_autoglobal", "auction", "KR", "https://www.lotte-autoglobal.net", 30, "lotte-autoglobal-v1.0.0", "KR export auction. List AJAX has VIN (clsNo), km (drgMil), USD price, multi photos. Detail HTML often gated; refresh uses search_clsNo."],
    ["Kolon Auto International", "kolon_auto", "dealer", "KR", "https://www.kolonautointernational.com", 40, "kolon-auto-v1.0.0", "Sellcar/Kolon buy-now. List API ~65k cars (km+USD); detail getCarInfo has VIN + full gallery on image.kolonautointernational.com."],
    ["Auctionauto", "auctionauto", "auction", "INTL", "https://auctionauto.org", 20, "auctionauto-v3.1.0", "Korea + USA sharded by make/model (API 10k window). VIN-only persist. Sold price/date from saleDate, not crawl time."],
    ["Korea Used Cars", "koreausedcars", "dealer", "KR", "https://koreausedcars.net", 20, "koreausedcars-v1.2.0", "PICKPLUS stock list. Title from detail heading; public pages usually omit mileage."],
    ["Auctionwini", "auctionwini", "auction", "KR", "https://www.auctionwini.com", 20, "auctionwini-v1.1.0", "KR auction (Autowini stack). Public catalog needs AUCTIONWINI_TOKEN."],
    ["Heydealer", "heydealer", "classifieds", "KR", "https://www.heydealer.com", 20, "heydealer-v1.0.0", "KR marketplace API. Rich specs; public VIN rare."],
    ["Bobaedream", "bobaedream", "classifieds", "KR", "https://www.bobaedream.co.kr", 20, "bobaedream-v1.0.0", "KR mycar direct listings. No public VIN."],
    ["Bobaedream Cyber", "bobaedreamcyber", "dealer", "KR", "https://www.bobaedream.co.kr", 20, "bobaedreamcyber-v1.0.0", "Bobaedream CyberCar dealer channel."],
    ["Salvagebid", "salvagebid", "auction", "US", "https://www.salvagebid.com", 20, "salvagebid-v2.0.0", "US salvage auction broker (Copart/IAA lots). VIN, mileage, photos, damage from lot JSON."],
    ["Bring a Trailer", "bringatrailer", "auction", "US", "https://bringatrailer.com", 20, "bat-v1.1.0", "US collector car auctions. VIN + sold price in listing HTML."],
    ["IAA (Insurance Auto Auctions)", "iaa", "auction", "US", "https://www.iaai.com", 20, "iaa-v1.0.0", "US salvage auction. Full specs; VIN masked for anon users. Detail pages unprotected."],
    ["AutoScout24", "autoscout24", "classifieds", "EU", "https://www.autoscout24.com", 20, "autoscout24-v1.0.0", "Pan-European classifieds. VIN only when labeled in description/JSON; persist VIN-only."],
    ["AutoTrader.ca", "autotraderca", "classifieds", "CA", "https://www.autotrader.ca", 20, "autotraderca-v1.0.0", "Canadian marketplace. Dealer ads often include VIN."],
    ["Dubicars", "dubicars", "dealer", "AE", "https://www.dubicars.com", 20, "dubicars-v1.1.0", "UAE dealer inventory. Chassis/VIN from labeled detail. Gallery images only (no Mailchimp icons)."],
    ["Otomoto", "otomoto", "classifieds", "PL", "https://www.otomoto.pl", 20, "otomoto-v1.2.0", "Poland/OLX classifieds. VIN from description when labeled."],
    ["KCar", "kcar", "dealer", "KR", "https://www.kcar.com", 20, "kcar-v1.0.0", "Korea dealer stock. Inspection specs; VIN/차대번호 when public."],
    ["Cars24.ae", "cars24ae", "dealer", "AE", "https://www.cars24.ae", 20, "cars24ae-v1.2.0", "UAE inspected stock. VIN + gallery from SSR content JSON."],
    ["Willhaben", "willhaben", "classifieds", "AT", "https://www.willhaben.at", 20, "willhaben-v1.0.0", "Austria classifieds. Skip list ads with no VIN mention."],
    ["Carpages", "carpages", "classifieds", "CA", "https://www.carpages.ca", 20, "carpages-v1.0.0", "Canadian classifieds. VIN from labeled specs/description."],
    ["Autobell", "autobell", "auction", "KR", "https://www.autobell.co.kr", 20, "autobell-v1.0.0", "Korea auction. VIN/차대번호 from detail when public."],
    ["Charancha", "charancha", "classifieds", "KR", "https://www.charancha.com", 20, "charancha-v1.0.0", "KR marketplace. VIN from detail when public."],
    ["Autohub", "autohub", "dealer", "KR", "https://www.autohub.co.kr", 20, "autohub-v1.0.0", "KR dealer stock. VIN from detail when public."],
    ["Lotte Auto Auction", "lotteautoauction", "auction", "KR", "https://www.lotteautoauction.net", 20, "lotteautoauction-v1.0.0", "Lotte domestic auction exhibit list."],
    ["AutoInside", "autoinside", "dealer", "KR", "https://www.autoinside.co.kr", 20, "autoinside-v1.0.0", "KR used-car marketplace."],
    ["Autobell Global", "autobellglobal", "auction", "KR", "https://www.autobellglobal.com", 20, "autobellglobal-v1.0.0", "Autobell export auction channel."],
    ["RB Autotrade", "rbautotrade", "dealer", "KR", "https://www.rbautotrade.com", 20, "rbautotrade-v1.0.0", "KR export dealer stock."],
    ["Sena Auto", "senaauto", "dealer", "KR", "https://www.senaauto.kr", 20, "senaauto-v1.0.0", "KR dealer stock."],
    [
      "Import Motor",
      "import_motor",
      "classifieds",
      "KR",
      "https://import-motor.com",
      15,
      "import-motor-v1.1.0",
      "Aggregator via /buyer-locations (all countries, every list page). Needs IMPORT_MOTOR_CDP_URL + Chrome. Photos from cars2/Copart/IAA/Encar; US damage/keys/sale date captured.",
    ],
    ["Copart", "copart", "auction", "US", "https://www.copart.com", 15, "bidscan-v1.0.0", "US salvage auction (Copart lots). IAAI lots from the same crawl persist under iaa."],
  ];

  for (const [name, internalName, type, country, baseUrl, rateLimit, parserVersion, notes] of exporters) {
    await pool.query(
      `INSERT INTO providers (name, internal_name, type, country, base_url, enabled, rate_limit, parser_version, notes)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8)
       ON CONFLICT (internal_name) DO UPDATE SET
         name = EXCLUDED.name,
         type = EXCLUDED.type,
         country = EXCLUDED.country,
         base_url = EXCLUDED.base_url,
         enabled = EXCLUDED.enabled,
         rate_limit = EXCLUDED.rate_limit,
         parser_version = EXCLUDED.parser_version,
         notes = EXCLUDED.notes`,
      [name, internalName, type, country, baseUrl, rateLimit, parserVersion, notes],
    );
    console.log(`✓ ${name} provider seeded`);
  }

  // Historical crawl jobs are started from the admin UI — seed does not enqueue them.

  const { rows } = await pool.query(
    "SELECT id, name, internal_name, base_url, enabled FROM providers WHERE enabled = true ORDER BY name",
  );
  console.log("Enabled providers in DB:", rows);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
