import { KR, US, CA, AE, CN, EU, JP, HERO_SALVAGE, HERO_LIVE_KR, photo, titleOf, heroShot, heroSlideshow, uniqueCars, recordForSlug, carsForSlug } from "./cars.mjs";

const SITE = "https://getcarapi.com";
const API_V1 = `${SITE}/api/v1`;
export const LIVE_FEED = "/live-feed-korean-cars/";
const ASSET = "20260902portalui";
/** Public copy — no dollar amounts; pricing only in /account/ */
const CREDIT_RETRIEVE = "1 credit";
const CREDIT_BADGE = "1 credit on 200";
const ACCESS_URL = "/account/?register=1";
export const SITE_BUILD_ID = ASSET;
const ARCHIVE_SINCE = "2021";

function dbRecord(slug) {
  return recordForSlug(slug);
}

function marketCars(slug) {
  return carsForSlug(slug);
}

/** Prefer a distinctive archive unit for the car-history dossier showcase. */
const DOSSIER_HERO =
  KR.find((c) => /cadillac/i.test(String(c.make)) && /escalade/i.test(String(c.model))) ||
  KR.find((c) => c.price && c.price !== "—") ||
  dbRecord("south-korea") ||
  KR[0];
const DOSSIER_PHOTOS = uniqueCars(
  [DOSSIER_HERO, ...KR.filter((c) => c.img !== DOSSIER_HERO?.img)],
  6,
).map((c) => ({
  img: c.img,
  alt: titleOf(c),
  chip: c.chip,
  km: c.km,
  price: c.price,
}));

const PAYLOAD_BLOCKS = [
  {
    key: "vehicle",
    label: "vehicle",
    title: "Identity & specs",
    blurb: "What the car is — year, make, model, trim, fuel, transmission and odometer.",
    tone: "Who it is",
    sample: [
      ["make", "Hyundai"],
      ["model", "Sonata"],
      ["year", "2022"],
      ["mileage", "48210"],
    ],
  },
  {
    key: "listings",
    label: "listings",
    title: "Source ads",
    blurb: "Every classified we saw for this chassis — ask, km, location and deep links.",
    tone: "Where it was sold",
    sample: [
      ["price", "₩18,900,000"],
      ["currency", "KRW"],
      ["location", "Seoul"],
      ["provider", "board"],
    ],
  },
  {
    key: "auctionSales",
    label: "auctionSales",
    title: "Auction trail",
    blurb: "Venue, sale date and hammer when the VIN printed on an auction ticket.",
    tone: "What it sold for",
    sample: [
      ["venue", "Auction"],
      ["saleDate", "2024-06-12"],
      ["amount", "6400"],
      ["currency", "USD"],
    ],
  },
  {
    key: "events",
    label: "events",
    title: "Chassis timeline",
    blurb: "Ordered events tied to the VIN — observations that built the life of the car.",
    tone: "What happened",
    sample: [
      ["type", "listed"],
      ["at", "2023-11-02"],
      ["source", "archive"],
      ["note", "export stock"],
    ],
  },
  {
    key: "accidents",
    label: "accidents · salvage",
    title: "Damage & salvage",
    blurb: "Accident rows plus a salvage record when the archive has one — null when clean.",
    tone: "Risk signals",
    sample: [
      ["accidents", "1"],
      ["severity", "front"],
      ["severity", "minor"],
      ["salvage", "null"],
    ],
  },
  {
    key: "photos",
    label: "photos",
    title: "Photo set",
    blurb: "Listing and auction photos for the vehicle.",
    tone: "How it looked",
    sample: [
      ["photos", "12"],
      ["primary", "true"],
      ["url", "https://…"],
      ["sortOrder", "0"],
    ],
  },
];

const PAYLOAD_TILES = PAYLOAD_BLOCKS.map((b) => ({ label: b.label, desc: b.blurb }));

const HISTORY_NAV_LINKS = [
  { href: "/car-history/", label: "Overview", slug: null, flag: null },
  { href: "/car-history/south-korea/", label: "South Korea", slug: "south-korea", flag: "KR" },
  { href: "/car-history/usa/", label: "United States", slug: "usa", flag: "US" },
  { href: "/car-history/canada/", label: "Canada", slug: "canada", flag: "CA" },
  { href: "/car-history/dubai/", label: "Dubai", slug: "dubai", flag: "AE" },
  { href: "/car-history/europe/", label: "Europe", slug: "europe", flag: "EU" },
  { href: "/car-history/china/", label: "China", slug: "china", flag: "CN" },
  { href: "/car-history/japan/", label: "Japan", slug: "japan", flag: "JP" },
];
const VIN_PAYLOAD = "vehicle, listings, auctions, events, accidents, salvage, and photos";
const VIN_PAYLOAD_LIST = "vehicle, listings, auctionSales, events, accidents, salvage, photos";
const VIN_PAYLOAD_DOTS = "vehicle · listings · auctionSales · events · accidents · salvage · photos";

function wordmark({ dark = false, size = "" } = {}) {
  const tone = dark ? "brand-lockup--dark" : "brand-lockup--day";
  const scale = size ? ` brand-lockup--${size}` : "";
  return `<span class="brand-lockup ${tone}${scale}" aria-hidden="true"><span class="brand-get">GetCar</span><span class="brand-api">API</span><span class="brand-tld">.com</span></span>`;
}

const WORDMARK_DAY = wordmark({ dark: false });
const WORDMARK_DARK = wordmark({ dark: true, size: "lg" });

function brandLink(className = "brand", { dark = false } = {}) {
  const lockup = dark ? WORDMARK_DARK : WORDMARK_DAY;
  return `<a class="${className}" href="/" aria-label="GetCarAPI home">${lockup}</a>`;
}

const MARQUEE_ITEMS = [
  // Korea live / retail
  "Encar",
  "Autowini",
  "KB ChaChaCha",
  "AuctionAuto",
  "Autobell",
  "KCar",
  "Lotte Auto Auction",
  "HeyDealer",
  // US salvage / auctions / retail
  "Copart history",
  "IAA",
  "SalvageBid",
  "Cars & Bids",
  "Manheim",
  "ADESA",
  "CarGurus",
  "Cars.com",
  "Autotrader",
  // Canada
  "AutoTrader.ca",
  "Carpages",
  "Kijiji Autos",
  // Dubai / Gulf
  "Dubicars",
  "YallaMotor",
  "Dubizzle Cars",
  // Europe
  "mobile.de",
  "AutoScout24",
  "Leboncoin",
  "Autoscout",
  "BCA Europe",
  // China
  "Guazi",
  "Autohome",
  "Dongchedi",
  // Japan
  "USS Auction",
  "TAU",
  "Bayauc",
  "JDM Export",
  // History / registry signals
  "Insurance claims",
  "Accident reports",
  "Police thefts",
  "Title brands",
  "Odometer history",
  "Salvage titles",
  "Write-offs",
  "Registration events",
  "Owner changes",
  "Auction sheets",
  "Service records",
  "Flood damage",
  "Lien checks",
];

const marqueeSpans = MARQUEE_ITEMS.map(
  (n) => `<span>${String(n).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`,
).join("");
const MARQUEE = `<div class="marquee" aria-hidden="true"><div class="marquee-track">${marqueeSpans}${marqueeSpans}</div></div>`;

function historyNavThumb(link) {
  if (!link.slug) {
    return `<span class="header-drop-thumb header-drop-thumb--hub" aria-hidden="true">
      <span class="header-drop-hub-grid">${["KR", "US", "CA", "JP"]
        .map((f) => flagSvg(f, { className: "market-flag-svg market-flag-svg--sm" }))
        .join("")}</span>
    </span>`;
  }
  if (link.flag) {
    return `<span class="header-drop-thumb header-drop-thumb--flag" aria-hidden="true">${flagSvg(link.flag, { className: "market-flag-svg market-flag-svg--md" })}</span>`;
  }
  return `<span class="header-drop-thumb header-drop-thumb--hub" aria-hidden="true"><span class="header-drop-ico">◈</span></span>`;
}

function header(active) {
  const on = (href) => (active === href || (href !== "/" && String(active).startsWith(href)) ? " is-active" : "");
  const histActive = active === "/car-history/" || String(active).startsWith("/car-history/");
  const histMenu = HISTORY_NAV_LINKS.map((l) => {
    const isOn = active === l.href || (l.href !== "/car-history/" && String(active).startsWith(l.href));
    return `<a href="${l.href}" class="header-drop-link${isOn ? " is-active" : ""}" role="menuitem">
      ${historyNavThumb(l)}
      <span class="header-drop-copy">
        <strong>${l.label}</strong>
        ${l.flag ? `<em>${l.flag}</em>` : `<em>All markets</em>`}
      </span>
    </a>`;
  }).join("");
  const mobileHist = HISTORY_NAV_LINKS.map((l) => {
    const isOn = active === l.href || (l.href !== "/car-history/" && String(active).startsWith(l.href));
    const mark = l.flag
      ? `<span class="nav-drawer-flag" aria-hidden="true">${flagSvg(l.flag, { className: "market-flag-svg market-flag-svg--md" })}</span>`
      : `<span class="nav-drawer-flag nav-drawer-flag--hub" aria-hidden="true">◈</span>`;
    return `<a href="${l.href}" class="nav-drawer-market${isOn ? " is-active" : ""}">${mark}<span>${l.label}</span></a>`;
  }).join("");
  return `<header class="site-header" id="top">
  <div class="wrap header-inner">
    ${brandLink("brand")}
    <nav class="header-nav" aria-label="Main">
      <div class="header-links" role="list">
        <div class="header-drop${histActive ? " is-active" : ""}" id="hist-dropdown" role="listitem">
          <button type="button" class="header-link header-drop-trigger" aria-expanded="false" aria-haspopup="true" aria-controls="hist-drop-menu" id="hist-drop-btn">
            Car history &amp; auctions
            <svg class="header-chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <div class="header-drop-panel" id="hist-drop-menu" role="menu">${histMenu}</div>
        </div>
        <a href="${LIVE_FEED}" class="header-link header-link--live${on(LIVE_FEED)}" role="listitem">Live Feed Korean Cars<span class="header-live-pip" aria-hidden="true"></span></a>
        <a href="/api/" class="header-link${on("/api/")}" role="listitem">Docs</a>
      </div>
      <div class="header-cta" data-site-auth-wrap>
        <span class="site-auth-guest">
          <a href="/account/" class="btn btn-ghost btn-sm${on("/account/")}">Log in</a>
          <a href="${ACCESS_URL}" class="btn btn-primary btn-sm" data-access-cta>Sign up</a>
        </span>
        <span class="site-auth-user" hidden>
          <a href="/account/" class="site-user-chip btn btn-ghost btn-sm" data-site-user-link></a>
        </span>
      </div>
    </nav>
    <button type="button" class="header-toggle" id="menu-btn" aria-expanded="false" aria-controls="mobile-drawer" aria-label="Open menu">
      <span class="header-toggle-box" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>
  </div>
</header>
<div class="nav-backdrop" id="nav-backdrop" hidden></div>
<aside class="nav-drawer" id="mobile-drawer" aria-hidden="true" aria-label="Mobile menu">
  <div class="nav-drawer-head">
    ${brandLink("brand nav-drawer-brand")}
    <button type="button" class="nav-drawer-close" id="nav-close" aria-label="Close menu">
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m5.5 5.5 9 9M14.5 5.5l-9 9" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>
    </button>
  </div>
  <nav class="nav-drawer-body">
    <div class="nav-drawer-products">
      <a href="/car-history/" class="nav-drawer-row${histActive ? " is-active" : ""}">
        <span class="nav-drawer-row-ico" aria-hidden="true">VIN</span>
        <span class="nav-drawer-row-copy"><strong>Car history</strong><em>10M+ since ${ARCHIVE_SINCE}</em></span>
      </a>
      <a href="${LIVE_FEED}" class="nav-drawer-row nav-drawer-row--live${on(LIVE_FEED)}">
        <span class="nav-drawer-row-ico is-live" aria-hidden="true"><span class="header-live-pip"></span></span>
        <span class="nav-drawer-row-copy"><strong>Live Feed Korea</strong><em>Encar · Autowini · KB</em></span>
      </a>
      <a href="/api/" class="nav-drawer-row${on("/api/")}">
        <span class="nav-drawer-row-ico" aria-hidden="true">{ }</span>
        <span class="nav-drawer-row-copy"><strong>API docs</strong><em>Check free · retrieve on match</em></span>
      </a>
    </div>
    <p class="nav-drawer-kicker">VIN markets</p>
    <div class="nav-drawer-markets">${mobileHist}</div>
  </nav>
  <div class="nav-drawer-foot" data-site-auth-wrap>
    <span class="site-auth-guest">
      <a href="/account/" class="btn btn-ghost">Log in</a>
      <a href="${ACCESS_URL}" class="btn btn-primary" data-access-cta>Sign up</a>
    </span>
    <span class="site-auth-user" hidden>
      <a href="/account/" class="site-user-chip btn btn-primary" data-site-user-link></a>
    </span>
  </div>
</aside>`;
}

function footer(_kind = "both") {
  const blurb =
    `GetCarAPI is a vehicle data platform: VIN history across Korea, Canada, the USA and more since ${ARCHIVE_SINCE}, plus live Korean used-car inventory from Encar, Autowini, and KB ChaChaCha.`;
  const legal = "The biggest auctions & database for cars sold online.";
  return `<footer class="site-footer">
    <div class="foot-glow" aria-hidden="true"></div>
    <div class="wrap">
      <div class="foot-cta">
        <div class="foot-cta-copy">
          <p class="kicker">Client panel</p>
          <h2>Keys, usage, live preview.</h2>
          <p>Log in to manage tokens and caps. Request a key when you are ready to wire the API.</p>
        </div>
        <div class="foot-cta-actions">
          <a class="btn btn-ghost foot-btn" href="/account/">Log in</a>
          <a class="btn btn-primary foot-btn" href="${ACCESS_URL}" data-access-cta>Sign up</a>
        </div>
      </div>
      <div class="foot">
        <div class="foot-brand">
          ${brandLink("brand", { dark: true })}
          <p>${blurb}</p>
        </div>
        <div class="foot-col">
          <h3>Product</h3>
          <a href="${LIVE_FEED}">Live Feed Korean Cars</a>
          <a href="/car-history/">Car history &amp; auctions</a>
          <a href="${LIVE_FEED}#try-live">Live sample</a>
          <a href="/account/">Client area</a>
        </div>
        <div class="foot-col">
          <h3>Live Feed Korea</h3>
          <a href="${LIVE_FEED}encar">Encar</a>
          <a href="${LIVE_FEED}autowini">Autowini</a>
          <a href="${LIVE_FEED}kbchachacha">KB ChaChaCha</a>
        </div>
        <div class="foot-col">
          <h3>Car history</h3>
          <a href="/car-history/south-korea/">South Korea</a>
          <a href="/car-history/usa/">USA</a>
          <a href="/car-history/canada/">Canada</a>
          <a href="/countries/">All markets</a>
        </div>
        <div class="foot-col">
          <h3>Developers</h3>
          <a href="/api/">How it works</a>
          <a href="/api/authentication">Tokens</a>
          <a href="/docs">OpenAPI</a>
        </div>
      </div>
      <div class="foot-bottom">
        <span>© GetCarAPI</span>
        <span>${legal}</span>
      </div>
    </div>
  </footer>`;
}

function breadcrumbList(path, title) {
  const crumbs = [{ name: "Home", item: `${SITE}/` }];
  const p = String(path);
  if (p.startsWith("/car-history")) {
    crumbs.push({ name: "Car history", item: `${SITE}/car-history/` });
    if (p !== "/car-history/") crumbs.push({ name: title.replace(/\s+\|.*$/, ""), item: `${SITE}${p}` });
  } else if (p.startsWith(LIVE_FEED)) {
    crumbs.push({ name: "Live Feed Korea", item: `${SITE}${LIVE_FEED}` });
    if (p !== LIVE_FEED) crumbs.push({ name: title.replace(/\s+\|.*$/, ""), item: `${SITE}${p}` });
  } else if (p.startsWith("/api")) {
    crumbs.push({ name: "API docs", item: `${SITE}/api/` });
    if (p !== "/api/") crumbs.push({ name: title.replace(/\s+\|.*$/, ""), item: `${SITE}${p}` });
  } else if (p === "/countries/") {
    crumbs.push({ name: "Coverage", item: `${SITE}/countries/` });
  } else if (p !== "/") {
    crumbs.push({ name: title.replace(/\s+\|.*$/, ""), item: `${SITE}${p}` });
  }
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.item,
    })),
  };
}

function seoBlocks({ title, description, path, jsonLd }) {
  const canonical = `${SITE}${path}`;
  const graph = [
    {
      "@type": "Organization",
      "@id": `${SITE}/#org`,
      name: "GetCarAPI",
      url: SITE,
      logo: `${SITE}/favicon.svg`,
      description: `VIN history API with 10M+ vehicles since ${ARCHIVE_SINCE}, plus Korean live inventory from Encar, Autowini and KB ChaChaCha.`,
    },
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      name: "GetCarAPI",
      url: SITE,
      inLanguage: "en",
      publisher: { "@id": `${SITE}/#org` },
    },
    {
      "@type": "WebPage",
      "@id": `${canonical}#webpage`,
      name: title,
      url: canonical,
      description,
      isPartOf: { "@id": `${SITE}/#website` },
      about: { "@id": `${SITE}/#org` },
      inLanguage: "en",
    },
    breadcrumbList(path, title),
  ];
  const extra = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
  const scripts = [
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>`,
    ...extra.map((block) => `<script type="application/ld+json">${JSON.stringify(block)}</script>`),
  ];
  return { canonical, scripts: scripts.join("\n  ") };
}

export function layout({ title, description, path, body, noindex, jsonLd, active, extraScript, skin = "home", foot = "both" }) {
  const { canonical, scripts } = seoBlocks({ title, description, path, jsonLd });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <link rel="canonical" href="${canonical}" />
  <link rel="alternate" hreflang="en" href="${canonical}" />
  <link rel="alternate" hreflang="x-default" href="${canonical}" />
  <link rel="sitemap" type="application/xml" href="${SITE}/sitemap.xml" />
  <meta name="robots" content="${noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"}" />
  <meta name="googlebot" content="${noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1"}" />
  <meta name="author" content="GetCarAPI" />
  <meta name="application-name" content="GetCarAPI" />
  <meta name="referrer" content="strict-origin-when-cross-origin" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:site_name" content="GetCarAPI" />
  <meta property="og:image" content="${SITE}/favicon.svg" />
  <meta property="og:image:alt" content="GetCarAPI — VIN history and Korean live car feeds" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${SITE}/favicon.svg" />
  <meta name="theme-color" content="#071833" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/assets/site.css?v=${ASSET}" />
  ${scripts}
</head>
<body class="skin-${skin}">
  <div class="page-load" id="page-load" aria-hidden="true"></div>
  ${header(active ?? path)}
  <main>${body}</main>
  ${footer(foot)}
  <script src="/assets/site.js?v=${ASSET}" defer></script>
  ${extraScript ? `<script src="${extraScript}" defer></script>` : ""}
</body>
</html>`;
}

function stockCard(car, extras = {}) {
  const ask = extras.ask;
  const yours = extras.yours;
  const km = extras.km ?? car.km;
  return `<article class="stock-card reveal-on">
    <div class="stock-photo">${photo(car.img, titleOf(car))}</div>
    <div class="stock-meta">
      <strong>${titleOf(car)}</strong>
      ${km ? `<small>${km}</small>` : ""}
      ${ask ? `<div class="price-row"><span class="ask">${ask}</span><em>${yours || ""}</em></div>
      <small>Source ask · your site price</small>` : ""}
    </div>
  </article>`;
}

function photoGrid(cars, n = 4) {
  return `<div class="stock-grid">${uniqueCars(cars, n).map((c) => stockCard(c)).join("")}</div>`;
}

function historyRecordCard(car) {
  return `<article class="history-record reveal-on">
    <div class="history-record-photo">${photo(car.img, titleOf(car))}</div>
    <div class="history-record-body">
      <strong>${titleOf(car)}</strong>
      <ul class="history-record-meta">
        <li><span>${car.km?.includes("damage") || car.km?.includes("impact") || car.km?.includes("Hail") || car.km?.includes("Front") || car.km?.includes("Rear") ? "Damage" : "Odometer"}</span><b>${car.km || "—"}</b></li>
        <li><span>Last ask</span><b>${car.price || "—"}</b></li>
        <li><span>Sold price</span><b>${car.sold || "—"}</b></li>
        <li><span>Archived</span><b>${car.when || "—"}</b></li>
      </ul>
    </div>
  </article>`;
}

function historyRecordGrid(cars, n = 4) {
  return `<div class="history-record-grid">${uniqueCars(cars, n).map((c) => historyRecordCard(c)).join("")}</div>`;
}

function historyHeroMosaic(cars, n = 3) {
  return `<div class="history-hero-mosaic" aria-hidden="true">
    ${uniqueCars(cars, n)
      .map(
        (c, i) =>
          `<div class="history-hero-mosaic-cell${i === 0 ? " is-main" : ""}">${photo(c.img, titleOf(c), i === 0)}</div>`,
      )
      .join("")}
  </div>`;
}

function historySubnav(activeSlug) {
  const links = [
    { href: "/car-history/", slug: null, label: "Overview", flag: null },
    ...HISTORY_MARKETS.map((m) => ({ href: `/car-history/${m.slug}/`, slug: m.slug, label: m.name, flag: m.flag })),
  ];
  return `<div class="history-nav-band">
  <div class="wrap history-nav-wrap">
    <p class="history-nav-label">Markets</p>
    <nav class="history-subnav" aria-label="Car history markets">
      ${links
        .map((l) => {
          const active = activeSlug === l.slug || (activeSlug == null && l.slug == null);
          const icon = l.flag
            ? flagSvg(l.flag, { className: "market-flag-svg market-flag-svg--md" })
            : `<span class="history-subnav-all" aria-hidden="true">All</span>`;
          return `<a href="${l.href}" class="history-subnav-link${active ? " is-active" : ""}"${active ? ' aria-current="page"' : ""}>${icon}<span>${l.label}</span></a>`;
        })
        .join("")}
    </nav>
  </div>
</div>`;
}

function historyHubHero() {
  return `<section class="phero phero-history phero-history-hub ink">
  <div class="history-hero-bg" aria-hidden="true">
    <div class="phero-orb"></div>
    <div class="phero-orb b"></div>
    <div class="history-hero-gridlines"></div>
  </div>
  <div class="wrap history-hero-center">
    <p class="kicker reveal d1">Car history API</p>
    <h1 class="reveal d1">Check if we have it. Pay on retrieve.</h1>
    <p class="lede reveal d2">10M+ VINs across Korea, Canada, the USA and four more markets — cars collected continuously since ${ARCHIVE_SINCE}. Check is free. A credit is used only when we return ${VIN_PAYLOAD}.</p>
    <div class="history-hero-meter reveal d2">${billMeter()}</div>
    <div class="hero-actions reveal d3">
      <a class="btn btn-primary" href="${ACCESS_URL}" data-access-cta>Sign up</a>
      <a class="btn btn-ghost" href="#ask-first">See how billing works</a>
    </div>
    <div class="history-hero-pills reveal d3" aria-label="Coverage">
      ${HISTORY_MARKETS.map((m) => `<a href="/car-history/${m.slug}/" class="history-hero-pill">${flagSvg(m.flag, { className: "market-flag-svg market-flag-svg--md" })}<span>${m.name}</span></a>`).join("")}
    </div>
  </div>
</section>`;
}

function historyCountryHero(m) {
  const sample = uniqueCars(m.cars, 4);
  const [hero, ...rest] = sample;
  const thumbs = rest.slice(0, 3);
  const stats = (m.stats || [])
    .map((s) => `<div class="history-country-stat"><b>${s.n}</b><span>${s.l}</span></div>`)
    .join("");
  const showcase = hero
    ? `<div class="history-country-showcase reveal d2" aria-hidden="true">
      <figure class="history-country-feature">
        ${photo(hero.img, titleOf(hero), true)}
        <figcaption class="history-country-feature-cap">
          <span class="history-country-feature-chip">${hero.chip || "Archive"}</span>
          <span class="history-country-feature-title">${titleOf(hero)}</span>
        </figcaption>
      </figure>
      ${
        thumbs.length
          ? `<div class="history-country-thumbs">${thumbs
              .map(
                (c) =>
                  `<figure class="history-country-thumb">${photo(c.img, titleOf(c))}<figcaption>${titleOf(c)}</figcaption></figure>`,
              )
              .join("")}</div>`
          : ""
      }
    </div>`
    : "";
  return `<section class="phero phero-history phero-history-country ink">
  <div class="history-hero-bg" aria-hidden="true">
    <div class="phero-orb"></div>
    <div class="phero-orb b"></div>
    <div class="history-hero-gridlines"></div>
  </div>
  <div class="wrap history-country-hero">
    <div class="history-country-copy">
      <div class="history-country-head reveal d1">
        ${flagSvg(m.flag, { className: "market-flag-svg market-flag-svg--xl history-country-flag" })}
        <div class="history-country-head-copy">
          <p class="history-country-kicker">${m.name} · archive since ${ARCHIVE_SINCE}</p>
          <p class="history-country-note">${m.note}</p>
        </div>
      </div>
      <h1 class="reveal d1">${m.title}</h1>
      <p class="lede reveal d2">${m.lede}</p>
      ${stats ? `<div class="history-country-stats reveal d2">${stats}</div>` : ""}
      <div class="hero-actions reveal d3">
        <a class="btn btn-primary" href="${ACCESS_URL}" data-access-cta>Sign up</a>
        <a class="btn btn-ghost" href="#ask-first">How billing works</a>
        <a class="btn btn-ghost" href="/car-history/">All markets</a>
      </div>
    </div>
    ${showcase}
  </div>
</section>`;
}

function historyAskFirstBand() {
  return `<section class="history-ask-band" id="ask-first">
  <div class="wrap history-ask-inner reveal-on">
    <div class="history-ask-copy">
      <p class="kicker">Ask first</p>
      <h2>Free check. Credit only on retrieve.</h2>
      <p class="sub">See if the VIN is in the archive before you spend a credit. Same rule in every market.</p>
      <ul class="history-ask-list">
        <li><strong>Check</strong> — Bearer required, no charge</li>
        <li><strong>Retrieve</strong> — ${CREDIT_RETRIEVE} only when the record returns</li>
        <li><strong>Miss</strong> — nothing billed if we do not have it</li>
      </ul>
    </div>
    <div class="history-ask-visual">
      ${billMeter()}
      <pre class="history-ask-code">Authorization: Bearer vdi_…
GET /api/v1/vin/check/{vin}   // free (no credit)

GET /api/v1/vin/{vin}         // ${CREDIT_RETRIEVE} on match</pre>
    </div>
  </div>
</section>`;
}

function historyCountryStory(m) {
  return `<section class="section wrap history-story-section">
  <div class="history-story-head reveal-on">
    <p class="kicker">${m.name} archive since ${ARCHIVE_SINCE}</p>
    <h2>What we capture in ${m.name}</h2>
    <p class="sub">${m.archiveLine || m.sampleNote}</p>
  </div>
  <div class="history-story-grid">
    ${m.points
      .map(
        (p, i) => `<article class="history-story-card reveal-on">
      <span class="history-story-n">${String(i + 1).padStart(2, "0")}</span>
      <span class="chip">${p.chip}</span>
      <h3>${p.h}</h3>
      <p>${p.p}</p>
    </article>`,
      )
      .join("")}
  </div>
</section>`;
}

function historySamplesSection(m) {
  return `<section class="section wrap history-samples-section">
  <div class="history-samples-head reveal-on">
    <p class="kicker">From the ${m.name} archive</p>
    <h2>Real listings we store</h2>
    <p class="sub">Illustrative records — VIN stripped on this site.</p>
  </div>
  <div class="history-sample-gallery">
    ${uniqueCars(m.cars, 6)
      .map((c) => {
        const title = titleOf(c);
        return `<article class="history-sample-card reveal-on">
      <div class="history-sample-photo">${photo(c.img, title)}</div>
      <div class="history-sample-body">
        <strong>${title}</strong>
        <div class="history-sample-meta">
          <span>${c.km || m.note}</span>
          ${c.price ? `<b>${c.price}</b>` : ""}
        </div>
      </div>
    </article>`;
      })
      .join("")}
  </div>
</section>`;
}

function historyPayloadSection() {
  return vinRecordShowcase({ compact: true });
}

function vinRecordShowcase({ compact = false, gallery = "" } = {}) {
  const keys = PAYLOAD_BLOCKS.map(
    (b, i) => `<button type="button" role="tab" class="vin-rec-key${i === 0 ? " is-on" : ""}" data-vin-key="${b.key}" aria-selected="${i === 0 ? "true" : "false"}"${i === 0 ? "" : ' tabindex="-1"'} style="--i:${i}">
      <span class="vin-rec-key-n">${String(i + 1).padStart(2, "0")}</span>
      <span class="vin-rec-key-copy">
        <strong>${b.title}</strong>
        <code class="mono">${b.label}</code>
      </span>
      <span class="vin-rec-key-pip" aria-hidden="true"></span>
    </button>`,
  ).join("");

  const panels = PAYLOAD_BLOCKS.map(
    (b, i) => `<article class="vin-rec-panel${i === 0 ? " is-on" : ""}" role="tabpanel" data-vin-panel="${b.key}"${i === 0 ? "" : " hidden"}>
      <p class="vin-rec-tone">${b.tone}</p>
      <h3>${b.title}</h3>
      <p>${b.blurb}</p>
      <div class="vin-rec-sample" aria-hidden="true">
        <div class="vin-rec-sample-bar">
          <span class="vin-rec-dot"></span><span class="vin-rec-dot"></span><span class="vin-rec-dot"></span>
          <code class="mono">data.${b.key}</code>
        </div>
        <dl>
          ${b.sample.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}
        </dl>
      </div>
    </article>`,
  ).join("");

  const rail = PAYLOAD_BLOCKS.map(
    (b, i) => `<span class="vin-rec-rail-seg${i === 0 ? " is-on" : ""}" data-vin-rail="${b.key}" style="--i:${i}"></span>`,
  ).join("");

  return `<section class="vin-record-section${compact ? " is-compact" : ""}" id="vin-record">
  <div class="wrap">
    <header class="vin-record-head reveal-on">
      <p class="kicker">On HTTP 200</p>
      <h2>One chassis. The whole story.</h2>
      <p class="sub">Retrieve does not drip-feed fields. When the VIN is found, identity, ads, auctions, timeline, damage trail and photos arrive together — same JSON shape in every market.</p>
    </header>
    <div class="vin-record-stage reveal-on" data-vin-record>
      <div class="vin-record-rail" aria-hidden="true">${rail}</div>
      <div class="vin-record-layout">
        <div class="vin-rec-keys" role="tablist" aria-label="Retrieve payload blocks">${keys}</div>
        <div class="vin-rec-panels" aria-live="polite">${panels}</div>
      </div>
      <p class="vin-record-foot"><span class="mono">GET /api/v1/vin/{vin}</span> · ${CREDIT_RETRIEVE} only when this body returns</p>
    </div>
    ${gallery}
  </div>
</section>`;
}

function historyPayloadPanel() {
  return `<div class="history-payload-grid reveal-on">
    ${PAYLOAD_BLOCKS.map(
      (b) =>
        `<div class="feat-card"><span class="chip">${b.label}</span><h3>${b.title}</h3><p>${b.blurb}</p></div>`,
    ).join("")}
  </div>`;
}

/** Country flags — SVG assets (flag-icons, 4×3). Emoji flags fail on Windows. */
function flagSvg(iso, { className = "market-flag-svg" } = {}) {
  const code = String(iso || "").toUpperCase();
  const file = { KR: "kr", US: "us", CA: "ca", AE: "ae", EU: "eu", CN: "cn", JP: "jp" }[code] || code.toLowerCase();
  return `<img class="${className}" src="/assets/flags/${file}.svg" alt="" width="640" height="480" loading="lazy" decoding="async" />`;
}

function marketFlagCard(m, { go } = {}) {
  const isKr = m.slug === "south-korea";
  const stat = m.stats?.[0];
  const cta = go || `Browse ${m.name} archive →`;
  return `<a class="market-flag-card reveal-on${isKr ? " is-live-market" : ""}" href="/car-history/${m.slug}/">
    <div class="market-flag-visual" aria-hidden="true">
      ${flagSvg(m.flag, { className: "market-flag-svg market-flag-svg--card" })}
      ${isKr ? `<span class="market-flag-live">Live + archive</span>` : ""}
    </div>
    <div class="market-flag-body">
      <div class="market-flag-top">
        <strong>${m.name}</strong>
        <span class="market-flag-code">${m.flag}</span>
      </div>
      <p class="market-flag-note">${m.note}</p>
      ${stat ? `<div class="market-flag-stat"><b>${stat.n}</b><span>${stat.l}</span></div>` : ""}
      <span class="market-flag-go">${cta}</span>
    </div>
  </a>`;
}

function historyMarketsShowcase() {
  return `<section class="section wrap history-markets-section">
  <div class="history-markets-head reveal-on">
    <p class="kicker">Seven markets</p>
    <h2>Pick a regional archive</h2>
    <p class="sub">Same ask-first billing everywhere. Open a market for sample listings and how retrieve works there.</p>
  </div>
  <div class="market-flag-grid market-flag-grid--history">${HISTORY_MARKETS.map((m) => marketFlagCard(m)).join("")}</div>
</section>`;
}

const HISTORY_FLOW = [
  { h: "Check the VIN", p: "Free. No credit until we return a record." },
  { h: "Retrieve the payload", p: `One credit when ${VIN_PAYLOAD_LIST} come back.` },
  { h: "Ship it in your product", p: "Same JSON shape for every market." },
];

function liveDemoBlock({ preview = false } = {}) {
  const mode = preview ? "preview" : "public";
  const title = preview ? "See it on your website" : "Six cars per feed. VIN stripped.";
  const sub = preview
    ? "Type your brand name, set markup, and watch a live preview update — static sample listings, not wired to the API."
    : "Encar, Autowini, and KB — 6 sample cars each. Markup stays in your browser. VIN stays off this page.";
  return `<section class="section wrap demo-section" id="try-live">
  <p class="kicker reveal-on">${preview ? "Live feed preview" : "Live sample"}</p>
  <h2 class="reveal-on">${title}</h2>
  <p class="sub reveal-on">${sub}</p>
  <div id="live-demo" class="demo-shell reveal-on" data-mode="${mode}" data-limit="8"></div>
</section>`;
}

function liveFeedNav(active = null) {
  const feeds = [
    { href: LIVE_FEED, label: "All feeds", key: "all" },
    { href: `${LIVE_FEED}encar`, label: "Encar", key: "encar" },
    { href: `${LIVE_FEED}autowini`, label: "Autowini", key: "autowini" },
    { href: `${LIVE_FEED}kbchachacha`, label: "KB ChaChaCha", key: "kbchachacha" },
  ];
  return `<div class="live-feed-feeds" aria-label="Available feeds">
    ${feeds
      .map((f) => `<a href="${f.href}"${f.key === active ? ' class="is-active" aria-current="page"' : ""}>${f.label}</a>`)
      .join("")}
  </div>`;
}

/** Body below the live hero — through FAQ (coverage/CTA stay separate). */
function liveFeedMidSections() {
  const boards = [
    {
      href: `${LIVE_FEED}encar`,
      name: "Encar",
      tag: "Retail",
      blurb: "Korea’s main used-car board — domestic and import stock with photos and KRW ask.",
      param: "provider=encar",
    },
    {
      href: `${LIVE_FEED}autowini`,
      name: "Autowini",
      tag: "Export",
      blurb: "Overseas-facing inventory. Same card shape — add FOB or packed price on your site.",
      param: "provider=autowini",
    },
    {
      href: `${LIVE_FEED}kbchachacha`,
      name: "KB ChaChaCha",
      tag: "Volume",
      blurb: "Domestic fill-in when Encar is thin on a year or trim. Mix with the others.",
      param: "provider=kbchachacha",
    },
  ];

  return `<section class="live-mid live-mid--payload">
  <div class="wrap">
    <div class="live-mid-head reveal-on">
      <p class="kicker">On every car</p>
      <h2>Their listing. Your price.</h2>
      <p class="sub">Identity, photos and the seller’s ask land in one JSON card. Markup stays in your app.</p>
    </div>
    <div class="live-payload-grid">
      <div class="live-payload-item reveal-on">
        <span class="live-payload-n">01</span>
        <strong>Identity</strong>
        <p>Make, model, year, trim, km, fuel, transmission, gallery, source link.</p>
      </div>
      <div class="live-payload-item reveal-on">
        <span class="live-payload-n">02</span>
        <strong>Source ask</strong>
        <p>KRW on the listing — USD/EUR snapshots when present. You set the selling price.</p>
      </div>
      <div class="live-payload-item reveal-on">
        <span class="live-payload-n">03</span>
        <strong>Desk filters</strong>
        <p>Make, year, price, km. Lock one board or merge with <span class="mono">provider=all</span>.</p>
      </div>
    </div>
  </div>
</section>

<section class="live-mid live-mid--boards">
  <div class="wrap">
    <div class="live-mid-head reveal-on">
      <p class="kicker">Three boards</p>
      <h2>One catalogue. Three pipes.</h2>
      <p class="sub">Open a board for a filtered sample, or call them mixed in one list.</p>
    </div>
    <div class="live-board-grid">
      ${boards
        .map(
          (b) => `<a class="live-board reveal-on" href="${b.href}">
        <span class="live-board-tag">${b.tag}</span>
        <strong>${b.name}</strong>
        <p>${b.blurb}</p>
        <code class="mono">${b.param}</code>
        <span class="live-board-go">Open sample →</span>
      </a>`,
        )
        .join("")}
    </div>
  </div>
</section>

<section class="live-mid live-mid--api">
  <div class="wrap live-api-band reveal-on">
    <div class="live-api-copy">
      <p class="kicker">Your website</p>
      <h2>We send the car. You sell it.</h2>
      <p class="sub">Photos, ask and filters over HTTPS. Strike their number in your UI — publish yours on your domain.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="${ACCESS_URL}" data-access-cta>Sign up</a>
        <a class="btn btn-ghost" href="/api/#endpoints-live">Live endpoints</a>
      </div>
    </div>
    <div class="live-api-panel" aria-label="Live feed routes">
      <div class="live-api-row"><span>Mixed catalogue</span><code class="mono">GET /api/v1/live/vehicles?provider=all</code></div>
      <div class="live-api-row"><span>One board</span><code class="mono">?provider=encar</code></div>
      <div class="live-api-row"><span>Detail</span><code class="mono">GET /api/v1/live/vehicles/:id</code></div>
    </div>
  </div>
</section>

<section class="live-mid live-mid--faq">
  <div class="wrap">
    <div class="live-mid-head reveal-on">
      <p class="kicker">FAQ</p>
      <h2>Common questions</h2>
    </div>
    <div class="live-faq-grid">
      <div class="live-faq-item reveal-on"><h3>What is on each listing?</h3><p>Make, model, year, km, photos and source ask. You add the selling price.</p></div>
      <div class="live-faq-item reveal-on"><h3>Is the public demo VIN-safe?</h3><p>Yes — sample cars with VINs stripped. Not a live API call with your key.</p></div>
      <div class="live-faq-item reveal-on"><h3>Can I mix Encar and Autowini?</h3><p><span class="mono">provider=all</span> merges enabled feeds into one catalogue.</p></div>
      <div class="live-faq-item reveal-on"><h3>Where is the full reference?</h3><p><a href="/api/#endpoints-live">Live endpoints</a> and the <a href="/docs">OpenAPI spec</a> for request shapes.</p></div>
    </div>
  </div>
</section>`;
}

function liveFeedHero() {
  return `<section class="phero phero-live-feed" id="try-live">
  <div class="live-feed-bg" aria-hidden="true">
    <div class="live-feed-grid"></div>
    <div class="phero-orb live-feed-orb-a"></div>
    <div class="phero-orb b live-feed-orb-b"></div>
    <div class="live-feed-shimmer"></div>
  </div>
  <div class="live-feed-hero-stack">
    <header class="live-feed-hero-head reveal d1">
      <p class="kicker">Live Feed Korea</p>
      <h1>Korea on your lot.</h1>
      <p class="lede">Encar retail. Autowini export. KB volume. One JSON feed — your markup, your domain.</p>
    </header>
    <div id="live-demo" class="demo-shell demo-shell-hero demo-shell-hero--center reveal d2" data-mode="public" data-limit="8" data-eager="1">
      <div class="live-demo-boot" aria-busy="true"><span class="pulse"></span> Loading live sample…</div>
    </div>
    <footer class="live-feed-hero-foot reveal d3">
      <div class="hero-actions">
        <a class="btn btn-primary" href="${ACCESS_URL}" data-access-cta>Sign up</a>
        <a class="btn btn-ghost" href="/api/#endpoints-live">API docs</a>
      </div>
      ${liveFeedNav("all")}
    </footer>
  </div>
</section>`;
}

const LIVE_PROVIDER_PAGES = {
  encar: {
    key: "encar",
    name: "Encar",
    providerParam: "encar",
    providerKey: "encar_live",
    limit: 8,
    kicker: "Live Feed · Encar",
    title: "Korea’s main retail board.",
    lede: "Domestic and import stock with photos and the seller’s KRW ask. Your markup stays in your browser.",
    stats: [
      { n: "encar", l: "provider=" },
      { n: "Retail", l: "Domestic + import" },
      { n: "Filters", l: "Make · year · km · price" },
      { n: "Same day", l: "Listing freshness" },
    ],
    feats: [
      { chip: "Board", h: "Biggest Korean retail", p: "Genesis, Kia, Hyundai and imports in one pipe — photos, km, current ask." },
      { chip: "Money", h: "Source ask in KRW", p: "USD/EUR snapshots when present. Strike their number; publish yours." },
      { chip: "Mix", h: "Fill with Autowini + KB", p: "Same card shape. Switch boards or use provider=all." },
    ],
    apiNote: "Lock the feed or mix it. Same JSON shape as Autowini and KB.",
    faqs: [
      { h: "What does Encar return?", p: "Make, model, year, trim, km, fuel, transmission, photos and source ask — VIN stripped on the public sample." },
      { h: "How do I call just Encar?", p: `<span class="mono">GET /api/v1/live/vehicles?provider=encar</span> (alias <span class="mono">encar_live</span>).` },
      { h: "Can I mix boards?", p: `Yes — <span class="mono">provider=all</span> merges enabled feeds into one list.` },
      { h: "Is the demo the live API?", p: "No. Static sample cars with local photos — VIN removed, not wired to your key." },
    ],
  },
  autowini: {
    key: "autowini",
    name: "Autowini",
    providerParam: "autowini",
    providerKey: "autowini_live",
    limit: 8,
    kicker: "Live Feed · Autowini",
    title: "Export stock. Overseas-ready.",
    lede: "Listings already aimed at overseas desks. Photos, ask, filters — add FOB or packed price on your site.",
    stats: [
      { n: "autowini", l: "provider=" },
      { n: "Export", l: "Overseas-facing stock" },
      { n: "Same JSON", l: "One renderer for all" },
      { n: "Photos", l: "Gallery on each car" },
    ],
    feats: [
      { chip: "Export", h: "Built for loading lists", p: "Cars already pitched overseas — not local showroom retail." },
      { chip: "FOB", h: "Your number on top", p: "Strike their KRW ask. Publish freight-inclusive pricing on your domain." },
      { chip: "Mix", h: "Beside Encar + KB", p: "Same filters and card. Fill gaps when one board is thin." },
    ],
    apiNote: "Same endpoints as Encar. Point provider=autowini and keep your markup local.",
    faqs: [
      { h: "Who is Autowini for?", p: "Exporters and overseas desks that need Korean stock with photos and a clear ask." },
      { h: "How do I call Autowini only?", p: `<span class="mono">GET /api/v1/live/vehicles?provider=autowini</span>.` },
      { h: "Does it share Encar’s schema?", p: "Yes — one renderer for every Korean live feed." },
      { h: "Is VIN in the sample?", p: "Never on the public demo. Live API listings follow your key’s rules." },
    ],
  },
  kbchachacha: {
    key: "kbchachacha",
    name: "KB ChaChaCha",
    providerParam: "kbchachacha",
    providerKey: "kbchachacha_live",
    limit: 8,
    kicker: "Live Feed · KB ChaChaCha",
    title: "Domestic volume. Same contract.",
    lede: "Fill gaps when Encar is thin on a year or trim. Same JSON card — photos, ask, filters.",
    stats: [
      { n: "kbchachacha", l: "provider=" },
      { n: "Volume", l: "Domestic board fill-in" },
      { n: "Same card", l: "One UI for all feeds" },
      { n: "Mix", l: "provider=all" },
    ],
    feats: [
      { chip: "Volume", h: "Fill the gaps", p: "When Encar is light on a trim, KB often has the car." },
      { chip: "Shape", h: "One renderer", p: "provider=kbchachacha (aliases kb). Mix with provider=all." },
      { chip: "Desk", h: "Same filters", p: "Make, year, km, price — identical query surface to Encar." },
    ],
    apiNote: "Pipe KB next to Encar. One catalogue on your site, your markup on every car.",
    faqs: [
      { h: "When should I use KB?", p: "When you need more domestic volume or a trim Encar isn’t showing today." },
      { h: "How do I call KB only?", p: `<span class="mono">GET /api/v1/live/vehicles?provider=kbchachacha</span> (alias <span class="mono">kb</span>).` },
      { h: "Can I merge with Encar?", p: `Yes — <span class="mono">provider=all</span> returns enabled feeds together.` },
      { h: "Same fields as Encar?", p: "Same live vehicle shape — identity, photos, ask, filters." },
    ],
  },
};

function providerFeedHero(cfg) {
  return `<section class="phero phero-live-feed phero-provider phero-provider--${cfg.key}" id="try-live">
  <div class="live-feed-bg" aria-hidden="true">
    <div class="live-feed-grid"></div>
    <div class="phero-orb live-feed-orb-a"></div>
    <div class="phero-orb b live-feed-orb-b"></div>
    <div class="live-feed-shimmer"></div>
  </div>
  <div class="live-feed-hero-stack">
    <header class="live-feed-hero-head reveal d1">
      <p class="kicker">${cfg.kicker}</p>
      <h1>${cfg.title}</h1>
      <p class="lede">${cfg.lede}</p>
    </header>
    <div id="live-demo" class="demo-shell demo-shell-hero demo-shell-hero--center reveal d2" data-mode="public" data-limit="${cfg.limit}" data-provider="${cfg.providerKey}" data-eager="1">
      <div class="live-demo-boot" aria-busy="true"><span class="pulse"></span> Loading ${cfg.name} sample…</div>
    </div>
    <footer class="live-feed-hero-foot reveal d3">
      <div class="hero-actions">
        <a class="btn btn-primary" href="${ACCESS_URL}" data-access-cta>Sign up</a>
        <a class="btn btn-ghost" href="/api/#endpoints-live">API docs</a>
      </div>
      ${liveFeedNav(cfg.key)}
    </footer>
  </div>
</section>`;
}

function providerPageBody(cfg) {
  const feats = cfg.feats
    .map((f) => `<div class="feat-card reveal-on"><span class="chip">${f.chip}</span><h3>${f.h}</h3><p>${f.p}</p></div>`)
    .join("");
  const faqs = cfg.faqs
    .map((f) => `<div class="faq-item reveal-on"><h3>${f.h}</h3><p>${f.p}</p></div>`)
    .join("");
  return `${providerFeedHero(cfg)}
${providerStatbar(cfg.stats)}
<section class="section wrap">
  <p class="kicker reveal-on">On each car</p>
  <h2 class="reveal-on">${cfg.name} on your lot.</h2>
  <div class="feat">${feats}</div>
</section>
<section class="section wrap">
  <div class="split">
    <div class="panel copy">
      <p class="kicker">Your website</p>
      <h2>We send the car.</h2>
      <p class="sub">${cfg.apiNote}</p>
      <pre>GET /api/v1/live/vehicles?provider=${cfg.providerParam}</pre>
    </div>
    <div class="panel viz">
      <div class="row"><span class="row-label"><span class="dot"></span> This feed</span><span class="mono">provider=${cfg.providerParam}</span></div>
      <div class="row"><span class="row-label"><span class="dot"></span> Mixed</span><span class="mono">provider=all</span></div>
      <div class="row"><span class="row-label"><span class="dot"></span> Detail</span><span class="mono">/live/vehicles/:id</span></div>
    </div>
  </div>
</section>
<section class="section wrap section--compact">
  <p class="kicker reveal-on">Ship it</p>
  <h2 class="reveal-on">Three steps.</h2>
  ${timeline([
    { h: `Pull ${cfg.name}`, p: `provider=${cfg.providerParam} on /live/vehicles` },
    { h: "Add markup", p: "Strike KRW ask in your UI" },
    { h: "Publish", p: "Your price on your domain" },
  ])}
</section>
<section class="section wrap section--compact">
  <p class="kicker reveal-on">Boards</p>
  <h2 class="reveal-on">Other Korean feeds</h2>
  <div class="sources">
    <a class="card reveal-on" href="${LIVE_FEED}"><span class="chip">Live</span><h3>All feeds</h3><p>Encar, Autowini and KB in one catalogue.</p></a>
    ${cfg.key !== "encar" ? `<a class="card reveal-on" href="${LIVE_FEED}encar"><span class="chip">Live</span><h3>Encar</h3><p>Main Korean retail inventory.</p></a>` : ""}
    ${cfg.key !== "autowini" ? `<a class="card reveal-on" href="${LIVE_FEED}autowini"><span class="chip">Live</span><h3>Autowini</h3><p>Export inventory for overseas desks.</p></a>` : ""}
    ${cfg.key !== "kbchachacha" ? `<a class="card reveal-on" href="${LIVE_FEED}kbchachacha"><span class="chip">Live</span><h3>KB ChaChaCha</h3><p>Domestic volume when Encar is thin.</p></a>` : ""}
  </div>
</section>
<section class="section wrap">
  <p class="kicker reveal-on">FAQ</p>
  <h2 class="reveal-on">${cfg.name} questions</h2>
  <div class="faq-grid">${faqs}</div>
</section>
${coverageSection()}
${ctaBand("live")}`;
}

function docsHero({ title, lede, primary, ghost, showRoutes = true }) {
  return `<section class="phero phero-docs ink">
  <div class="phero-orb" aria-hidden="true"></div>
  <div class="wrap docs-hero-grid">
    <div class="docs-hero-inner">
      <p class="kicker reveal d1">Developer docs</p>
      <h1 class="reveal d1">${title}</h1>
      <p class="lede reveal d2">${lede}</p>
      <div class="hero-actions reveal d3">${primary}${ghost || ""}</div>
    </div>
    <aside class="docs-hero-aside reveal d2" aria-label="Base URL">
      <p class="docs-hero-aside-k">Production base</p>
      <code class="mono docs-hero-base">${API_V1}</code>
      ${
        showRoutes
          ? `<ul class="docs-hero-chips">
        <li><span>Free</span><code class="mono">/api/v1/vin/check/{vin}</code></li>
        <li><span>${CREDIT_RETRIEVE}</span><code class="mono">/api/v1/vin/{vin}</code></li>
        <li><span>Live</span><code class="mono">/api/v1/live/vehicles</code></li>
      </ul>`
          : ""
      }
    </aside>
  </div>
</section>`;
}

function pageHero({ title, lede, primary, ghost, visual, tone = "mist" }) {
  return `<section class="phero ${tone}">
  <div class="wrap page-hero-grid">
    <div>
      <h1 class="reveal d1">${title}</h1>
      <p class="lede reveal d2">${lede}</p>
      <div class="hero-actions reveal d3">${primary}${ghost || ""}</div>
    </div>
    ${visual ? `<div class="page-visual reveal d2">${visual}</div>` : ""}
  </div>
</section>`;
}

function timeline(items) {
  const cols = Math.min(items.length, 3);
  return `<div class="steps steps--inline reveal-on" style="grid-template-columns:repeat(${cols},1fr)">
    ${items
      .map((it, i) => `<div class="step"><div class="n">${i + 1}</div><h3>${it.h}</h3><p>${it.p}</p></div>`)
      .join("")}
  </div>`;
}

function providerStatbar(items) {
  return `<section class="section section--tight wrap statbar-wrap">
  <div class="statbar statbar-card">
    ${items
      .map((it) => `<div class="item reveal-on"><div class="n">${it.n}</div><div class="l">${it.l}</div></div>`)
      .join("")}
  </div>
</section>`;
}

function liveKoreaCallout() {
  return `<section class="section wrap section--compact">
  <div class="coverage-live reveal-on">
    <div class="coverage-live-copy">
      <span class="chip">Live now</span>
      <strong>South Korea retail feeds</strong>
      <p>Encar, Autowini and KB ChaChaCha — separate from VIN history. Their ask, your markup on your site.</p>
    </div>
    <a class="btn btn-primary" href="${LIVE_FEED}">Open Live Feed Korea →</a>
  </div>
</section>`;
}

function mosaic(cars = KR) {
  return `<div class="mosaic" aria-hidden="true">
    ${uniqueCars(cars, 4)
      .map((c) => `<div class="mosaic-cell">${photo(c.img, titleOf(c))}</div>`)
      .join("")}
  </div>`;
}

function lotTicket() {
  return `<div class="lot-ticket" aria-hidden="true">
    <span class="lot-k">LOT</span>
    <b>Full VIN only</b>
    <small>Salvage · collector · stored</small>
    <div class="lot-stub">•••••••X4F</div>
  </div>`;
}

function cadStack() {
  return `<div class="cad-stack" aria-hidden="true">
    <div><span>AutoTrader.ca</span><strong>CAD</strong></div>
    <div><span>Carpages</span><strong>Labeled VIN</strong></div>
  </div>`;
}

function dualRail() {
  return `<div class="dual-rail" aria-hidden="true">
    <div class="rail live"><em></em><span>Live lot tonight</span></div>
    <div class="rail hist"><em></em><span>VIN archive since 2021</span></div>
  </div>`;
}

function gstrip(cars = KR) {
  return `<div class="gstrip" aria-hidden="true">${uniqueCars(cars, 5)
    .map((c) => `<div class="gshot">${photo(c.img, titleOf(c))}</div>`)
    .join("")}</div>`;
}

function billMeter() {
  return `<div class="bill-meter">
    <div class="bill-step reveal-on"><span>Have this VIN?</span><strong>Ask first</strong></div>
    <div class="bill-line" aria-hidden="true"></div>
    <div class="bill-step on reveal-on"><span>Retrieve the record</span><strong>${CREDIT_RETRIEVE}</strong></div>
  </div>`;
}

const ARCHIVE_STATS = [
  {
    k: "Archive",
    n: "10M+",
    l: "Vehicles across seven markets",
    hint: "One retrieve shape worldwide",
  },
  {
    k: "Since",
    n: "2021",
    l: "Continuous collection from this year",
    hint: "Any model year that appeared in source boards",
  },
  {
    k: "Retrieve",
    n: "7 blocks",
    l: "Returned together on HTTP 200",
    chips: ["vehicle", "listings", "auctions", "events", "accidents", "salvage", "photos"],
  },
  {
    k: "Billing",
    n: "Credits",
    l: "Prepaid per retrieve · rates in client area",
    hint: "VIN check needs Bearer · no credit · missing = no charge",
  },
];

function archiveStatsBand({ marketStats, marketName, marketFlag, variant, inner = false } = {}) {
  const isPower = variant === "power";
  const cards = ARCHIVE_STATS.map((s, i) => {
    const chips = s.chips
      ? `<div class="archive-stat-chips">${s.chips.map((c) => `<span>${c}</span>`).join("")}</div>`
      : "";
    const hint = s.hint ? `<small class="archive-stat-hint">${s.hint}</small>` : "";
    return `<article class="archive-stat${isPower ? "" : " reveal-on"}${isPower && i === 0 ? " archive-stat--hero" : ""}" data-i="${i}">
      <span class="archive-stat-k">${s.k}</span>
      <strong class="archive-stat-n">${s.n}</strong>
      <p class="archive-stat-l">${s.l}</p>
      ${chips}${hint}
    </article>`;
  }).join("");

  const marketRow =
    marketStats?.length && marketName
      ? `<div class="archive-market-strip reveal-on">
      <div class="archive-market-head">
        ${marketFlag ? flagSvg(marketFlag, { className: "market-flag-svg market-flag-svg--sm" }) : ""}
        <span><strong>${marketName}</strong> in this archive</span>
      </div>
      <div class="archive-market-stats">
        ${marketStats
          .map(
            (s) =>
              `<div class="archive-market-stat"><strong>${s.n}</strong><span>${s.l}</span></div>`,
          )
          .join("")}
      </div>
    </div>`
      : "";

  const gridClass = isPower ? "archive-stats-grid archive-stats-grid--power" : "archive-stats-grid";
  const bandClass = isPower ? "archive-stats-band archive-stats-band--power" : "archive-stats-band";
  const gridBlock = `<div class="${gridClass}">${cards}</div>${marketRow}`;
  if (inner) return gridBlock;
  return `<section class="${bandClass}" aria-label="VIN archive at a glance"><div class="wrap archive-stats-wrap">${gridBlock}</div></section>`;
}

function coverageFlagStack({ className = "coverage-flag-stack" } = {}) {
  return `<span class="${className}" aria-hidden="true">${HISTORY_MARKETS.map((m, i) =>
    flagSvg(m.flag, { className: `market-flag-svg market-flag-svg--sm${i === 0 ? " is-kr" : ""}` }),
  ).join("")}</span>`;
}

function coverageGrid() {
  return `<div class="market-flag-grid coverage-grid">${HISTORY_MARKETS.map((m) => marketFlagCard(m, { go: "VIN archive →" })).join("")}</div>`;
}

function coverageSection({ showMarkets = true } = {}) {
  return `<section class="section wrap coverage-section" aria-labelledby="coverage-title">
  <div class="coverage-head reveal-on">
    <p class="kicker">Coverage</p>
    <h2 id="coverage-title" class="coverage-title">
      <span class="coverage-line coverage-line--live">
        <span class="coverage-line-mark" aria-hidden="true">${flagSvg("KR", { className: "market-flag-svg market-flag-svg--md" })}</span>
        <span class="coverage-line-text">Korean live inventory.</span>
      </span>
      <span class="coverage-line coverage-line--vin">
        ${coverageFlagStack({ className: "coverage-line-mark coverage-flag-stack" })}
        <span class="coverage-line-text">Global VIN history.</span>
      </span>
    </h2>
    <p class="sub">Two products, one key. Stream Korean retail stock today — and retrieve chassis history across seven regional archives, with Korean and Canadian cars collected since ${ARCHIVE_SINCE}.</p>
  </div>
  <div class="coverage-pillars reveal-on">
    <a class="coverage-pillar coverage-pillar--live" href="${LIVE_FEED}">
      <span class="coverage-pillar-top">
        <span class="chip is-live">Live now</span>
        <span class="coverage-pillar-flag" aria-hidden="true">${flagSvg("KR", { className: "market-flag-svg market-flag-svg--sm" })}</span>
      </span>
      <strong>Live Feed Korea</strong>
      <p>Encar, Autowini and KB ChaChaCha on your site. Their ask, your markup.</p>
      <span class="coverage-pillar-meta"><span>Encar</span><span>Autowini</span><span>KB</span></span>
      <span class="coverage-pillar-go">Open live feeds →</span>
    </a>
    <a class="coverage-pillar coverage-pillar--vin" href="/car-history/">
      <span class="coverage-pillar-top">
        <span class="chip">10M+ VINs</span>
        ${coverageFlagStack({ className: "coverage-pillar-flags" })}
      </span>
      <strong>Car history API</strong>
      <p>Ask if we have the VIN first. Auctions, events, accidents and photos on retrieve.</p>
      <span class="coverage-pillar-meta"><span>7 markets</span><span>Since 2021</span></span>
      <span class="coverage-pillar-go">Browse archives →</span>
    </a>
  </div>
  ${
    showMarkets
      ? `<div class="coverage-markets reveal-on">
    <div class="coverage-markets-bar">
      <p class="coverage-markets-label">VIN archives by market</p>
      <div class="coverage-legend">
        <span><span class="coverage-legend-flag">${flagSvg("KR", { className: "market-flag-svg market-flag-svg--sm" })}</span> Live feeds + archive</span>
        <span><span class="coverage-legend-dot" aria-hidden="true"></span> VIN archive only</span>
      </div>
    </div>
    ${coverageGrid()}
  </div>`
      : ""
  }
</section>`;
}

const HISTORY_MARKETS = [
  {
    slug: "south-korea",
    flag: "KR",
    name: "South Korea",
    skin: "kr",
    cars: KR,
    carsLabel: "Korean cars",
    note: "Retail · export · auctions",
    title: "Korean VIN history since 2021",
    lede: `Korean cars in the archive since ${ARCHIVE_SINCE} — Encar retail, export boards and domestic auctions in one retrieve. ${VIN_PAYLOAD_LIST} by VIN.`,
    seoTitle: "South Korea VIN History API — Korean cars since 2021 | GetCarAPI",
    seoDescription: `South Korea VIN history API with Korean cars collected since ${ARCHIVE_SINCE}. Encar retail, export and auction records — ${VIN_PAYLOAD_LIST}. Ask free, retrieve on match.`,
    archiveLine: `We have been collecting Korean cars since ${ARCHIVE_SINCE}: retail ads, export stock and auction tickets that printed a chassis number.`,
    stats: [
      { n: "KRW", l: "Won ask stored as listed" },
      { n: "Since 2021", l: "Korean cars on file" },
      { n: CREDIT_RETRIEVE, l: "Only when the record returns" },
    ],
    points: [
      { chip: "Retail", h: "Domestic ads", p: "Asking price, km and photos stored with the VIN." },
      { chip: "Export", h: "Overseas stock", p: "Export-facing listings that printed a chassis number." },
      { chip: "Auctions", h: "Sale history", p: "Domestic auction rows in the same retrieve payload." },
    ],
    sampleNote: "Illustrative Korean listings — retail, export and auction stock from our archive.",
    faqs: [
      { h: "How far back does Korea VIN history go?", p: `GetCarAPI has collected Korean cars continuously since ${ARCHIVE_SINCE} — retail, export and auction sources.` },
      { h: "Does Korea include live Encar stock?", p: "Yes. VIN history is the archive; Live Feed Korea streams current Encar, Autowini and KB ChaChaCha listings." },
    ],
  },
  {
    slug: "usa",
    flag: "US",
    name: "United States",
    skin: "us",
    cars: US,
    carsLabel: "US cars",
    note: "Salvage · collector",
    title: "USA VIN history since 2021",
    lede: `US cars in the archive since ${ARCHIVE_SINCE} — salvage and collector sale records. ${VIN_PAYLOAD_LIST} for insurance and specialty lots.`,
    seoTitle: "USA VIN History & Salvage API — US cars since 2021 | GetCarAPI",
    seoDescription: `USA VIN history and salvage API. US cars collected since ${ARCHIVE_SINCE} — damage, bid and sold amounts, photos. Ask if we have the VIN, then retrieve.`,
    archiveLine: `US salvage and specialist sale cars have been landing in the archive since ${ARCHIVE_SINCE}. Lots without a full VIN never ship.`,
    stats: [
      { n: "USD", l: "Bid and sold amounts" },
      { n: "Since 2021", l: "US cars on file" },
      { n: "Full VIN", l: "Masked lots never ship" },
    ],
    points: [
      { chip: "Salvage", h: "Damage & miles", p: "Public pages with a complete VIN." },
      { chip: "Collector", h: "Specialist sales", p: "Chassis in the copy, stored as history." },
      { chip: "Rule", h: "VIN or skip", p: "Lots without a full VIN never ship." },
    ],
    sampleNote: "Salvage and damage lots typical of US insurance auctions — not retail Korean stock.",
    faqs: [
      { h: "How far back does USA VIN history go?", p: `United States salvage and collector cars have been archived since ${ARCHIVE_SINCE}.` },
    ],
  },
  {
    slug: "canada",
    flag: "CA",
    name: "Canada",
    skin: "ca",
    cars: CA,
    carsLabel: "Canadian cars",
    note: "Labeled VIN ads",
    title: "Canada VIN history since 2021",
    lede: `Canadian cars in the archive since ${ARCHIVE_SINCE}. CAD listing prices, mileage and ${VIN_PAYLOAD_LIST} by VIN.`,
    seoTitle: "Canada VIN History API — Canadian cars since 2021 | GetCarAPI",
    seoDescription: `Canada car history API with Canadian cars collected since ${ARCHIVE_SINCE}. CAD prices, mileage and full VIN payload. Check is free; one credit only on retrieve.`,
    archiveLine: `We have been collecting Canadian cars since ${ARCHIVE_SINCE} — public classifieds that printed the VIN, stored in CAD when the ad was.`,
    stats: [
      { n: "CAD", l: "Currency on the ad" },
      { n: "Since 2021", l: "Canadian cars on file" },
      { n: "Same API", l: "Ask then retrieve" },
    ],
    points: [
      { chip: "Ads", h: "Classifieds", p: "The VIN had to be on the public ad." },
      { chip: "CAD", h: "Currency", p: "Stored as listed when the ad was in CAD." },
      { chip: "Retrieve", h: "Same call", p: "Ask if we have the VIN, then return the record." },
    ],
    sampleNote: "Canadian retail classifieds — Mazda, GMC, Nissan and similar stock from our archive.",
    faqs: [
      { h: "How far back does Canada VIN history go?", p: `Canadian cars have been collected into the GetCarAPI archive since ${ARCHIVE_SINCE}.` },
    ],
  },
  {
    slug: "dubai",
    flag: "AE",
    name: "Dubai",
    skin: "cover",
    cars: AE,
    carsLabel: "Gulf cars",
    note: "UAE listings",
    title: "Dubai VIN history since 2021",
    lede: `Gulf cars in the archive since ${ARCHIVE_SINCE}. AED prices, specs and ${VIN_PAYLOAD_LIST} by VIN.`,
    seoTitle: "Dubai & UAE VIN History API — Gulf cars since 2021 | GetCarAPI",
    seoDescription: `Dubai and UAE VIN history API. Gulf cars collected since ${ARCHIVE_SINCE} — AED prices, luxury SUVs and export-hub stock. Ask free, retrieve on match.`,
    archiveLine: `UAE dealer and classified cars have been archived since ${ARCHIVE_SINCE} — Patrol, Cruiser and Range Rover stock with a printed chassis.`,
    stats: [
      { n: "AED", l: "Dirham asks and solds" },
      { n: "Since 2021", l: "Gulf cars on file" },
      { n: "Export hub", l: "Gulf re-export stock" },
    ],
    points: [
      { chip: "Classifieds", h: "UAE boards", p: "Luxury SUVs and Gulf-spec trims with a printed chassis." },
      { chip: "Currency", h: "AED on file", p: "Stored in dirhams when the ad was in AED." },
      { chip: "Ask first", h: "No credit to look", p: "A credit is used only when we return the record." },
    ],
    sampleNote: "Gulf-market SUVs and luxury stock — Land Cruiser, Patrol, Range Rover from UAE archives.",
    faqs: [
      { h: "How far back does Dubai VIN history go?", p: `Gulf and UAE cars have been collected since ${ARCHIVE_SINCE}.` },
    ],
  },
  {
    slug: "europe",
    flag: "EU",
    name: "Europe",
    skin: "cover",
    cars: EU,
    carsLabel: "European cars",
    note: "Classifieds · auctions",
    title: "Europe VIN history since 2021",
    lede: `European cars in the archive since ${ARCHIVE_SINCE}. Dealer and wholesale auction records — EUR prices, specs and gallery photos by VIN.`,
    seoTitle: "Europe VIN History API — European cars since 2021 | GetCarAPI",
    seoDescription: `Europe car history API. European cars collected since ${ARCHIVE_SINCE} — EUR asks, dealer ads and wholesale auctions. Same VIN retrieve as Korea and Canada.`,
    archiveLine: `European dealer and wholesale cars have been landing in the archive since ${ARCHIVE_SINCE} — several countries, one VIN key.`,
    stats: [
      { n: "EUR", l: "Euro asks on retrieve" },
      { n: "Since 2021", l: "European cars on file" },
      { n: "Archive", l: "Not a live lot board" },
    ],
    points: [
      { chip: "Classifieds", h: "Dealer & private", p: "Ads with a full chassis across EU markets." },
      { chip: "Auctions", h: "Wholesale lanes", p: "Hammer and venue when the ticket showed the VIN." },
      { chip: "Payload", h: "Same shape", p: `${VIN_PAYLOAD_LIST}.` },
    ],
    sampleNote: "European dealer stock — Mercedes, BMW, VW and Audi from regional archives.",
    faqs: [
      { h: "How far back does Europe VIN history go?", p: `European cars have been archived since ${ARCHIVE_SINCE}.` },
    ],
  },
  {
    slug: "china",
    flag: "CN",
    name: "China",
    skin: "cover",
    cars: CN,
    carsLabel: "Chinese cars",
    note: "Public VIN ads",
    title: "China VIN history since 2021",
    lede: `Chinese cars in the archive since ${ARCHIVE_SINCE}. RMB prices, EV stock and ${VIN_PAYLOAD_LIST} by VIN.`,
    seoTitle: "China VIN History API — Chinese cars since 2021 | GetCarAPI",
    seoDescription: `China car history API with Chinese cars collected since ${ARCHIVE_SINCE}. RMB listings, EV brands and full VIN payload. Check is free; credit only on retrieve.`,
    archiveLine: `Chinese used-car listings have been collected since ${ARCHIVE_SINCE} — BYD, NIO, Hongqi and more when the VIN was on the public ad.`,
    stats: [
      { n: "RMB", l: "Yuan on the listing" },
      { n: "Since 2021", l: "Chinese cars on file" },
      { n: "VIN rule", l: "No chassis, no row" },
    ],
    points: [
      { chip: "Listings", h: "Domestic boards", p: "Stored when the VIN was visible on the public ad." },
      { chip: "Retrieve", h: "One credit", p: `Only when we return ${VIN_PAYLOAD_LIST}.` },
      { chip: "Archive", h: "Since 2021", p: "Part of the same 10M+ vehicle archive." },
    ],
    sampleNote: "Chinese domestic brands — BYD, Geely, Hongqi, NIO — from our China archive.",
    faqs: [
      { h: "How far back does China VIN history go?", p: `Chinese cars have been collected since ${ARCHIVE_SINCE}.` },
    ],
  },
  {
    slug: "japan",
    flag: "JP",
    name: "Japan",
    skin: "cover",
    cars: JP,
    carsLabel: "Japanese cars",
    note: "Auction & export",
    title: "Japan VIN history since 2021",
    lede: `Japanese cars in the archive since ${ARCHIVE_SINCE}. Auction and export sheets — JPY hammer prices, specs and photos by VIN.`,
    seoTitle: "Japan VIN History & Auction API — JDM cars since 2021 | GetCarAPI",
    seoDescription: `Japan VIN history and auction API. Japanese cars collected since ${ARCHIVE_SINCE} — JPY hammer, export sheets and photos. Ask if we have the VIN first.`,
    archiveLine: `Japanese auction and export cars have been archived since ${ARCHIVE_SINCE} when the ticket or sheet listed a full VIN.`,
    stats: [
      { n: "JPY", l: "Yen hammer and asks" },
      { n: "Since 2021", l: "Japanese cars on file" },
      { n: "Export", l: "Overseas bid sheets" },
    ],
    points: [
      { chip: "Auction", h: "Printed VIN", p: "We keep the sale when the ticket showed the chassis." },
      { chip: "Export", h: "Overseas sheets", p: "Stored if the sheet listed a full VIN." },
      { chip: "Ask first", h: "No guesswork", p: "See if we have the VIN before a credit is used." },
    ],
    sampleNote: "JDM auction and export stock — Crown, GT-R, Alphard and similar from our archive.",
    faqs: [
      { h: "How far back does Japan VIN history go?", p: `Japanese auction and export cars have been collected since ${ARCHIVE_SINCE}.` },
    ],
  },
];

for (const m of HISTORY_MARKETS) {
  const real = marketCars(m.slug);
  if (real.length) m.cars = real;
}

function historyCountryFaqs(m) {
  const extra = m.faqs || [];
  const base = [
    { h: `When does a ${m.name} VIN lookup cost a credit?`, p: "Only when we return the full VIN record. Asking if we have the VIN uses no credit." },
    { h: `What is in a ${m.name} retrieve?`, p: `${VIN_PAYLOAD_LIST} — the same JSON shape as every other market.` },
    ...extra,
  ];
  return `<section class="section wrap history-faq-section">
  <div class="history-story-head reveal-on">
    <p class="kicker">${m.name} FAQ</p>
    <h2>${m.name} VIN history questions</h2>
  </div>
  <div class="history-faq-grid">
    ${base.map((f) => `<div class="history-faq-item reveal-on"><h3>${f.h}</h3><p>${f.p}</p></div>`).join("")}
  </div>
</section>`;
}

function historyCountryPage(m) {
  const faqs = [
    { h: `When does a ${m.name} VIN lookup cost a credit?`, p: "Only when we return the full VIN record. Asking if we have the VIN uses no credit." },
    { h: `What is in a ${m.name} retrieve?`, p: `${VIN_PAYLOAD_LIST} — the same JSON shape as every other market.` },
    ...(m.faqs || []),
  ];
  return {
    file: `car-history/${m.slug}/index.html`,
    path: `/car-history/${m.slug}/`,
    active: "/car-history/",
    skin: m.skin,
    title: m.seoTitle || `${m.name} VIN history API since ${ARCHIVE_SINCE} | GetCarAPI`,
    description: m.seoDescription || m.lede,
    jsonLd: [
      { "@context": "https://schema.org", "@type": "CollectionPage", name: `${m.name} VIN history since ${ARCHIVE_SINCE}`, url: `${SITE}/car-history/${m.slug}/`, description: m.seoDescription || m.lede },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.h,
          acceptedAnswer: { "@type": "Answer", text: f.p },
        })),
      },
    ],
    body: `${historyCountryHero(m)}
${historySubnav(m.slug)}
${historyAskFirstBand()}
${historyCountryStory(m)}
${historySamplesSection(m)}
${historyPayloadSection()}
${historyCountryFaqs(m)}
${coverageSection()}
${ctaBand("vin")}`,
  };
}

function vinRetrievalCta() {
  const payloadChips = PAYLOAD_TILES.map((p) => `<span class="vin-payload-chip">${p.label}</span>`).join("");
  return `<section class="cta-band vin-retrieval-cta">
  <div class="wrap vin-cta-grid">
    <div class="vin-cta-copy">
      <p class="kicker">How billing works</p>
      <h2>Ask first. Then retrieve.</h2>
      <p>See if this VIN is in the archive before a credit is used. You pay only when <span class="mono">GET /api/v1/vin/{vin}</span> returns HTTP 200 with the full record.</p>
      <ul class="vin-cta-points">
        <li><strong>Free check</strong> — Bearer required, no credit</li>
        <li><strong>${CREDIT_RETRIEVE}</strong> — only on HTTP 200 retrieve</li>
        <li><strong>Nothing billed</strong> — 404 not found or 429 rate limit</li>
      </ul>
      <div class="hero-actions">
        <a class="btn btn-primary" href="${ACCESS_URL}" data-access-cta>Sign up</a>
        <a class="btn btn-ghost" href="/api/">Read the docs</a>
      </div>
    </div>
    <div class="vin-cta-panel" aria-label="VIN retrieval flow">
      <div class="vin-flow-step is-free">
        <div class="vin-flow-head">
          <span class="vin-flow-n">1</span>
          <div>
            <strong>Ask if we have the VIN</strong>
            <code class="mono">GET /api/v1/vin/check/{vin}</code>
          </div>
          <span class="vin-flow-badge">Free</span>
        </div>
        <p>Bearer required. Returns whether the chassis is in the archive. No credit charged.</p>
      </div>
      <div class="vin-flow-connector" aria-hidden="true"><span>Only if found</span></div>
      <div class="vin-flow-step is-paid">
        <div class="vin-flow-head">
          <span class="vin-flow-n">2</span>
          <div>
            <strong>Retrieve the record</strong>
            <code class="mono">GET /api/v1/vin/{vin}</code>
          </div>
          <span class="vin-flow-badge">${CREDIT_RETRIEVE}</span>
        </div>
        <p>Token required. Credit is consumed only when the record is returned.</p>
      </div>
      <div class="vin-payload-block">
        <span class="vin-payload-label">Returned together</span>
        <div class="vin-payload-chips">${payloadChips}</div>
      </div>
    </div>
  </div>
</section>`;
}

const DOCS_NAV = [
  { href: "/api/", label: "Overview" },
  { href: "/api/authentication", label: "Authentication" },
  { href: "/api/#endpoints", label: "Endpoints" },
  { href: "/api/#errors", label: "Errors" },
  { href: "/docs", label: "OpenAPI", external: true },
];

const API_ENDPOINTS = {
  history: [
    {
      id: "vin-check",
      method: "GET",
      path: "/api/v1/vin/check/{vin}",
      auth: "Bearer",
      bill: "Free",
      when: "Ask whether we have this VIN before you retrieve. Use it to avoid spending a credit on empty lookups.",
      desc: "Authenticated check. Requires Authorization: Bearer vdi_…. Never consumes a credit. For a valid VIN string it returns 200 with existence flags.",
      params: [
        { name: "Authorization", in: "header", detail: "Bearer vdi_… (required)" },
        { name: "vin", in: "path", detail: "5–17 alphanumeric characters (A–Z, 0–9). Normalized to uppercase." },
      ],
      statuses: [
        { code: "200", detail: "Valid VIN — see exists / providers / hasHistory" },
        { code: "401", detail: "Missing / invalid / expired token" },
        { code: "400", detail: "INVALID_VIN — length or charset failed" },
      ],
      response: `{
  "success": true,
  "data": {
    "vin": "WDDUX8GB8JA397509",
    "exists": true,
    "providers": ["encar"],
    "hasHistory": true
  }
}`,
      example: `curl -H "Authorization: Bearer vdi_your_token" \\
  ${API_V1}/vin/check/WDDUX8GB8JA397509`,
    },
    {
      id: "vin-retrieve",
      method: "GET",
      path: "/api/v1/vin/{vin}",
      auth: "Bearer",
      bill: CREDIT_RETRIEVE,
      when: "After check returns exists: true. Returns the full archive record for that chassis.",
      desc: "Authenticated retrieve. One prepaid credit is charged only when the response is HTTP 200. 404 / 402 / 429 do not charge.",
      params: [
        { name: "Authorization", in: "header", detail: "Bearer vdi_… (required)" },
        { name: "vin", in: "path", detail: "Same rules as check" },
      ],
      statuses: [
        { code: "200", detail: `Full data + meta — ${CREDIT_RETRIEVE} charged` },
        { code: "401", detail: "Missing / invalid / expired token" },
        { code: "402", detail: "INSUFFICIENT_CREDITS — buy or top up credits" },
        { code: "404", detail: "VIN_NOT_FOUND — no charge" },
        { code: "429", detail: "Rate limit — no charge" },
        { code: "400", detail: "INVALID_VIN" },
      ],
      response: `{
  "success": true,
  "data": {
    "vin": "…",
    "vehicle": { },
    "sources": [ ],
    "listings": [ ],
    "observations": [ ],
    "events": [ ],
    "ownerChanges": [ ],
    "auctionSales": [ ],
    "accidents": [ ],
    "salvage": null,
    "photos": [ ]
  },
  "meta": {
    "durationMs": 42,
    "creditCharged": 1
  }
}`,
      example: `curl -H "Authorization: Bearer vdi_your_token" \\
  ${API_V1}/vin/WDDUX8GB8JA397509`,
    },
  ],
  live: [
    {
      id: "live-providers",
      method: "GET",
      path: "/api/v1/live/providers",
      auth: "Bearer",
      bill: "Live access",
      when: "Discover which Korean feeds your key can call, and whether a combined feed is available.",
      desc: "Lists enabled live providers. A combined entry is included when more than one feed is on.",
      params: [{ name: "Authorization", in: "header", detail: "Bearer vdi_…" }],
      statuses: [
        { code: "200", detail: "providers[]" },
        { code: "401", detail: "Auth failed" },
        { code: "503", detail: "NO_LIVE_PROVIDER" },
      ],
      example: `curl -H "Authorization: Bearer vdi_your_token" \\
  ${API_V1}/live/providers`,
    },
    {
      id: "live-vehicles",
      method: "GET",
      path: "/api/v1/live/vehicles",
      auth: "Bearer",
      bill: "Live access",
      when: "Browse current Korean retail/export stock for your site or desk. Does not spend VIN credits.",
      desc: "Paginated live inventory. Authenticated; does not spend VIN credits.",
      params: [
        { name: "Authorization", in: "header", detail: "Bearer vdi_…" },
        { name: "provider", in: "query", detail: "encar | encar_live | autowini | kbchachacha | kb | all | combined (default all)" },
        { name: "make, model, yearFrom, yearTo", in: "query", detail: "Optional filters" },
        { name: "priceMin, priceMax, fuel, transmission, location, search", in: "query", detail: "Optional filters" },
        { name: "sortBy, sortOrder", in: "query", detail: "Optional sort" },
        { name: "limit, offset", in: "query", detail: "limit 1–100 (default 20)" },
      ],
      statuses: [
        { code: "200", detail: "vehicles, hasMore, limit, offset, provider…" },
        { code: "400", detail: "INVALID_PROVIDER / INVALID_PARAMS" },
        { code: "401", detail: "Auth failed" },
        { code: "502 / 503", detail: "Upstream / not enabled" },
      ],
      example: `curl -H "Authorization: Bearer vdi_your_token" \\
  "${API_V1}/live/vehicles?provider=all&limit=20"`,
    },
    {
      id: "live-vehicle",
      method: "GET",
      path: "/api/v1/live/vehicles/{id}",
      auth: "Bearer",
      bill: "Live access",
      when: "Load one listing after the list call. Pass provider= when multiple feeds are enabled.",
      desc: "Single live listing by id. No VIN credit.",
      params: [
        { name: "Authorization", in: "header", detail: "Bearer vdi_…" },
        { name: "id", in: "path", detail: "Listing id from the list response" },
        { name: "provider", in: "query", detail: "Required when more than one feed is enabled" },
      ],
      statuses: [
        { code: "200", detail: "Listing object" },
        { code: "400 / 401 / 404 / 502", detail: "See OpenAPI for codes" },
      ],
      example: `curl -H "Authorization: Bearer vdi_your_token" \\
  "${API_V1}/live/vehicles/12345?provider=encar"`,
    },
  ],
};

function docsSubnav(activePath) {
  return `<div class="docs-nav-band">
  <nav class="docs-subnav wrap reveal-on" aria-label="Documentation">
    ${DOCS_NAV.map((l) => {
      const pathOnly = l.href.split("#")[0];
      const active =
        !l.external &&
        (activePath === pathOnly ||
          (pathOnly !== "/api/" && String(activePath).startsWith(pathOnly)) ||
          (l.href.includes("#") && activePath === "/api/" && false));
      const isOverviewActive = activePath === "/api/" && pathOnly === "/api/" && !l.href.includes("#");
      const on =
        l.href === "/api/"
          ? isOverviewActive
          : activePath === "/api/authentication" && pathOnly === "/api/authentication"
            ? true
            : active && !l.href.includes("#");
      const ext = l.external ? ` target="_blank" rel="noopener noreferrer"` : "";
      const suffix = l.external ? `<span class="docs-ext" aria-hidden="true">↗</span>` : "";
      return `<a href="${l.href}" class="docs-subnav-link${on ? " active" : ""}"${ext}>${l.label}${suffix}</a>`;
    }).join("")}
  </nav>
</div>`;
}

function apiEndpointCard(ep) {
  const billClass =
    ep.bill === "Free" ? " is-free" : ep.bill.includes("credit") ? " is-credit" : " is-live";
  const params = (ep.params || [])
    .map(
      (p) =>
        `<li><code class="mono">${p.name}</code> <em>${p.in}</em><span>${p.detail}</span></li>`,
    )
    .join("");
  const statuses = (ep.statuses || [])
    .map((s) => `<li><strong>${s.code}</strong><span>${s.detail}</span></li>`)
    .join("");
  return `<article class="api-endpoint reveal-on" id="${ep.id || ""}">
    <div class="api-endpoint-head">
      <span class="api-method">${ep.method}</span>
      <code class="api-path mono">${ep.path}</code>
      <span class="api-badge${billClass}">${ep.bill}</span>
    </div>
    ${ep.when ? `<p class="api-endpoint-when"><strong>Use when</strong> ${ep.when}</p>` : ""}
    <p class="api-endpoint-desc">${ep.desc}</p>
    <div class="api-endpoint-panels">
      <div class="api-endpoint-panel">
        <h4>Auth</h4>
        <p>${ep.auth === "None" ? "Public — no header" : `<span class="mono">Authorization: Bearer vdi_…</span>`}</p>
      </div>
      ${
        params
          ? `<div class="api-endpoint-panel">
        <h4>Parameters</h4>
        <ul class="api-param-list">${params}</ul>
      </div>`
          : ""
      }
      ${
        statuses
          ? `<div class="api-endpoint-panel">
        <h4>Status codes</h4>
        <ul class="api-status-list">${statuses}</ul>
      </div>`
          : ""
      }
      ${
        ep.headers
          ? `<div class="api-endpoint-panel">
        <h4>Response headers</h4>
        <p class="mono api-headers">${ep.headers}</p>
      </div>`
          : ""
      }
    </div>
    ${
      ep.response
        ? `<details class="api-fold">
      <summary>Sample response</summary>
      <pre class="api-example">${ep.response}</pre>
    </details>`
        : ""
    }
    ${
      ep.example
        ? `<details class="api-fold" open>
      <summary>Example request</summary>
      <pre class="api-example">${ep.example}</pre>
    </details>`
        : ""
    }
  </article>`;
}

function apiEndpointSection() {
  return `<section class="docs-block" id="endpoints">
  <header class="docs-block-head">
    <p class="kicker">Reference</p>
    <h2>Endpoints</h2>
    <p class="sub">One <span class="mono">vdi_</span> Bearer family for retrieve and live. Only a successful VIN retrieve spends a prepaid credit.</p>
  </header>
  <div class="docs-product-block" id="endpoints-history">
    <div class="docs-product-head">
      <span class="chip">Car history</span>
      <h3>VIN archive</h3>
      <p>Check is free (Bearer required, no credit). Retrieve is authenticated and metered.</p>
    </div>
    <div class="api-endpoint-grid">${API_ENDPOINTS.history.map(apiEndpointCard).join("")}</div>
  </div>
  <div class="docs-product-block" id="endpoints-live">
    <div class="docs-product-head">
      <span class="chip">Live feed</span>
      <h3>Korean live stock</h3>
      <p>Encar · Autowini · KB ChaChaCha. Bearer required. No VIN credit.</p>
    </div>
    <div class="api-endpoint-grid">${API_ENDPOINTS.live.map(apiEndpointCard).join("")}</div>
  </div>
</section>`;
}

function docsIntro() {
  return `<section class="docs-block" id="intro">
  <header class="docs-block-head">
    <p class="kicker">Start here</p>
    <h2>What this API does</h2>
  </header>
  <div class="docs-intro-grid">
    <article class="docs-intro-card">
      <h3>VIN history</h3>
      <p>Ask if a chassis is in our archive, then retrieve listings, auctions, events, accidents, salvage, and photos. You pay a credit only when the full record returns.</p>
    </article>
    <article class="docs-intro-card">
      <h3>Live Feed Korea</h3>
      <p>Stream current Encar, Autowini, and KB inventory onto your own site. Same token family as history — live calls do not spend VIN credits.</p>
    </article>
    <article class="docs-intro-card">
      <h3>Credits</h3>
      <p>Retrieve uses prepaid credits from your account. Sign in to the <a href="/account/">client area</a> for current rates and USDT top-up. Empty balance returns <span class="mono">402</span>.</p>
    </article>
  </div>
</section>`;
}

function docsHowItWorks() {
  return `<section class="docs-block" id="how-it-works">
  <header class="docs-block-head">
    <p class="kicker">Billing rules</p>
    <h2>Check free → retrieve only on match</h2>
    <p class="sub">When credits are charged.</p>
  </header>
  <ol class="docs-flow-rail">
    <li>
      <span class="docs-flow-rail-n">1</span>
      <div>
        <h3>Check <span class="api-badge is-free">Free</span></h3>
        <p><span class="mono">GET /api/v1/vin/check/{vin}</span> needs <span class="mono">Authorization: Bearer vdi_…</span>. No credit. Returns <span class="mono">exists</span>, <span class="mono">providers</span>, <span class="mono">hasHistory</span>.</p>
        <p class="docs-flow-tip">If <span class="mono">exists</span> is false, stop. Nothing to retrieve, nothing billed.</p>
      </div>
    </li>
    <li>
      <span class="docs-flow-rail-n">2</span>
      <div>
        <h3>Retrieve <span class="api-badge is-credit">${CREDIT_BADGE}</span></h3>
        <p><span class="mono">GET /api/v1/vin/{vin}</span> needs Bearer. A credit is charged only on <strong>HTTP 200</strong>.</p>
        <p class="docs-flow-tip"><strong>404</strong> not found · <strong>429</strong> rate limited · <strong>402</strong> no credits — none of these charge.</p>
      </div>
    </li>
    <li>
      <span class="docs-flow-rail-n">3</span>
      <div>
        <h3>Live <span class="api-badge is-live">No VIN credit</span></h3>
        <p><span class="mono">/api/v1/live/*</span> needs Bearer. Live traffic is not metered as VIN credits and does not count toward retrieve rate caps.</p>
      </div>
    </li>
  </ol>
  <div class="docs-callout">
    <strong>Balances &amp; usage</strong>
    <p>Check credits and request history in the <a href="/account/">client area</a>.</p>
  </div>
</section>`;
}

function docsVinPayload() {
  return `<section class="docs-block" id="vin-payload">
  <header class="docs-block-head">
    <p class="kicker">Retrieve payload</p>
    <h2>Fields on HTTP 200</h2>
    <p class="sub">Top-level <span class="mono">data</span> object. Full schemas live in OpenAPI.</p>
  </header>
  <div class="docs-payload-grid">
    <div class="docs-payload-item"><code>vehicle</code><span>Make, model, year, trim, fuel, transmission, mileage…</span></div>
    <div class="docs-payload-item"><code>sources</code><span>Providers that contributed to this VIN</span></div>
    <div class="docs-payload-item"><code>listings</code><span>Ads with price, km, location, source URLs</span></div>
    <div class="docs-payload-item"><code>observations</code><span>Point-in-time price / mileage snapshots</span></div>
    <div class="docs-payload-item"><code>events</code><span>Chassis timeline (registration, claims…)</span></div>
    <div class="docs-payload-item"><code>ownerChanges</code><span>Derived owner-change table</span></div>
    <div class="docs-payload-item"><code>auctionSales</code><span>Auction sale rows</span></div>
    <div class="docs-payload-item"><code>accidents</code><span>Accident table derived from events</span></div>
    <div class="docs-payload-item"><code>salvage</code><span>Salvage record or null</span></div>
    <div class="docs-payload-item"><code>photos</code><span>Photo URLs for the vehicle</span></div>
  </div>
  <p class="docs-payload-foot"><span class="mono">meta.durationMs</span> and <span class="mono">meta.creditCharged</span> sit beside <span class="mono">data</span>. Full schemas: <a href="/docs">OpenAPI</a>.</p>
</section>`;
}

function docsProductsOverview() {
  return `<section class="docs-block" id="products">
  <header class="docs-block-head">
    <p class="kicker">Products</p>
    <h2>Two surfaces, one token family</h2>
  </header>
  <div class="docs-products-grid">
    <a class="docs-product-card" href="#endpoints-history">
      <span class="chip">Car history</span>
      <h3>VIN archive</h3>
      <p>Public check → paid retrieve. Auctions, events, accidents, salvage, photos.</p>
      <span class="docs-product-go">Jump to VIN endpoints →</span>
    </a>
    <a class="docs-product-card" href="#endpoints-live">
      <span class="chip">Live feed</span>
      <h3>Korean retail stock</h3>
      <p>Current Encar / Autowini / KB lots as JSON. Bearer required — zero VIN credits.</p>
      <span class="docs-product-go">Jump to live endpoints →</span>
    </a>
  </div>
</section>`;
}

function docsQuickStart() {
  return `<section class="docs-block docs-block--band" id="quickstart">
  <header class="docs-block-head">
    <p class="kicker">Quick start</p>
    <h2>Three steps to production</h2>
    <p class="sub">Key → free check → retrieve only when <span class="mono">exists: true</span>.</p>
  </header>
  <div class="docs-quickstart">
    <article class="docs-qs-step">
      <span class="docs-qs-n">1</span>
      <div>
        <strong>Get a token</strong>
        <p>Register or sign in to the client area. Copy the <span class="mono">vdi_</span> secret once — it is never shown again.</p>
        <a href="/account/">Open client area →</a>
      </div>
    </article>
    <article class="docs-qs-step">
      <span class="docs-qs-n">2</span>
      <div>
        <strong>Check — Bearer, free</strong>
        <p>Send your token. If <span class="mono">exists</span> is false, stop. No credit is charged either way.</p>
        <pre class="api-example api-example--inline">Authorization: Bearer vdi_...

GET /api/v1/vin/check/{vin}</pre>
      </div>
    </article>
    <article class="docs-qs-step">
      <span class="docs-qs-n">3</span>
      <div>
        <strong>Retrieve or browse live</strong>
        <p>Send Bearer on retrieve and live. Credit only when retrieve returns 200.</p>
        <pre class="api-example api-example--inline">Authorization: Bearer vdi_...

GET /api/v1/vin/{vin}
GET /api/v1/live/vehicles?provider=all</pre>
      </div>
    </article>
  </div>
</section>`;
}

function docsErrorsSection() {
  return `<section class="docs-block" id="errors">
  <header class="docs-block-head">
    <p class="kicker">Errors</p>
    <h2>Common status codes</h2>
    <p class="sub">Bodies use <span class="mono">{ success, error: { code, message } }</span> on failures.</p>
  </header>
  <div class="docs-error-table-wrap">
    <table class="docs-error-table">
      <thead><tr><th>HTTP</th><th>Code</th><th>Meaning</th><th>Credit?</th></tr></thead>
      <tbody>
        <tr><td>400</td><td><span class="mono">INVALID_VIN</span></td><td>VIN failed validation</td><td>No</td></tr>
        <tr><td>401</td><td><span class="mono">MISSING_TOKEN</span> / <span class="mono">INVALID_TOKEN</span> / <span class="mono">TOKEN_EXPIRED</span></td><td>Auth failed</td><td>No</td></tr>
        <tr><td>402</td><td><span class="mono">INSUFFICIENT_CREDITS</span></td><td>No prepaid credits left</td><td>No</td></tr>
        <tr><td>403</td><td><span class="mono">ENDPOINT_NOT_ALLOWED</span></td><td>Token not permitted for this path</td><td>No</td></tr>
        <tr><td>404</td><td><span class="mono">VIN_NOT_FOUND</span></td><td>No archive row for this VIN</td><td>No</td></tr>
        <tr><td>429</td><td><span class="mono">DAILY_LIMIT_EXCEEDED</span> / monthly / per-VIN</td><td>Retrieve rate cap hit</td><td>No</td></tr>
        <tr><td>200</td><td>—</td><td>Full retrieve payload</td><td><strong>Yes · 1</strong></td></tr>
      </tbody>
    </table>
  </div>
</section>`;
}

function docsFaq() {
  return `<section class="docs-block" id="faq">
  <header class="docs-block-head">
    <p class="kicker">FAQ</p>
    <h2>Precise answers</h2>
  </header>
  <div class="docs-faq-grid">
    <div class="faq-item"><h3>Do I need a token to check a VIN?</h3><p>Yes. <span class="mono">GET /api/v1/vin/check/{vin}</span> requires <span class="mono">Authorization: Bearer vdi_…</span> but never uses a credit.</p></div>
    <div class="faq-item"><h3>When is a credit used?</h3><p>Only when <span class="mono">GET /api/v1/vin/{vin}</span> returns <strong>HTTP 200</strong>. 404, 402, and 429 do not bill.</p></div>
    <div class="faq-item"><h3>Do live calls use VIN credits?</h3><p>No. Live needs Bearer but is not prepaid-credit metered and does not count toward retrieve rate caps.</p></div>
    <div class="faq-item"><h3>How do I buy credits?</h3><p>In the <a href="/account/">client area</a>, submit a crypto purchase with your transaction hash. Credits are added after verification.</p></div>
    <div class="faq-item"><h3>How do I mix Encar and Autowini?</h3><p><span class="mono">provider=all</span> (or <span class="mono">combined</span>). Short aliases like <span class="mono">encar</span> and <span class="mono">*_live</span> both work.</p></div>
    <div class="faq-item"><h3>Where is the machine-readable spec?</h3><p><a href="/docs">OpenAPI</a> — sign in to browse VIN and live routes.</p></div>
  </div>
</section>`;
}

function authFaq() {
  return `<section class="docs-block" id="auth-faq">
  <header class="docs-block-head">
    <p class="kicker">FAQ</p>
    <h2>Authentication</h2>
  </header>
  <div class="docs-faq-grid">
    <div class="faq-item"><h3>Same token for live and history?</h3><p>Yes. One <span class="mono">vdi_</span> Bearer covers retrieve and live. Only retrieve spends credits.</p></div>
    <div class="faq-item"><h3>What if the token leaks?</h3><p>Regenerate in the client area. The old secret stops working immediately.</p></div>
    <div class="faq-item"><h3>Does 404 still require auth?</h3><p>Yes. Missing VINs return 404 with a valid Bearer — no credit is consumed.</p></div>
    <div class="faq-item"><h3>Auth error codes?</h3><p><span class="mono">MISSING_TOKEN</span>, <span class="mono">INVALID_TOKEN</span>, <span class="mono">TOKEN_EXPIRED</span>, <span class="mono">CLIENT_DISABLED</span> (401). <span class="mono">ENDPOINT_NOT_ALLOWED</span> (403) if the key’s allowed routes exclude the path.</p></div>
  </div>
</section>`;
}

function authTokenSection() {
  return `<section class="docs-block" id="bearer">
  <header class="docs-block-head">
    <p class="kicker">Bearer token</p>
    <h2>How authentication works</h2>
    <p class="sub">Issue keys in the client area. Prefix is always <span class="mono">vdi_</span>. Full secret is shown once.</p>
  </header>
  <div class="docs-auth-grid">
    <div class="docs-auth-panel">
      <h3>Header format</h3>
      <pre class="api-example">Authorization: Bearer vdi_your_token</pre>
      <ul class="docs-auth-list">
        <li>Prefix must be <span class="mono">vdi_</span></li>
        <li>Never put the token in the query string or path</li>
        <li>Rotate from the client area if it leaks</li>
        <li>Retrieve requires prepaid credits; check and live do not</li>
      </ul>
    </div>
    <div class="docs-auth-routes">
      <h3>Which routes need it?</h3>
      <div class="docs-auth-route"><span class="api-badge is-free">Free</span><code class="mono">GET /api/v1/vin/check/{vin}</code><small>Bearer · no credit</small></div>
      <div class="docs-auth-route"><span class="api-badge is-credit">${CREDIT_BADGE}</span><code class="mono">GET /api/v1/vin/{vin}</code><small>Bearer required</small></div>
      <div class="docs-auth-route"><span class="api-badge is-live">Live access</span><code class="mono">GET /api/v1/live/*</code><small>Bearer · no VIN credit</small></div>
    </div>
  </div>
</section>
<section class="docs-block" id="rate-limits">
  <header class="docs-block-head">
    <p class="kicker">Rate limits</p>
    <h2>Caps apply to successful retrieves only</h2>
    <p class="sub">Live feed traffic is authenticated but outside these three counters.</p>
  </header>
  <div class="docs-limits">
    <div class="docs-limit"><strong>Daily</strong><span>Successful <span class="mono">GET /vin/{vin}</span> (HTTP 2xx) per UTC day</span></div>
    <div class="docs-limit"><strong>Monthly</strong><span>Same — VIN retrieve successes only, not live calls</span></div>
    <div class="docs-limit"><strong>Per VIN</strong><span>Throttle repeated retrieves of the same chassis in a month</span></div>
  </div>
  <div class="docs-callout">
    <strong>Also required: prepaid credits</strong>
    <p>Retrieve needs available credits. Empty wallet → <span class="mono">402 INSUFFICIENT_CREDITS</span>. Manage balance in the client area.</p>
  </div>
</section>`;
}

function docsToc(items) {
  return `<aside class="docs-toc" aria-label="On this page">
  <p class="docs-toc-title">On this page</p>
  <ul>
    ${items.map((it) => `<li><a href="#${it.id}">${it.label}</a></li>`).join("")}
  </ul>
</aside>`;
}

function docsShell(tocItems, inner) {
  return `<div class="docs-shell wrap">
  ${docsToc(tocItems)}
  <div class="docs-main">${inner}</div>
</div>`;
}

function docsOverviewBody() {
  return `${docsHero({
    title: "API documentation",
    lede: "Integrate VIN history and Korean live inventory with clear billing: check needs Bearer but is free (no credit), retrieve costs one prepaid credit on HTTP 200, live needs a token but never spends credits.",
    primary: `<a class="btn btn-primary" href="${ACCESS_URL}" data-access-cta>Sign up</a>`,
    ghost: `<a class="btn btn-ghost" href="/docs">OpenAPI ↗</a>`,
  })}
${docsSubnav("/api/")}
${docsShell(
  [
    { id: "intro", label: "What it does" },
    { id: "how-it-works", label: "Billing rules" },
    { id: "quickstart", label: "Quick start" },
    { id: "products", label: "Products" },
    { id: "endpoints", label: "Endpoints" },
    { id: "vin-payload", label: "Retrieve payload" },
    { id: "errors", label: "Errors" },
    { id: "faq", label: "FAQ" },
  ],
  `${docsIntro()}
${docsHowItWorks()}
${docsQuickStart()}
${docsProductsOverview()}
${apiEndpointSection()}
${docsVinPayload()}
${docsErrorsSection()}
${docsFaq()}`,
)}
${vinRetrievalCta()}`;
}

function docsAuthBody() {
  return `${docsHero({
    title: "Authentication",
    lede: "VIN check, retrieve, and live routes all use Authorization: Bearer vdi_…. Check never spends a credit. Never pass the token in the query string.",
    primary: `<a class="btn btn-primary" href="${ACCESS_URL}" data-access-cta>Sign up</a>`,
    ghost: `<a class="btn btn-ghost" href="/api/">API overview</a>`,
    showRoutes: false,
  })}
${docsSubnav("/api/authentication")}
${docsShell(
  [
    { id: "bearer", label: "Bearer token" },
    { id: "rate-limits", label: "Rate limits" },
    { id: "auth-faq", label: "FAQ" },
  ],
  `${authTokenSection()}
${authFaq()}`,
)}
${vinRetrievalCta()}`;
}


function ctaBand(kind = "both") {
  const vin = `<a class="cta-mini" href="/car-history/">
          <span class="chip">VIN API</span>
          <strong>${VIN_PAYLOAD_DOTS}</strong>
          <small>Credit only when we return the record</small>
        </a>`;
  const live = `<a class="cta-mini" href="${LIVE_FEED}">
          <span class="chip">Live Feed Korea</span>
          <strong>Encar · Autowini · KB</strong>
          <small>Search, filter, markup on your site</small>
        </a>`;
  const copy = {
    both: {
      title: "Two products.",
      sub: "VIN: ask if we have it, then retrieve. Live Korea: Encar, Autowini and KB on your site.",
      pair: vin + live,
    },
    vin: {
      title: "Ask first. Then retrieve.",
      sub: `See if this VIN is in the archive. A credit is used only when we return the record — ${VIN_PAYLOAD_LIST}.`,
      pair: vin,
      enhanced: true,
    },
    live: {
      title: "Put Korea on your domain.",
      sub: "Encar, Autowini and KB ChaChaCha. Their ask. Your markup. Photos and filters on every car.",
      pair: live,
    },
  }[kind] || { title: kind, sub: "", pair: vin + live };
  if (copy.enhanced) return vinRetrievalCta();
  return `<section class="cta-band">
    <div class="wrap cta-inner">
      <h2>${copy.title}</h2>
      <p>${copy.sub}</p>
      <div class="cta-pair">${copy.pair}</div>
      <div class="hero-actions">
        <a class="btn btn-primary" href="${ACCESS_URL}" data-access-cta>Sign up</a>
        <a class="btn btn-ghost" href="/api/">Docs</a>
      </div>
    </div>
  </section>`;
}

function deskMock() {
  return `<section class="section wrap" id="desk">
  <p class="kicker reveal-on">How the feed looks</p>
  <h2 class="reveal-on">Search. Filter. Your price on the card.</h2>
  <p class="sub reveal-on">Real listings from our database — photos downloaded locally, not stock imagery.</p>
  <div class="desk reveal-on">
    <div class="desk-bar">
      <input class="desk-search" type="search" value="Hyundai" readonly aria-label="Search" />
      <div class="desk-filters">
        <span class="feed-chip on">Encar</span>
        <span class="feed-chip">Autowini</span>
        <span class="feed-chip">KB</span>
        <span class="feed-chip">All feeds</span>
      </div>
    </div>
    <div class="desk-grid">${KR.slice(0, 3).map((c) => stockCard(c)).join("")}</div>
  </div>
</section>`;
}

function vinDossier() {
  const hero = DOSSIER_HERO;
  const heroTitle = titleOf(hero);
  const moreShots = DOSSIER_PHOTOS.filter((p) => p.img !== hero?.img).slice(0, 5);
  const photoStrip = moreShots
    .map(
      (p) =>
        `<figure class="dossier-shot">
          ${photo(p.img, p.alt)}
          <figcaption>
            <b>${p.alt}</b>
            <small>${[p.chip, p.km].filter(Boolean).join(" · ")}</small>
          </figcaption>
        </figure>`,
    )
    .join("");
  const ask = hero?.price && hero.price !== "—" ? hero.price : null;
  const specs = [
    ["Year", hero?.year || "—"],
    ["Make", hero?.make || "—"],
    ["Model", hero?.model || "—"],
    ["Market", "South Korea"],
    ["Odometer", hero?.km || "—"],
    ["Source", hero?.chip || "Archive"],
  ];
  const gallery = `<div class="vin-record-proof archive-sample reveal-on">
    <div class="archive-sample-stage">
      <figure class="archive-sample-hero">
        ${photo(hero.img, heroTitle, true)}
        <figcaption class="archive-sample-hero-meta">
          <span class="archive-sample-badge">Lot photo</span>
          <span class="archive-sample-badge is-safe">VIN stripped</span>
        </figcaption>
      </figure>
      <div class="archive-sample-body">
        <div class="archive-sample-intro">
          <p class="kicker">Archive sample</p>
          <h3>${heroTitle}</h3>
          <p>Real photos from our database — chassis identifiers removed on this marketing site.</p>
          <div class="archive-sample-pills" aria-label="Record tags">
            ${flagSvg("KR", { className: "market-flag-svg market-flag-svg--sm" })}
            <span class="chip">${hero?.chip || "Archive"}</span>
            <span class="chip">South Korea</span>
            ${ask ? `<span class="chip archive-sample-ask">${ask} ask</span>` : `<span class="chip">In archive</span>`}
          </div>
        </div>
        <dl class="archive-sample-specs">
          ${specs
            .map(
              ([k, v]) =>
                `<div class="archive-sample-spec"><dt>${k}</dt><dd>${v}</dd></div>`,
            )
            .join("")}
        </dl>
        <p class="archive-sample-api"><code class="mono">GET /api/v1/vin/{vin}</code> · identity · ads · auctions · photos</p>
      </div>
    </div>
    <div class="archive-sample-more">
      <div class="archive-sample-more-head">
        <p class="kicker">More from the archive</p>
        <p>Same market strip — other chassis we keep with local photos.</p>
      </div>
      <div class="dossier-gallery vin-record-gallery">${photoStrip}</div>
    </div>
  </div>`;
  return vinRecordShowcase({ gallery });
}

function archiveDonutChart({ compact = false, hideHead = false, inner = false } = {}) {
  const segments = [
    { label: "United States", pct: 38, count: "3.9M", color: "#2563eb", href: "/car-history/usa/" },
    { label: "South Korea", pct: 32, count: "3.3M", color: "#3b82f6", href: "/car-history/south-korea/" },
    { label: "Canada", pct: 12, count: "1.2M", color: "#60a5fa", href: "/car-history/canada/" },
    { label: "Europe", pct: 8, count: "820K", color: "#818cf8", href: "/car-history/europe/" },
    { label: "Japan", pct: 4, count: "410K", color: "#94a3b8", href: "/car-history/japan/" },
    { label: "China", pct: 3, count: "305K", color: "#f87171", href: "/car-history/china/" },
    { label: "Dubai", pct: 3, count: "305K", color: "#fbbf24", href: "/car-history/dubai/" },
  ];
  const R = 118;
  const SW = 36;
  const CX = 160;
  const CY = 160;
  const C = 2 * Math.PI * R;
  const GAP = 4;
  let cumul = 0;
  const arcs = segments
    .map((s, i) => {
      const len = (s.pct / 100) * C - GAP;
      const off = cumul;
      cumul += (s.pct / 100) * C;
      const base = `cx="${CX}" cy="${CY}" r="${R}" fill="none" transform="rotate(-90 ${CX} ${CY})"`;
      const dash = `stroke-dasharray="0 ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" data-len="${len.toFixed(2)}" data-circ="${C.toFixed(2)}"`;
      const meta = `data-i="${i}" data-label="${s.label}" data-count="${s.count}" data-pct="${s.pct}"`;
      return `<circle class="donut-arc" ${meta} ${base} stroke="${s.color}" stroke-width="${SW}" stroke-linecap="butt" ${dash} />
<circle class="donut-hit" ${meta} ${base} stroke="transparent" stroke-width="${SW + 28}" ${dash} />`;
    })
    .join("");
  const legend = segments
    .map(
      (s, i) =>
        `<li class="leg-item" data-i="${i}" data-label="${s.label}" data-count="${s.count}" data-pct="${s.pct}">
          <span class="archive-dot" style="background:${s.color}"></span>
          <span class="leg-copy"><b>${s.label}</b><em>${s.count} · ${s.pct}%</em></span>
          <a class="leg-go" href="${s.href}" tabindex="-1" aria-label="${s.label} VIN history">→</a>
        </li>`,
    )
    .join("");
  const head = hideHead
    ? ""
    : `<header class="archive-chart-head reveal-on">
      <p class="kicker">VIN archive</p>
      <h2>10M+ vehicles since 2021</h2>
      <p class="sub">We cover USA, Korea, Canada, Europe, China, Dubai, Japan and more — dominant depth where dealers trade, and constantly expanding into new markets.</p>
    </header>`;
  const bodyInner = `${head}
    <div class="archive-chart-body${inner ? "" : " reveal-on"}">
      <div class="archive-chart-stage" data-archive-stage>
        <svg viewBox="0 0 320 320" class="donut-svg" role="img" aria-label="Archive split by market"><circle class="donut-track" cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#e8eef5" stroke-width="${SW}" />${arcs}</svg>
        <div class="donut-hub" aria-live="polite">
          <p class="donut-hub-kicker">Total archive</p>
          <p class="donut-hub-main"><strong class="donut-count" data-target="10">0</strong><span class="donut-suffix">M+</span></p>
          <p class="donut-hub-sub">vehicles since 2021</p>
          <div class="donut-hub-bar" aria-hidden="true"><span class="donut-hub-fill"></span></div>
          <p class="donut-hub-extra">USA · Korea · 5 more · still expanding</p>
        </div>
      </div>
      <ul class="archive-chart-legend">${legend}</ul>
    </div>`;
  if (inner) return bodyInner;
  return `<section class="archive-chart${compact ? " archive-chart--compact" : ""}" id="archive-chart"><div class="wrap archive-chart-inner">${bodyInner}</div></section>`;
}

function homeHeroSection() {
  return `<section class="landing-split landing-split--compact" aria-label="Two products">
  <a class="land vin" href="/car-history/">
    ${heroSlideshow(HERO_SALVAGE, { eager: true })}
    <span class="land-veil" aria-hidden="true"></span>
    <span class="land-shade" aria-hidden="true"></span>
    <div class="land-copy">
      <span class="land-k">Car history API</span>
      <h1>Car history</h1>
      <p>Listings, auctions, accidents, photos — ask free, credits on retrieve.</p>
      <span class="land-go">Open car history →</span>
    </div>
  </a>
  <a class="land live" href="${LIVE_FEED}">
    ${heroSlideshow(HERO_LIVE_KR, { eager: true })}
    <span class="land-veil" aria-hidden="true"></span>
    <span class="land-shade" aria-hidden="true"></span>
    <div class="land-copy">
      <span class="land-k">Live Feed Korea</span>
      <h1>Live Feed Korea</h1>
      <p>Encar, Autowini, KB on your site — their ask, your markup.</p>
      <span class="land-go">Open live feeds →</span>
    </div>
  </a>
  </section>`;
}

const VAULT_MARKETS = [
  { flag: "US", label: "United States", count: "3.9M", pct: 38, href: "/car-history/usa/", lead: true, color: "#2563eb" },
  { flag: "KR", label: "South Korea", count: "3.3M", pct: 32, href: "/car-history/south-korea/", lead: true, color: "#3b82f6" },
  { flag: "CA", label: "Canada", count: "1.2M", pct: 12, href: "/car-history/canada/", color: "#60a5fa" },
  { flag: "EU", label: "Europe", count: "820K", pct: 8, href: "/car-history/europe/", color: "#818cf8" },
  { flag: "JP", label: "Japan", count: "410K", pct: 4, href: "/car-history/japan/", color: "#94a3b8" },
  { flag: "CN", label: "China", count: "305K", pct: 3, href: "/car-history/china/", color: "#f87171" },
  { flag: "AE", label: "Dubai", count: "305K", pct: 3, href: "/car-history/dubai/", color: "#fbbf24" },
];

function vaultCarBackdrop() {
  const pool = uniqueCars([...US, ...KR, ...CA, ...EU, ...JP, ...AE], 18);
  return pool
    .map(
      (c, i) =>
        `<span class="home-vault-car" style="--i:${i}" aria-hidden="true"><img src="${c.img}" alt="" width="400" height="260" loading="lazy" decoding="async" /></span>`,
    )
    .join("");
}

function vaultHeroCars() {
  const pool = uniqueCars([...US.slice(0, 5), ...KR.slice(0, 5), ...CA.slice(0, 3)], 10);
  return pool
    .map(
      (c, i) =>
        `<span class="home-vault-hero-car" style="--i:${i}" aria-hidden="true"><img src="${c.img}" alt="" width="360" height="240" loading="lazy" decoding="async" /></span>`,
    )
    .join("");
}

function homeArchiveVault() {
  const tiles = VAULT_MARKETS.map(
    (m, i) =>
      `<a class="vault-tile${m.lead ? " vault-tile--lead" : ""}" href="${m.href}" data-i="${i}" style="--vault-accent:${m.color}">
        ${flagSvg(m.flag, { className: "market-flag-svg market-flag-svg--sm" })}
        <span class="vault-tile-copy">
          <strong>${m.label}</strong>
          <em>${m.count} vehicles</em>
        </span>
        <span class="vault-bar" aria-hidden="true"><span class="vault-bar-fill" data-pct="${m.pct}" style="width:0;background:${m.color}"></span></span>
        <span class="vault-pct">${m.pct}%</span>
      </a>`,
  ).join("");
  const stack = VAULT_MARKETS.map(
    (m) =>
      `<span class="vault-stack-seg" data-pct="${m.pct}" style="--seg:${m.color}" title="${m.label} ${m.pct}%"></span>`,
  ).join("");
  const payload = ["vehicle", "listings", "auctions", "events", "accidents", "salvage", "photos"]
    .map((p) => `<span>${p}</span>`)
    .join("");
  return `<section class="home-vault" id="archive-chart" aria-label="VIN archive scale">
  <div class="home-vault-cars" aria-hidden="true">${vaultCarBackdrop()}</div>
  <div class="wrap home-vault-wrap">
    <header class="home-vault-head">
      <div class="home-vault-head-copy">
        <p class="kicker">10M+ cars archived</p>
        <h2>10M+ cars — one of the deepest unified VIN archives online</h2>
        <p class="sub">Real listing photos from seven regional markets · one retrieve payload · collected continuously since ${ARCHIVE_SINCE}</p>
      </div>
      <p class="home-vault-live" aria-label="Archive is actively growing"><span class="home-vault-live-dot"></span> Still indexing daily</p>
    </header>
    <div class="home-vault-panel" data-vault-stage>
      <div class="home-vault-hero">
        <div class="home-vault-hero-cars" aria-hidden="true">${vaultHeroCars()}</div>
        <p class="home-vault-kicker">Global VIN archive</p>
        <p class="home-vault-count" aria-label="More than 10 million cars">
          <strong class="vault-count donut-count" data-target="10">0</strong><span class="vault-suffix">M+</span>
          <span class="home-vault-count-label">cars</span>
        </p>
        <p class="home-vault-tag">Listings, auctions, accidents &amp; photos — continuously indexed since ${ARCHIVE_SINCE}</p>
        <ul class="home-vault-facts">
          <li><strong>7</strong><span>markets</span></li>
          <li><strong>7</strong><span>payload blocks</span></li>
          <li><strong>1</strong><span>credit on retrieve</span></li>
        </ul>
        <a class="home-vault-cta btn btn-ghost btn-sm" href="/car-history/">Browse car history →</a>
      </div>
      <div class="home-vault-map-wrap">
        <div class="home-vault-stack" aria-hidden="true">${stack}</div>
        <div class="home-vault-map">${tiles}</div>
      </div>
    </div>
    <div class="home-vault-payload"><span class="home-vault-payload-k">One retrieve returns</span>${payload}</div>
  </div>
</section>`;
}

export const pages = [
  {
    file: "index.html",
    path: "/",
    active: "/",
    extraScript: `/assets/demo.js?v=${ASSET}`,
    skin: "home",
    title: "VIN History API & Korean Live Car Feeds | GetCarAPI",
    description: `Global VIN history API — 10M+ vehicles since ${ARCHIVE_SINCE}, including Korean and Canadian cars. Live Encar, Autowini and KB inventory. Ask free, retrieve on match.`,
    jsonLd: [
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [
        { "@type": "Question", name: "How is the VIN API billed?", acceptedAnswer: { "@type": "Answer", text: `Ask if we have the VIN first. That does not use a credit. A credit is used only when we return the record — ${VIN_PAYLOAD_LIST}.` } },
        { "@type": "Question", name: "What is the live feed for?", acceptedAnswer: { "@type": "Answer", text: "Encar, Autowini and KB ChaChaCha live inventory. You add markup on your site. The public sample is six cars with VINs removed." } },
        { "@type": "Question", name: "Which countries does GetCarAPI cover?", acceptedAnswer: { "@type": "Answer", text: `Live inventory is Korea — Encar, Autowini and KB ChaChaCha. VIN history covers South Korea, the United States, Canada, Dubai, Europe, China and Japan, with Korean and Canadian cars collected since ${ARCHIVE_SINCE}.` } },
        { "@type": "Question", name: "How large is the VIN history archive?", acceptedAnswer: { "@type": "Answer", text: `GetCarAPI stores more than 10 million vehicle records collected continuously since ${ARCHIVE_SINCE} — including Korean and Canadian cars — ${VIN_PAYLOAD_LIST} on retrieve. Older model years are included when they appeared in source boards.` } },
        { "@type": "Question", name: "Do I need a token to ask if you have a VIN?", acceptedAnswer: { "@type": "Answer", text: "Yes. GET /api/v1/vin/check/{vin} requires Authorization: Bearer vdi_… but does not use a credit." } },
      ]},
    ],
    body: `
${homeHeroSection()}
${MARQUEE}
${homeArchiveVault()}
${liveDemoBlock({ preview: true })}
${coverageSection()}
${ctaBand()}`,
  },
  {
    file: "live-feed-korean-cars/index.html",
    path: LIVE_FEED,
    active: LIVE_FEED,
    extraScript: `/assets/demo.js?v=${ASSET}`,
    skin: "live",
    title: "Korean Live Car Feed API — Encar Autowini KB | GetCarAPI",
    description: "Korean used-car live inventory API: Encar, Autowini and KB ChaChaCha. Photos, KRW ask, make/year/km filters. Pair with VIN history of Korean cars since 2021.",
    jsonLd: [
      { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "GetCarAPI live feed", url: `${SITE}${LIVE_FEED}`, applicationCategory: "BusinessApplication" },
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [
        { "@type": "Question", name: "Which Korean live feeds are available?", acceptedAnswer: { "@type": "Answer", text: "Encar, Autowini and KB ChaChaCha. Mix them with provider=all." } },
      ]},
    ],
    body: `${liveFeedHero()}
${liveFeedMidSections()}
${coverageSection()}
${ctaBand("live")}`,
  },
  {
    file: "live-feed-korean-cars/encar.html",
    path: `${LIVE_FEED}encar`,
    active: LIVE_FEED,
    extraScript: `/assets/demo.js?v=${ASSET}`,
    skin: "encar",
    title: "Encar live inventory API | GetCarAPI",
    description: "Stream Encar’s Korean used-car inventory. Photos, prices, filters. Add your selling price on top. Static sample with VIN stripped.",
    jsonLd: [
      { "@context": "https://schema.org", "@type": "WebPage", name: "Encar live stock", url: `${SITE}${LIVE_FEED}encar` },
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: LIVE_PROVIDER_PAGES.encar.faqs.map((f) => ({
        "@type": "Question",
        name: f.h,
        acceptedAnswer: { "@type": "Answer", text: String(f.p).replace(/<[^>]+>/g, "") },
      })) },
    ],
    body: providerPageBody(LIVE_PROVIDER_PAGES.encar),
  },
  {
    file: "live-feed-korean-cars/autowini.html",
    path: `${LIVE_FEED}autowini`,
    active: LIVE_FEED,
    extraScript: `/assets/demo.js?v=${ASSET}`,
    skin: "aw",
    title: "Autowini live export inventory API | GetCarAPI",
    description: "Live Autowini Korean export stock. Photos, ask, filters. Add FOB or packed price on your site. Static sample with VIN stripped.",
    jsonLd: [
      { "@context": "https://schema.org", "@type": "WebPage", name: "Autowini live stock", url: `${SITE}${LIVE_FEED}autowini` },
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: LIVE_PROVIDER_PAGES.autowini.faqs.map((f) => ({
        "@type": "Question",
        name: f.h,
        acceptedAnswer: { "@type": "Answer", text: String(f.p).replace(/<[^>]+>/g, "") },
      })) },
    ],
    body: providerPageBody(LIVE_PROVIDER_PAGES.autowini),
  },
  {
    file: "live-feed-korean-cars/kbchachacha.html",
    path: `${LIVE_FEED}kbchachacha`,
    active: LIVE_FEED,
    extraScript: `/assets/demo.js?v=${ASSET}`,
    skin: "kb",
    title: "KB ChaChaCha live inventory API | GetCarAPI",
    description: "Live KB ChaChaCha Korean used-car inventory for traders. Volume stock, photos, asking price. Static sample with VIN stripped.",
    jsonLd: [
      { "@context": "https://schema.org", "@type": "WebPage", name: "KB ChaChaCha live stock", url: `${SITE}${LIVE_FEED}kbchachacha` },
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: LIVE_PROVIDER_PAGES.kbchachacha.faqs.map((f) => ({
        "@type": "Question",
        name: f.h,
        acceptedAnswer: { "@type": "Answer", text: String(f.p).replace(/<[^>]+>/g, "") },
      })) },
    ],
    body: providerPageBody(LIVE_PROVIDER_PAGES.kbchachacha),
  },
  {
    file: "car-history/index.html",
    path: "/car-history/",
    active: "/car-history/",
    skin: "vin",
    title: "Car History API — 10M+ VINs since 2021 | GetCarAPI",
    description: `VIN history for 10M+ vehicles since ${ARCHIVE_SINCE}, including Korean and Canadian cars. Ask if we have the VIN first. A credit is used only when we return ${VIN_PAYLOAD}.`,
    jsonLd: [
      { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "GetCarAPI car history", url: `${SITE}/car-history/`, applicationCategory: "DeveloperApplication" },
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [
        { "@type": "Question", name: "When does a VIN lookup cost a credit?", acceptedAnswer: { "@type": "Answer", text: "Only when we return the full VIN record. Asking if we have the VIN uses no credit. If it is not in the archive, nothing is billed." } },
        { "@type": "Question", name: "How many vehicles are in car history?", acceptedAnswer: { "@type": "Answer", text: `More than 10 million vehicles collected since ${ARCHIVE_SINCE}, including Korean and Canadian cars — ${VIN_PAYLOAD_LIST} on retrieve.` } },
        { "@type": "Question", name: "Which markets are covered?", acceptedAnswer: { "@type": "Answer", text: `South Korea, the United States, Canada, Dubai, Europe, China and Japan. Korean and Canadian cars have been collected continuously since ${ARCHIVE_SINCE}.` } },
      ]},
    ],
    body: `${historyHubHero()}
${historySubnav(null)}
${historyAskFirstBand()}
${vinDossier()}
${coverageSection({ showMarkets: false })}
${ctaBand("vin")}`,
  },
  ...HISTORY_MARKETS.map(historyCountryPage),
  {
    file: "countries/index.html",
    path: "/countries/",
    active: "/countries/",
    skin: "cover",
    title: "Car Data Coverage — Korea Live & Global VIN History | GetCarAPI",
    description: `Korean live inventory from Encar, Autowini and KB. VIN history across South Korea, USA, Canada, Dubai, Europe, China and Japan — 10M+ vehicles since ${ARCHIVE_SINCE}.`,
    body: `${pageHero({
      title: "Korean live feeds. Global VIN archive.",
      lede: `Sell from Korea today: Encar, Autowini and KB live stock. Research any chassis: 10M+ records across seven markets since ${ARCHIVE_SINCE}, including Korean and Canadian cars.`,
      primary: `<a class="btn btn-primary" href="${LIVE_FEED}">Live feeds</a>`,
      ghost: `<a class="btn btn-ghost" href="/car-history/">Car history</a>`,
      visual: heroShot(KR[1] ?? KR[0] ?? HERO_LIVE_KR[0]),
    })}
${archiveStatsBand()}
${coverageSection()}
${ctaBand()}`,
  },
  {
    file: "api/index.html",
    path: "/api/",
    active: "/api/",
    skin: "docs",
    title: "GetCarAPI Docs — VIN History & Korean Live Feed API",
    description: `API reference: VIN check is free, retrieve uses prepaid credits on HTTP 200, Live Feed Korea never spends credits. Archive covers Korean and Canadian cars since ${ARCHIVE_SINCE}.`,
    jsonLd: [
      { "@context": "https://schema.org", "@type": "TechArticle", name: "How GetCarAPI works", url: `${SITE}/api/` },
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [
        { "@type": "Question", name: "Do I need a token to check a VIN?", acceptedAnswer: { "@type": "Answer", text: "Yes. GET /api/v1/vin/check/{vin} requires Authorization: Bearer vdi_… but does not use a credit." } },
        { "@type": "Question", name: "When is a VIN credit consumed?", acceptedAnswer: { "@type": "Answer", text: "Only when GET /api/v1/vin/{vin} returns the full record with HTTP 200." } },
        { "@type": "Question", name: "Which live providers are available?", acceptedAnswer: { "@type": "Answer", text: "Encar, Autowini and KB ChaChaCha. Use provider=all to merge enabled feeds." } },
      ]},
    ],
    body: docsOverviewBody(),
  },
  {
    file: "api/authentication.html",
    path: "/api/authentication",
    active: "/api/",
    skin: "docs",
    title: "API authentication — Bearer token | GetCarAPI",
    description: "Bearer token authentication for VIN check, VIN retrieve, and live feed routes. VIN check is free (no credit) but still requires Authorization: Bearer vdi_….",
    jsonLd: { "@context": "https://schema.org", "@type": "TechArticle", name: "Bearer token", url: `${SITE}/api/authentication` },
    body: docsAuthBody(),
  },
];

export function inferFoot(path) {
  if (String(path).startsWith("/api")) return "docs";
  if (String(path).startsWith("/live-feed-korean-cars")) return "live";
  if (String(path).startsWith("/car-history")) return "vin";
  return "both";
}

export function renderPage(page) {
  return layout({ ...page, foot: page.foot ?? inferFoot(page.path) });
}

export function accountPage() {
  return layout({
    title: "Client area — GetCarAPI",
    description: "Sign in for credits, API docs, and usage graphs for your GetCarAPI account.",
    path: "/account/",
    noindex: true,
    active: "/account/",
    extraScript: `/assets/demo.js?v=${ASSET}`,
    skin: "dash",
    body: `<section class="page wrap acct-auth-page" id="app"><div class="dash-skel fade-in"><div class="sk-bar"></div></div></section>`,
  }).replace("</body>", `<script src="/assets/account.js?v=${ASSET}" defer></script>\n</body>`);
}
