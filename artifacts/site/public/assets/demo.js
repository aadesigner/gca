const DEFAULT_BRAND = "Pacific Motors";

/** Illustrative FX for the public demo — not a live rate feed. */
const FX_TO_KRW = { KRW: 1, USD: 1380, EUR: 1500 };
const CURRENCIES = [
  { code: "KRW", label: "₩ KRW", step: 100000 },
  { code: "USD", label: "$ USD", step: 100 },
  { code: "EUR", label: "€ EUR", step: 100 },
];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function brandSlug(name) {
  const s = String(name || "yourbrand")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return s || "yourbrand";
}

function formatMoney(amount, currency) {
  if (amount == null || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return "On request";
  const n = Number(amount);
  const cur = (currency || "KRW").toUpperCase();
  if (cur === "KRW") return `₩${Math.round(n).toLocaleString("en-US")}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: cur === "KRW" ? 0 : 0,
    }).format(Math.round(n));
  } catch {
    return `${Math.round(n).toLocaleString("en-US")} ${cur}`;
  }
}

function convertAmount(amount, fromCurrency, toCurrency) {
  if (amount == null || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return null;
  const from = String(fromCurrency || "KRW").toUpperCase();
  const to = String(toCurrency || "KRW").toUpperCase();
  if (from === to) return Number(amount);
  const fromRate = FX_TO_KRW[from] || FX_TO_KRW.KRW;
  const toRate = FX_TO_KRW[to] || FX_TO_KRW.KRW;
  return (Number(amount) * fromRate) / toRate;
}

function applyMarkup(amount, percent, extra) {
  if (amount == null || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return null;
  return Math.round(Number(amount) * (1 + Number(percent || 0) / 100) + Number(extra || 0));
}

function providerLabel(vehicle, fallback) {
  return vehicle?.sourceProvider?.name || vehicle?.provider?.name || fallback || "Live";
}

function photoUrl(vehicle) {
  const photos = vehicle?.photos;
  let url = "";
  if (Array.isArray(photos) && photos[0]) {
    const p = photos[0];
    if (typeof p === "string" && p) url = p;
    else if (p && typeof p === "object") url = p.url || p.sourceUrl || p.storedPath || p.src || "";
  }
  if (!url) url = vehicle?.thumbnail || vehicle?.image || vehicle?.photo || "";
  if (!url || url.startsWith("/assets/")) return url;
  try {
    const host = new URL(url, location.origin).hostname;
    if (/encar\.com|autowini\.com|imagebox|kbchachacha|chachacha/i.test(host)) {
      return `/api/site/img?u=${encodeURIComponent(url)}`;
    }
  } catch {
    /* keep */
  }
  return url;
}

function filterVehicles(vehicles, provider) {
  if (!provider || provider === "all" || provider === "sample") return vehicles;
  const key = String(provider).replace(/_live$/i, "");
  const filtered = vehicles.filter((v) => String(v.sourceProvider?.internalName || "").includes(key));
  return filtered.length ? filtered : vehicles;
}

function displayCap(baseLimit, provider, perProvider) {
  const cap =
    !provider || provider === "all" || provider === "sample"
      ? baseLimit
      : Math.min(perProvider, baseLimit);
  if (window.matchMedia("(max-width: 480px)").matches) return Math.min(cap, 3);
  if (window.matchMedia("(max-width: 860px)").matches) return Math.min(cap, 4);
  return cap;
}

function initMobileDemoLayout(root) {
  const drawer = root.querySelector(".demo-panel-drawer");
  if (!drawer) return;
  const mobile = window.matchMedia("(max-width: 860px)");
  const sync = () => {
    if (mobile.matches) drawer.removeAttribute("open");
    else drawer.setAttribute("open", "");
  };
  sync();
  mobile.addEventListener("change", sync);
}

function renderCard(car, { percent, extra, provider, displayCurrency }) {
  const sourceCur = car.currency || "KRW";
  const displayCur = displayCurrency || "KRW";
  const askDisplay = convertAmount(car.price, sourceCur, displayCur);
  const askRounded = askDisplay == null ? null : Math.round(askDisplay);
  const yours = applyMarkup(askRounded, percent, extra);
  const img = photoUrl(car);
  const title = [car.year, car.make, car.model].filter(Boolean).join(" ") || "Korean listing";
  const km = car.mileage != null ? `${Number(car.mileage).toLocaleString("en-US")} km` : "";
  const specs = [km, car.fuel, car.transmission].filter(Boolean);
  const trim = car.trim ? `<span class="demo-trim">${escapeHtml(car.trim)}</span>` : "";

  return `<article class="stock-card demo-card">
    <div class="stock-photo">${img ? `<img src="${img}" alt="${escapeHtml(title)}" loading="lazy" decoding="async" />` : ""}<span>${escapeHtml(providerLabel(car, provider))}</span></div>
    <div class="stock-meta">
      <strong>${escapeHtml(title)}</strong>
      ${trim}
      <div class="demo-specs">${specs.map((s) => `<span>${escapeHtml(s)}</span>`).join("")}</div>
      <div class="demo-prices">
        <div class="demo-price-col">
          <small>Wholesale</small>
          <span class="ask">${formatMoney(askRounded, displayCur)}</span>
        </div>
        <div class="demo-price-col yours">
          <small>Your price</small>
          <em>${formatMoney(yours, displayCur)}</em>
        </div>
      </div>
    </div>
  </article>`;
}

function sitePreviewHtml(brandName, bannerLine) {
  const brand = escapeHtml(brandName || DEFAULT_BRAND);
  const slug = brandSlug(brandName || DEFAULT_BRAND);
  const banner = escapeHtml(bannerLine || "Encar · Autowini · KB — on your domain");
  return `<div class="demo-preview">
    <div class="demo-browser">
      <div class="demo-browser-chrome">
        <div class="demo-browser-dots" aria-hidden="true">
          <span class="demo-dot r"></span><span class="demo-dot y"></span><span class="demo-dot g"></span>
        </div>
        <div class="demo-browser-url" aria-hidden="true">
          <svg class="demo-browser-lock" viewBox="0 0 12 14" width="10" height="12" aria-hidden="true"><path fill="currentColor" d="M6 0a3 3 0 0 1 3 3v2h1a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1V3a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v2h2V3a1 1 0 0 0-1-1Z"/></svg>
          <span id="demo-site-url">${slug}.com/korea-stock</span>
        </div>
      </div>
      <header class="demo-site-head">
        <div class="demo-site-brand-wrap">
          <span class="demo-site-mark" aria-hidden="true"></span>
          <strong class="demo-site-brand" id="demo-brand-display">${brand}</strong>
        </div>
        <nav class="demo-site-nav" aria-hidden="true">
          <span>Home</span><span>Inventory</span><span>Import</span><span>Contact</span>
        </nav>
        <span class="demo-site-cta">Get a quote</span>
      </header>
      <div class="demo-site-banner">
        <div class="demo-site-banner-copy">
          <small>Live Korean stock</small>
          <strong>${banner}</strong>
        </div>
        <div class="demo-site-search" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8.5 3a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm0 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm6.04 9.46-2.8-2.8 1.06-1.06 2.8 2.8-1.06 1.06Z"/></svg>
          <span>Search make, model, year…</span>
        </div>
      </div>
      <div class="demo-site-body">
        <div class="demo-grid" id="demo-grid"></div>
      </div>
      <footer class="demo-site-foot" aria-hidden="true">
        <span>© <span id="demo-brand-foot">${brand}</span></span>
      </footer>
    </div>
  </div>`;
}

function controlsHtml({ providers, preview, brand = DEFAULT_BRAND, defaultProvider, bannerLine }) {
  const ordered = [...providers];
  if (defaultProvider) {
    const i = ordered.findIndex((p) => {
      const id = String(p.internalName || "");
      const key = String(defaultProvider).replace(/_live$/i, "");
      return id === defaultProvider || id.includes(key) || key.includes(id.replace(/_live$/i, ""));
    });
    if (i > 0) {
      const [hit] = ordered.splice(i, 1);
      ordered.unshift(hit);
    }
  }
  const feedOptions = ordered
    .map(
      (p, i) =>
        `<button type="button" class="feed-chip${i === 0 ? " on" : ""}" data-provider="${p.internalName}">${String(p.name).replace(/_live$/i, "")}</button>`,
    )
    .join("");

  const currencyOptions = CURRENCIES.map(
    (c, i) =>
      `<button type="button" class="feed-chip currency-chip${i === 0 ? " on" : ""}" data-currency="${c.code}">${c.label}</button>`,
  ).join("");

  const badge = preview
    ? `<div class="demo-badge">Preview · static sample · not the live API</div>`
    : `<div class="live-bar"><span class="pulse"></span> Live sample · VIN stripped</div>`;

  return `<div class="demo-layout">
    <details class="demo-panel-drawer">
      <summary class="demo-panel-drawer-summary">Customize preview</summary>
      <aside class="demo-panel">
      ${badge}
      <label class="demo-brand-field markup">
        <span>Your website name</span>
        <input type="text" id="demo-brand" value="${escapeHtml(brand)}" maxlength="42" placeholder="e.g. Pacific Motors" autocomplete="off" spellcheck="false" />
      </label>
      <div class="demo-toolbar-feed">
        <span class="demo-toolbar-label">Feed source</span>
        <div class="feed-row" role="tablist">${feedOptions}</div>
      </div>
      <div class="demo-toolbar-feed">
        <span class="demo-toolbar-label">Show prices in</span>
        <div class="feed-row currency-row" role="tablist" aria-label="Display currency">${currencyOptions}</div>
        <small class="demo-fx-note">Illustrative FX · ₩1,380 / $ · ₩1,500 / €</small>
      </div>
      <div class="demo-toolbar-math">
        <label class="markup">
          <span>Your markup %</span>
          <div class="markup-field">
            <input type="range" id="demo-markup-range" min="0" max="50" step="1" value="12" />
            <input type="number" id="demo-markup" value="12" min="0" max="200" step="1" />
          </div>
        </label>
        <label class="markup">
          <span id="demo-extra-label">+ flat KRW</span>
          <div class="markup-field markup-field--extra">
            <input type="number" id="demo-extra" value="0" min="0" step="100000" inputmode="numeric" />
          </div>
        </label>
      </div>
      </aside>
    </details>
    ${sitePreviewHtml(brand, bannerLine)}
  </div>`;
}

function updateBrandDisplay(root, name) {
  const label = String(name || "").trim() || DEFAULT_BRAND;
  const slug = brandSlug(label);
  const display = root.querySelector("#demo-brand-display");
  const foot = root.querySelector("#demo-brand-foot");
  const url = root.querySelector("#demo-site-url");
  if (display) {
    display.textContent = label;
    display.classList.remove("brand-pulse");
    void display.offsetWidth;
    display.classList.add("brand-pulse");
  }
  if (foot) foot.textContent = label;
  if (url) url.textContent = `${slug}.com/korea-stock`;
}

async function loadStaticPack() {
  const res = await fetch("/assets/live-sample.json");
  if (!res.ok) throw new Error("Could not load sample listings");
  return res.json();
}

function wireDemo(root, { allVehicles, limit, providers, perProvider = 6 }) {
  const grid = root.querySelector("#demo-grid");
  let provider = root.querySelector(".feed-chip.on:not(.currency-chip)")?.dataset.provider || "all";
  let displayCurrency = root.querySelector(".currency-chip.on")?.dataset.currency || "KRW";

  const brandInput = root.querySelector("#demo-brand");
  const markupInput = root.querySelector("#demo-markup");
  const markupRange = root.querySelector("#demo-markup-range");
  const extraInput = root.querySelector("#demo-extra");
  const extraLabel = root.querySelector("#demo-extra-label");

  brandInput?.addEventListener("input", () => updateBrandDisplay(root, brandInput.value));

  const syncMarkup = (from) => {
    if (from === "range" && markupRange && markupInput) markupInput.value = markupRange.value;
    if (from === "number" && markupRange && markupInput) markupRange.value = Math.min(50, Number(markupInput.value) || 0);
  };

  const syncExtraForCurrency = (nextCurrency) => {
    const meta = CURRENCIES.find((c) => c.code === nextCurrency) || CURRENCIES[0];
    if (extraLabel) extraLabel.textContent = `+ flat ${meta.code}`;
    if (extraInput) {
      const prev = Number(extraInput.value || 0);
      const converted = Math.round(convertAmount(prev, displayCurrency, nextCurrency) || 0);
      extraInput.step = String(meta.step);
      extraInput.value = String(converted || 0);
    }
  };

  markupRange?.addEventListener("input", () => {
    syncMarkup("range");
    render();
  });
  markupInput?.addEventListener("input", () => {
    syncMarkup("number");
    render();
  });
  extraInput?.addEventListener("input", render);

  root.querySelectorAll(".feed-chip:not(.currency-chip)").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".feed-chip:not(.currency-chip)").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      provider = btn.dataset.provider;
      render();
    });
  });

  root.querySelectorAll(".currency-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.currency || "KRW";
      if (next === displayCurrency) return;
      root.querySelectorAll(".currency-chip").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      syncExtraForCurrency(next);
      displayCurrency = next;
      render();
    });
  });

  function render() {
    const percent = Number(markupInput?.value || 0);
    const extra = Number(extraInput?.value || 0);
    const filtered = filterVehicles(allVehicles, provider);
    const vehicles = filtered.slice(0, displayCap(limit, provider, perProvider));

    if (!vehicles.length) {
      grid.innerHTML = `<p class="sub demo-empty-grid">No sample cars for this feed.</p>`;
      return;
    }

    grid.innerHTML = vehicles
      .map((car) => renderCard(car, { percent, extra, provider, displayCurrency }))
      .join("");
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 120);
  });

  render();
}

async function loadDemo(root) {
  const mode = root.dataset.mode || "public";
  const preview = mode === "preview";

  if (mode === "client") {
    await loadClientDemo(root);
    return;
  }

  let pack;
  try {
    pack = await loadStaticPack();
  } catch (err) {
    root.innerHTML = `<div class="demo-empty"><h3>Sample unavailable</h3><p>${err.message}</p></div>`;
    return;
  }

  const providers = pack.providers || [{ name: "All feeds", internalName: "all" }];
  const allVehicles = pack.vehicles || [];
  const perProvider = Number(pack.perProvider || 6);
  const limit = Number(root.dataset.limit || pack.limit || perProvider * 3);
  const defaultProvider = root.dataset.provider || "";
  const defaultLabel = orderedBannerLabel(providers, defaultProvider);

  root.innerHTML = controlsHtml({ providers, preview, defaultProvider, bannerLine: defaultLabel });
  root.classList.toggle("demo-preview", preview);
  initMobileDemoLayout(root);
  wireDemo(root, { allVehicles, limit, providers, perProvider });
}

function orderedBannerLabel(providers, defaultProvider) {
  if (!defaultProvider || defaultProvider === "all") return "Encar · Autowini · KB — on your domain";
  const hit = providers.find((p) => {
    const id = String(p.internalName || "");
    const key = String(defaultProvider).replace(/_live$/i, "");
    return id === defaultProvider || id.includes(key);
  });
  const name = hit?.name ? String(hit.name).replace(/_live$/i, "") : "Korean";
  return `${name} live — on your domain`;
}

async function loadClientDemo(root) {
  let providers = [];
  const limit = 6;
  let error = "";

  try {
    const res = await fetch("/api/client/live/providers", { credentials: "include" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not load live providers");
    providers = body.providers || [];
  } catch (err) {
    error = err.message;
  }

  if (error) {
    root.innerHTML = `<div class="demo-empty"><h3>Live demo unavailable</h3><p>${error}</p></div>`;
    return;
  }

  root.innerHTML = controlsHtml({
    providers: providers.length ? providers : [{ name: "All feeds", internalName: "all" }],
    preview: false,
  });
  initMobileDemoLayout(root);

  const grid = root.querySelector("#demo-grid");
  let provider = root.querySelector(".feed-chip.on:not(.currency-chip)")?.dataset.provider || "all";
  let displayCurrency = root.querySelector(".currency-chip.on")?.dataset.currency || "KRW";
  const brandInput = root.querySelector("#demo-brand");
  const markupInput = root.querySelector("#demo-markup");
  const markupRange = root.querySelector("#demo-markup-range");
  const extraInput = root.querySelector("#demo-extra");
  const extraLabel = root.querySelector("#demo-extra-label");

  brandInput?.addEventListener("input", () => updateBrandDisplay(root, brandInput.value));

  markupRange?.addEventListener("input", () => {
    if (markupInput) markupInput.value = markupRange.value;
    run();
  });
  markupInput?.addEventListener("input", () => {
    if (markupRange) markupRange.value = Math.min(50, Number(markupInput.value) || 0);
    run();
  });
  extraInput?.addEventListener("input", run);

  root.querySelectorAll(".feed-chip:not(.currency-chip)").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".feed-chip:not(.currency-chip)").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      provider = btn.dataset.provider;
      run();
    });
  });

  root.querySelectorAll(".currency-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.currency || "KRW";
      if (next === displayCurrency) return;
      root.querySelectorAll(".currency-chip").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      const meta = CURRENCIES.find((c) => c.code === next) || CURRENCIES[0];
      if (extraLabel) extraLabel.textContent = `+ flat ${meta.code}`;
      if (extraInput) {
        const prev = Number(extraInput.value || 0);
        extraInput.value = String(Math.round(convertAmount(prev, displayCurrency, next) || 0));
        extraInput.step = String(meta.step);
      }
      displayCurrency = next;
      run();
    });
  });

  async function run() {
    const percent = Number(markupInput?.value || 0);
    const extra = Number(extraInput?.value || 0);
    const qs = new URLSearchParams({ provider, limit: String(limit) });
    grid.innerHTML = `<p class="sub demo-loading">Loading live listings…</p>`;
    try {
      const res = await fetch(`/api/client/live/vehicles?${qs}`, { credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Live request failed");
      const vehicles = body.vehicles || [];
      if (!vehicles.length) {
        grid.innerHTML = `<p class="sub demo-empty-grid">No cars returned. Try another feed.</p>`;
        return;
      }
      grid.innerHTML = vehicles
        .map((car) => renderCard(car, { percent, extra, provider, displayCurrency }))
        .join("");
    } catch (err) {
      grid.innerHTML = `<p class="sub demo-empty-grid">${err.message}</p>`;
    }
  }

  run();
}

window.mountLiveDemo = loadDemo;
document.querySelectorAll("#live-demo").forEach((el) => {
  const boot = () => loadDemo(el);
  const eager = el.dataset.eager === "1" || Boolean(el.closest(".phero-live-feed"));
  if (eager || !("IntersectionObserver" in window)) {
    boot();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        boot();
      }
    },
    { rootMargin: "240px 0px" },
  );
  io.observe(el);
});
