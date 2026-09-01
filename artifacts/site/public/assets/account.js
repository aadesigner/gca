const app = document.getElementById("app");

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function when(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(String(value));
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function dayLabel(isoDay) {
  const d = new Date(`${isoDay}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function api(path, init = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

let portalConfig = {
  enabled: false,
  siteKey: null,
  registrationEnabled: false,
  loginEnabled: true,
  contactEmail: "info@getcarapi.com",
};
let grecaptchaReady = null;

async function loadPortalConfig() {
  try {
    portalConfig = await api("/client/auth/captcha-config");
  } catch {
    portalConfig = {
      enabled: false,
      siteKey: null,
      registrationEnabled: false,
      loginEnabled: true,
      contactEmail: "info@getcarapi.com",
    };
  }
  return portalConfig;
}

/** @deprecated use portalConfig */
let captchaConfig = portalConfig;

function ensureGrecaptcha(siteKey) {
  if (!siteKey) return Promise.resolve(null);
  if (window.grecaptcha?.execute) return Promise.resolve(window.grecaptcha);
  if (grecaptchaReady) return grecaptchaReady;
  grecaptchaReady = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-gcap-recaptcha]");
    if (existing) {
      const tick = () => (window.grecaptcha?.ready ? window.grecaptcha.ready(() => resolve(window.grecaptcha)) : setTimeout(tick, 50));
      tick();
      return;
    }
    const s = document.createElement("script");
    s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    s.async = true;
    s.defer = true;
    s.dataset.gcapRecaptcha = "1";
    s.onload = () => window.grecaptcha.ready(() => resolve(window.grecaptcha));
    s.onerror = () => reject(new Error("Could not load reCAPTCHA"));
    document.head.appendChild(s);
  });
  return grecaptchaReady;
}

async function getRecaptchaToken(action) {
  if (!portalConfig.enabled || !portalConfig.siteKey) return null;
  try {
    const g = await ensureGrecaptcha(portalConfig.siteKey);
    if (!g?.execute) throw new Error("reCAPTCHA failed to load");
    const token = await g.execute(portalConfig.siteKey, { action });
    if (!token) throw new Error("reCAPTCHA verification required");
    return token;
  } catch (err) {
    throw new Error(err?.message || "reCAPTCHA verification failed");
  }
}

function setTab(tab) {
  const tabs = document.getElementById("tabs");
  if (!tabs) return;
  tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  app.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
}

/** Compact SVG bar chart — no external libs. */
function barChart(series, key, { color = "#2563eb", empty = "No data yet" } = {}) {
  const values = (series || []).map((row) => Number(row[key] || 0));
  const max = Math.max(1, ...values);
  const w = 560;
  const h = 160;
  const padX = 8;
  const padTop = 12;
  const padBot = 28;
  const n = Math.max(1, values.length);
  const gap = 4;
  const barW = Math.max(4, (w - padX * 2 - gap * (n - 1)) / n);

  if (!values.some((v) => v > 0)) {
    return `<div class="acct-chart-empty">${esc(empty)}</div>`;
  }

  const bars = values
    .map((v, i) => {
      const x = padX + i * (barW + gap);
      const bh = Math.max(v > 0 ? 3 : 0, ((h - padTop - padBot) * v) / max);
      const y = h - padBot - bh;
      const label = series[i]?.day ? dayLabel(series[i].day) : "";
      const showLabel = i === 0 || i === n - 1 || i === Math.floor(n / 2);
      return `<g>
        <rect class="acct-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${color}">
          <title>${esc(label)}: ${v}</title>
        </rect>
        ${showLabel ? `<text x="${(x + barW / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle" class="acct-chart-label">${esc(label)}</text>` : ""}
      </g>`;
    })
    .join("");

  return `<svg class="acct-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Usage chart">${bars}</svg>`;
}

function donutChart(segments) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) return `<div class="acct-chart-empty">No status data yet</div>`;
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const colors = ["#16a34a", "#2563eb", "#f59e0b", "#ef4444", "#64748b", "#7c3aed"];
  const arcs = segments
    .map((seg, i) => {
      const len = (seg.value / total) * c;
      const stroke = colors[i % colors.length];
      const el = `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${stroke}" stroke-width="14"
        stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 50 50)"><title>${esc(seg.label)}: ${seg.value}</title></circle>`;
      offset += len;
      return el;
    })
    .join("");
  const legend = segments
    .map(
      (seg, i) =>
        `<li><span class="acct-dot" style="background:${colors[i % colors.length]}"></span>${esc(seg.label)} <em>${seg.value}</em></li>`,
    )
    .join("");
  return `<div class="acct-donut-wrap">
    <svg class="acct-donut" viewBox="0 0 100 100" aria-hidden="true">${arcs}</svg>
    <ul class="acct-donut-legend">${legend}</ul>
  </div>`;
}

function portalContactEmail() {
  return portalConfig.contactEmail || "info@getcarapi.com";
}

function portalClosedHtml(mode) {
  const email = portalContactEmail();
  if (mode === "register") {
    return `<div class="acct-gate-closed acct-gate-key-notice" role="status">
      <p><strong>Self-registration is currently closed.</strong> Use <strong>Request access</strong> to leave your details, or email <a href="mailto:${esc(email)}">${esc(email)}</a>.</p>
    </div>`;
  }
  const lead = "Client portal sign-in is currently closed.";
  return `<div class="acct-gate-closed" role="status">
    <p>${esc(lead)} Use <strong>Request access</strong> to leave your details, or contact <a href="mailto:${esc(email)}">${esc(email)}</a>.</p>
  </div>`;
}

const FIELD_ICON = {
  name: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 10.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.75 16.5v-.55c0-2.1 2.35-3.2 5.25-3.2s5.25 1.1 5.25 3.2v.55" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  email: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3.5 6.25 10 11l6.5-4.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="3.5" y="5" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
  password: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="4.5" y="9" width="11" height="7.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 9V6.75a3 3 0 1 1 6 0V9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  telegram: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3.4 9.7 15.8 4.6c.55-.22 1.07.33.86.9L13.4 16c-.15.45-.7.52-1 .12l-2.75-3.55-2.2 1.85c-.28.24-.7.08-.78-.28L5.9 9.9l-2.2-.35c-.55-.09-.62-.85-.3-1.05Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  website: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 10h13M10 3.5c1.8 2 2.8 4.2 2.8 6.5S11.8 14.5 10 16.5C8.2 14.5 7.2 12.3 7.2 10S8.2 5.5 10 3.5Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
};

function authField({ name, label, type, icon, autocomplete, minlength, placeholder, required = true, optionalHint = false }) {
  return `<label class="acct-field">
    <span class="acct-field-label">${esc(label)}${optionalHint ? ` <em class="acct-field-opt">optional</em>` : ""}</span>
    <span class="acct-field-wrap">
      <span class="acct-field-icon">${FIELD_ICON[icon] || ""}</span>
      <input name="${esc(name)}" type="${esc(type)}" ${required ? "required" : ""} autocomplete="${esc(autocomplete)}"${
        minlength ? ` minlength="${minlength}"` : ""
      }${type === "email" ? ' inputmode="email"' : ""}${type === "url" ? ' inputmode="url"' : ""} placeholder="${esc(placeholder)}" />
    </span>
  </label>`;
}

function authAsideHtml() {
  return `<aside class="login-aside acct-gate-aside">
    <div class="acct-gate-aside-top">
      <p class="kicker">GetCarAPI</p>
      <h2>Your API command center</h2>
      <p class="acct-gate-aside-lede">Manage tokens, monitor usage, and top up VIN history credits — all in one place.</p>
      <ul class="acct-gate-perks">
        <li><span class="acct-gate-perk-ico" aria-hidden="true">✓</span><span><strong>Test key</strong> auto-issued for 5 free VINs</span></li>
        <li><span class="acct-gate-perk-ico" aria-hidden="true">✓</span><span><strong>$2</strong> per production history retrieve</span></li>
        <li><span class="acct-gate-perk-ico" aria-hidden="true">✓</span><span><strong>Production key</strong> unlocks all VINs + live feed</span></li>
      </ul>
    </div>
    <div class="acct-gate-aside-foot">
      <span class="acct-gate-aside-label">Quick start</span>
      <code>Authorization: Bearer vdi_…</code>
    </div>
  </aside>`;
}

function authTabsHtml(mode) {
  const loginOpen = portalConfig.loginEnabled !== false;
  const registerOpen = portalConfig.registrationEnabled !== false;
  const showLogin = loginOpen || mode === "login";
  const showRegister = registerOpen;
  const showRequest = true;
  return `<div class="acct-gate-tabs" role="tablist" aria-label="Account access">
    ${
      showLogin
        ? `<button type="button" role="tab" class="acct-gate-tab${mode === "login" ? " is-active" : ""}" data-mode="login" aria-selected="${
            mode === "login" ? "true" : "false"
          }">Sign in</button>`
        : ""
    }
    ${
      showRequest
        ? `<button type="button" role="tab" class="acct-gate-tab${mode === "request" ? " is-active" : ""}" data-mode="request" aria-selected="${
            mode === "request" ? "true" : "false"
          }">Request access</button>`
        : ""
    }
    ${
      showRegister
        ? `<button type="button" role="tab" class="acct-gate-tab${mode === "register" ? " is-active" : ""}" data-mode="register" aria-selected="${
            mode === "register" ? "true" : "false"
          }">Create account</button>`
        : ""
    }
  </div>`;
}

function authHeadline(mode) {
  if (mode === "request") {
    return {
      title: "Request access",
      lede: "Leave your details — we’ll follow up about live feed or API access, and send you offers based on your usage.",
    };
  }
  if (mode === "register") {
    return { title: "Create your account", lede: "Get an API token for VIN check, history retrieve, and live stock." };
  }
  return { title: "Welcome back", lede: "Sign in to view tokens, usage, and credits." };
}

function accessRequestFormHtml({ error, notice, success }) {
  if (success) {
    return `<div class="acct-request-success" role="status">
      <div class="acct-request-success-ico" aria-hidden="true">✓</div>
      <h2>Request received</h2>
      <p>${esc(success)}</p>
      <button type="button" class="btn btn-primary btn-wide" id="acct-request-again">Send another</button>
    </div>`;
  }
  return `
    ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ""}
    ${notice ? `<p class="form-notice" role="status">${esc(notice)}</p>` : ""}
    <form id="access-request-form" class="acct-gate-form acct-request-form" autocomplete="on">
      ${authField({
        name: "email",
        label: "Email",
        type: "email",
        icon: "email",
        autocomplete: "email",
        placeholder: "you@company.com",
      })}
      <div class="acct-request-row">
        ${authField({
          name: "telegramUsername",
          label: "Telegram",
          type: "text",
          icon: "telegram",
          autocomplete: "username",
          placeholder: "@username",
          required: false,
          optionalHint: true,
        })}
        ${authField({
          name: "websiteUrl",
          label: "Website",
          type: "text",
          icon: "website",
          autocomplete: "url",
          placeholder: "https://yoursite.com",
          required: false,
          optionalHint: true,
        })}
      </div>
      <label class="acct-field">
        <span class="acct-field-label">Service</span>
        <span class="acct-field-wrap acct-field-select-wrap">
          <select name="serviceInterest" required>
            <option value="" disabled selected>Choose one…</option>
            <option value="live_feed">Live feed — Korean stock streaming</option>
            <option value="vin_api">API token — VIN reports &amp; auctions</option>
            <option value="both">Both — live feed + API</option>
          </select>
        </span>
      </label>
      <label class="acct-field">
        <span class="acct-field-label">Message</span>
        <textarea name="message" required minlength="10" maxlength="4000" rows="3" placeholder="Use case, volume, timeline…"></textarea>
      </label>
      <button class="btn btn-primary btn-wide acct-gate-submit" type="submit" id="access-request-btn">
        <span>Submit request</span>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M4 10h11M11 6l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </form>
    ${portalConfig.enabled ? `<p class="sub acct-gate-cap"><span class="acct-gate-cap-ico" aria-hidden="true">🛡</span> Protected by reCAPTCHA</p>` : ""}
  `;
}

function bindAccessRequestForm() {
  const again = document.getElementById("acct-request-again");
  if (again) {
    again.addEventListener("click", () => authView("request"));
    return;
  }
  const form = document.getElementById("access-request-form");
  const btn = document.getElementById("access-request-btn");
  if (!form || !btn) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    btn.disabled = true;
    btn.querySelector("span").textContent = "Sending…";
    const data = new FormData(event.target);
    try {
      const recaptchaToken = await getRecaptchaToken("access_request");
      const body = await api("/client/access-request", {
        method: "POST",
        body: JSON.stringify({
          email: data.get("email"),
          telegramUsername: data.get("telegramUsername"),
          websiteUrl: data.get("websiteUrl"),
          serviceInterest: data.get("serviceInterest"),
          message: data.get("message"),
          recaptchaToken,
        }),
      });
      authView("request", undefined, {
        success: body.message || "Thanks — we received your details and will contact you shortly.",
      });
    } catch (err) {
      authView("request", err.message);
    }
  });
}

function authShell({ mode, error, notice, success, closed = false }) {
  const isRegister = mode === "register";
  const isRequest = mode === "request";
  const loginOpen = portalConfig.loginEnabled !== false;
  const registerOpen = portalConfig.registrationEnabled !== false;
  const isClosed = closed || (isRegister ? !registerOpen : !isRequest && !loginOpen);
  const { title, lede } = authHeadline(mode);

  document.body.classList.add("acct-auth-view");
  app.classList.add("acct-auth-page");

  const cardInner = isRequest
    ? accessRequestFormHtml({ error, notice, success })
    : `${isClosed ? portalClosedHtml(mode) : ""}
            ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ""}
            ${notice && !isClosed ? `<p class="form-notice" role="status">${esc(notice)}</p>` : ""}
            ${
              isClosed
                ? `<p class="acct-gate-contact-note">Use <strong>Request access</strong> above to send your details — we’ll get back to you.</p>`
                : `<form id="auth-form" class="acct-gate-form" autocomplete="on">
              ${
                isRegister
                  ? authField({
                      name: "name",
                      label: "Name",
                      type: "text",
                      icon: "name",
                      autocomplete: "name",
                      minlength: 2,
                      placeholder: "Company or your name",
                    })
                  : ""
              }
              ${authField({
                name: "email",
                label: "Email",
                type: "email",
                icon: "email",
                autocomplete: isRegister ? "username" : "username",
                placeholder: "you@company.com",
              })}
              ${authField({
                name: "password",
                label: "Password",
                type: "password",
                icon: "password",
                autocomplete: isRegister ? "new-password" : "current-password",
                minlength: isRegister ? 6 : 1,
                placeholder: isRegister ? "At least 6 characters" : "Your password",
              })}
              <button class="btn btn-primary btn-wide acct-gate-submit" type="submit" id="auth-btn">
                <span>${isRegister ? "Create account" : "Sign in"}</span>
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M4 10h11M11 6l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </form>`
            }
            ${!isClosed && portalConfig.enabled ? `<p class="sub acct-gate-cap"><span class="acct-gate-cap-ico" aria-hidden="true">🛡</span> Protected by reCAPTCHA</p>` : ""}`;

  app.innerHTML = `<div class="acct-gate fade-in">
      <div class="login-split acct-gate-split">
        ${authAsideHtml()}
        <div class="acct-gate-main">
          ${authTabsHtml(mode)}
          <div class="acct-gate-card">
            <div class="acct-gate-head">
              <h1>${esc(title)}</h1>
              <p>${esc(lede)}</p>
            </div>
            ${cardInner}
          </div>
        </div>
      </div>
    </div>`;

  document.querySelectorAll(".acct-gate-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const next = tab.dataset.mode;
      if (next && next !== mode) authView(next);
    });
  });

  if (isRequest) {
    bindAccessRequestForm();
    return;
  }

  if (isClosed) return;

  const form = document.getElementById("auth-form");
  const btn = document.getElementById("auth-btn");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    btn.disabled = true;
    btn.querySelector("span").textContent = isRegister ? "Creating…" : "Signing in…";
    const data = new FormData(event.target);
    try {
      const recaptchaToken = await getRecaptchaToken(isRegister ? "register" : "login");
      const payload = {
        email: data.get("email"),
        password: data.get("password"),
        recaptchaToken,
      };
      let user;
      if (isRegister) {
        payload.name = data.get("name");
        user = await api("/client/auth/register", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else {
        user = await api("/client/auth/login", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      notifySiteAuth(user?.name);
      if (isRegister && user?.testToken?.value && user?.id) {
        saveStoredTestToken(user.id, user.testToken.value);
      }
      document.body.classList.remove("acct-auth-view");
      app.classList.remove("acct-auth-page");
      if (consumeNextRedirect()) return;
      await dashboard();
    } catch (err) {
      authView(mode, err.message);
    }
  });
}

function notifySiteAuth(name) {
  window.dispatchEvent(
    new CustomEvent("site-auth-changed", {
      detail: name ? { authenticated: true, name } : { authenticated: false },
    }),
  );
}

function authView(mode = "login", error, opts = {}) {
  if (mode === "request") {
    authShell({ mode: "request", error, ...opts });
    return;
  }
  if (mode === "register" && portalConfig.registrationEnabled === false) {
    authShell({ mode: "request", error, notice: "Self-registration is closed — leave your details and we’ll contact you.", ...opts });
    return;
  }
  if (mode === "login" && portalConfig.loginEnabled === false) {
    authShell({ mode: "login", error, closed: true, ...opts });
    return;
  }
  authShell({ mode, error, ...opts });
}

function wantsApiAccess() {
  const params = new URLSearchParams(location.search);
  return params.has("key") || params.has("register");
}

/** Same-origin relative redirect after login (e.g. /docs). Rejects open redirects. */
function consumeNextRedirect() {
  const params = new URLSearchParams(location.search);
  const next = params.get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("://")) return false;
  if (next !== "/docs" && !next.startsWith("/docs?")) return false;
  location.replace(next);
  return true;
}

/** Curated test VINs — kept in sync with api-server/src/lib/test-vins.ts */
const DEFAULT_TEST_VINS = [
  {
    vin: "1C4PJLAB8HW652533",
    region: "usa",
    label: "Jeep Cherokee 2017",
    market: "copart",
    description: "US salvage auction — 100+ photos, auction timeline",
  },
  {
    vin: "3GTUUBED2TG205512",
    region: "canada",
    label: "GMC Sierra 1500 2026",
    market: "autotraderca",
    description: "Canadian retail listing — photos, price & mileage observations",
  },
  {
    vin: "WDDWF0EB8GR178219",
    region: "korea",
    label: "Mercedes-Benz C-Class 2016",
    market: "encar",
    description: "Korean Encar — insurance & owner history, 80+ events, gallery",
  },
  {
    vin: "WP1AF2928GLA45746",
    region: "korea",
    label: "Porsche Cayenne 2016",
    market: "encar",
    description: "Korean Encar — accident timeline, 70 events, photos",
  },
  {
    vin: "KMHE341DBJA456079",
    region: "korea",
    label: "Hyundai Sonata 2018",
    market: "autowini",
    description: "Korean export listing — events, photos, mileage history",
  },
];

function resolveTestVins(dash) {
  const fromApi = dash?.testVins;
  return fromApi?.length ? fromApi : DEFAULT_TEST_VINS;
}

function regionLabel(region) {
  if (region === "usa") return "USA";
  if (region === "canada") return "Canada";
  if (region === "korea") return "Korea";
  return region || "";
}

function sampleTestVin(testVins) {
  return testVins?.[0]?.vin || DEFAULT_TEST_VINS[0].vin;
}

function testTokenStorageKey(clientId) {
  return `gca_test_token_${clientId}`;
}

function loadStoredTestToken(clientId) {
  if (!clientId) return "";
  try {
    return localStorage.getItem(testTokenStorageKey(clientId)) || "";
  } catch {
    return "";
  }
}

function saveStoredTestToken(clientId, value) {
  if (!clientId || !value) return;
  try {
    localStorage.setItem(testTokenStorageKey(clientId), value);
  } catch {
    /* ignore */
  }
}

function bearerExample(tokenValue, fallback = "vdi_your_token_here") {
  return `Authorization: Bearer ${tokenValue || fallback}`;
}

function tokenKindChip(isTestOnly) {
  return isTestOnly
    ? `<span class="chip chip-test">Test</span>`
    : `<span class="chip chip-production">Production</span>`;
}

function tokensPanel(dash, storedTestToken) {
  const tokens = (dash.tokens ?? []).filter((t) => t.isActive);
  const testTokens = tokens.filter((t) => t.isTestOnly);
  const prodTokens = tokens.filter((t) => !t.isTestOnly);
  const testMeta = testTokens[0];
  const hasSecret = Boolean(storedTestToken);
  const masked = storedTestToken
    ? `${storedTestToken.slice(0, 12)}…${storedTestToken.slice(-4)}`
    : testMeta
      ? `${testMeta.tokenPrefix}…`
      : "";

  const testBlock = testMeta
    ? `<article class="token-card token-card--test">
        <div class="token-card-head">
          <div>
            <strong>${esc(testMeta.name || "Test key")}</strong>
            ${tokenKindChip(true)}
          </div>
          <p class="sub token-card-lede">Works only with the ${DEFAULT_TEST_VINS.length} curated test VINs — no credits, no live feed, no production VINs.</p>
        </div>
        ${
          hasSecret
            ? `<div class="token-secret-box">
                <code id="test-token-value" class="mono token-secret" hidden>${esc(storedTestToken)}</code>
                <code id="test-token-mask" class="mono token-secret">${esc(masked)}</code>
                <div class="token-secret-actions">
                  <button type="button" class="btn btn-ghost btn-sm" id="toggle-test-token">Show key</button>
                  <button type="button" class="btn btn-ghost btn-sm" id="copy-test-token">Copy</button>
                  <button type="button" class="btn btn-ghost btn-sm" id="regen-test-token">Regenerate</button>
                </div>
              </div>`
            : `<div class="token-secret-box token-secret-box--missing">
                <p class="sub">Prefix <span class="mono">${esc(testMeta.tokenPrefix)}…</span> — full secret was shown once at signup.</p>
                <button type="button" class="btn btn-primary btn-sm" id="regen-test-token">Generate new test key</button>
              </div>`
        }
        <div class="token-meta">
          <span class="chip chip-free">Test VINs only</span>
          <small>Last used ${when(testMeta.lastUsedAt)}</small>
        </div>
      </article>`
    : "";

  const prodBlock =
    prodTokens.length > 0
      ? prodTokens
          .map(
            (token) => `<article class="token-card token-card--production">
              <div class="token-card-head">
                <div>
                  <strong>${esc(token.name)}</strong>
                  ${tokenKindChip(false)}
                </div>
              </div>
              <div class="mono token-prefix">${esc(token.tokenPrefix)}…</div>
              <div class="token-meta">
                <span class="chip">Active</span>
                <small>Last used ${when(token.lastUsedAt)}</small>
              </div>
            </article>`,
          )
          .join("")
      : `<article class="token-card token-card--production token-card--empty">
          <div class="token-card-head">
            <strong>Production key</strong>
            ${tokenKindChip(false)}
          </div>
          <p class="sub">Unlock all VINs, live feed, and paid retrieves. <a href="/account/?key=1">Request a production key</a>.</p>
        </article>`;

  return `<div class="token-stack">
    <div class="token-stack-section">
      <h3 class="token-stack-title">Test key</h3>
      ${testBlock || `<p class="sub">Loading test key…</p>`}
    </div>
    <div class="token-stack-section">
      <h3 class="token-stack-title">Production keys</h3>
      <div class="token-list">${prodBlock}</div>
    </div>
  </div>`;
}

function testVinsPanel(testVins, { expanded = false, bearerToken = "" } = {}) {
  if (!testVins?.length) return "";
  const rows = testVins
    .map((t) => {
      const curl = expanded
        ? `<pre class="test-vin-curl">curl -H "${esc(bearerExample(bearerToken))}" \\
  https://getcarapi.com/api/v1/vin/${esc(t.vin)}</pre>`
        : "";
      return `<article class="test-vin-card">
        <div class="acct-row-head">
          <strong>${esc(t.label)}</strong>
          <span class="chip chip-free">Free · no credit</span>
        </div>
        <p class="sub">
          <span class="chip test-vin-region">${esc(regionLabel(t.region))}</span>
          ${esc(t.description || "")} · <span class="mono">${esc(t.market)}</span>
        </p>
        <div class="test-vin-row">
          <code class="mono">${esc(t.vin)}</code>
          <button type="button" class="linkish" data-copy-vin="${esc(t.vin)}">Copy</button>
        </div>
        ${curl}
      </article>`;
    })
    .join("");
  return `
    <article class="acct-surface${expanded ? "" : ""}" style="margin-bottom:1rem">
      <div class="acct-row-head">
        <h2>Test VINs</h2>
        <span class="chip chip-free">Always free</span>
      </div>
      <p class="sub">Use your normal Bearer token. Works at <strong>zero balance</strong> — no credits deducted. Check is free; retrieve returns full history with <code>meta.creditCharged: 0</code>.</p>
      <div class="test-vin-grid">${rows}</div>
      ${
        expanded
          ? `<p class="sub" style="margin-top:.85rem">Also: <code>GET /api/v1/test-vins</code> (Bearer) · <code>GET /api/v1/vin/check/{vin}</code> (free, no credit)</p>`
          : ""
      }
    </article>`;
}

function testVinsCallout(testVins) {
  const list = testVins
    .map(
      (t) =>
        `<li><button type="button" class="linkish mono" data-copy-vin="${esc(t.vin)}">${esc(t.vin)}</button> · ${esc(t.label)} <span class="chip test-vin-region">${esc(regionLabel(t.region))}</span></li>`,
    )
    .join("");
  return `
    <article class="acct-surface" style="margin-bottom:1rem">
      <div class="acct-row-head">
        <h2>Free test VINs</h2>
        <span class="chip chip-free">${testVins.length} VINs · no credit</span>
      </div>
      <p class="sub">Integrate without spending credits — same Bearer header as production.</p>
      <ul class="test-vin-list">${list}</ul>
      <p class="sub" style="margin-top:.75rem">
        <button type="button" class="linkish" data-goto="testvins">Open test VINs</button>
        · copy &amp; curl examples
      </p>
    </article>`;
}

function docsPanel(dash) {
  const price = dash.billing?.creditPriceUsd ?? 2;
  const live = dash.liveFeed ?? {};
  const liveActive = Boolean(live.active);
  const contact = live.contactEmail || "info@getcarapi.com";
  const testVins = resolveTestVins(dash);
  const sampleVin = sampleTestVin(testVins);
  return `
    <div class="acct-docs">
      <article class="acct-surface">
        <h2>Auth header</h2>
        <p class="sub">Your <strong>test key</strong> works immediately on curated test VINs. Production keys unlock all VINs and live feed.</p>
        <pre>${esc(bearerExample(loadStoredTestToken(dash.client?.id)))}</pre>
        <p class="sub acct-links"><a href="/api/">Overview</a> · <a href="/api/authentication">Authentication</a> · <a href="/docs">OpenAPI</a></p>
      </article>
      <article class="acct-surface">
        <div class="acct-row-head"><h2>Car history</h2><span class="chip">Credits</span></div>
        <div class="acct-ep">
          <div class="acct-ep-meta"><code>GET /api/v1/vin/check/{vin}</code><span class="chip chip-free">Free</span></div>
          <pre>curl -H "Authorization: Bearer vdi_…" \\
  https://getcarapi.com/api/v1/vin/check/${esc(sampleVin)}</pre>
        </div>
        <div class="acct-ep">
          <div class="acct-ep-meta"><code>GET /api/v1/vin/{vin}</code><span class="chip">$${esc(price)} / 1 credit</span></div>
          <pre>curl -H "Authorization: Bearer vdi_…" \\
  https://getcarapi.com/api/v1/vin/${esc(sampleVin)}</pre>
          <p class="sub">Test VINs below are always free (0 credits). <code>meta.creditCharged</code> is <code>0</code> and <code>meta.testVin</code> is <code>true</code>.</p>
        </div>
      </article>
      ${testVinsPanel(testVins, { expanded: false })}
      <article class="acct-surface">
        <div class="acct-row-head">
          <h2>Live stock</h2>
          <span class="chip ${liveActive ? "chip-free" : ""}">${liveActive ? "Enabled · no credit" : "Disabled"}</span>
        </div>
        <p class="sub">${esc(live.message || "")}</p>
        ${
          liveActive
            ? `<div class="acct-ep">
          <div class="acct-ep-meta"><code>GET /api/v1/live/vehicles</code><span class="chip chip-free">Unlimited</span></div>
          <pre>curl -H "Authorization: Bearer vdi_…" \\
  "https://getcarapi.com/api/v1/live/vehicles?provider=all&limit=20"</pre>
        </div>
        <div class="acct-ep">
          <div class="acct-ep-meta"><code>GET /api/v1/live/vehicles/{id}</code></div>
          <pre>curl -H "Authorization: Bearer vdi_…" \\
  "https://getcarapi.com/api/v1/live/vehicles/12345?provider=encar"</pre>
        </div>
        ${live.expiresAt ? `<p class="sub">Access until ${esc(new Date(live.expiresAt).toLocaleString())}</p>` : `<p class="sub">No expiry set (open while enabled).</p>`}`
            : `<p class="sub">Contact <a href="mailto:${esc(contact)}">${esc(contact)}</a> for pricing, providers, and access details.</p>`
        }
      </article>
    </div>`;
}

const USDT_WALLET = "0xf65fB66400C6F5e256f50b8C913026B6C2Ce56bF";
const DEFAULT_CRYPTO_METHODS = [
  {
    id: "USDT_ETH",
    label: "USDT · Ethereum",
    network: "ERC-20",
    qrPath: "/assets/payments/usdt-ethereum.jpg",
  },
  {
    id: "USDT_BNB",
    label: "USDT · BNB Chain",
    network: "BEP-20",
    qrPath: "/assets/payments/usdt-bnb.jpg",
  },
];

function resolveCryptoMethods(billing) {
  const fromApi = billing?.cryptoMethods;
  if (Array.isArray(fromApi) && fromApi.length) return fromApi;
  return DEFAULT_CRYPTO_METHODS.map((m) => ({ ...m, walletAddress: billing?.walletAddress || USDT_WALLET }));
}

function minValidDepositUsd(minUsd, price) {
  const p = price > 0 ? price : 2;
  let n = Math.ceil(minUsd / p) * p;
  if (n < minUsd) n += p;
  return n;
}

function validateDepositAmount(usd, minUsd, price) {
  const p = price > 0 ? price : 2;
  if (!Number.isFinite(usd)) return { ok: false, error: "Enter a valid amount." };
  if (usd !== Math.floor(usd)) {
    return { ok: false, error: "Whole dollars only — no cents (e.g. $40, not $40.50)." };
  }
  if (usd < minUsd) return { ok: false, error: `Minimum deposit is $${Math.floor(minUsd)}.` };
  if (usd % p !== 0) {
    return {
      ok: false,
      error: `Must divide evenly into $${p} credits — e.g. $24 = 12 retrieves; $25 does not work.`,
    };
  }
  return { ok: true, credits: usd / p };
}

function creditsBuyHtml(billing) {
  const price = billing.creditPriceUsd ?? 2;
  const minUsd = billing.minCryptoDepositUsd ?? 40;
  const minValid = minValidDepositUsd(minUsd, price);
  const methods = resolveCryptoMethods(billing);
  const wallet = billing.walletAddress || USDT_WALLET;
  const defaultCredits = minValid / price;
  const netCards = methods
    .map((m) => {
      const badge = m.id === "USDT_BNB" ? "BNB" : "ETH";
      const badgeClass = m.id === "USDT_BNB" ? "buy-net-badge--bnb" : "buy-net-badge--eth";
      return `<button type="button" class="buy-net-card" data-network="${esc(m.id)}" data-network-label="${esc(m.label)}">
        <span class="buy-net-badge ${badgeClass}">${esc(badge)}</span>
        <span class="buy-net-copy">
          <strong>${esc(m.label)}</strong>
          <span>${esc(m.network)} · same wallet on both chains</span>
        </span>
        <span class="buy-net-arrow" aria-hidden="true">→</span>
      </button>`;
    })
    .join("");
  return `
    <div id="buy-wizard" class="buy-wizard">
      <div class="buy-panel-intro">
        <p class="buy-kicker">USDT checkout</p>
        <p class="buy-lede">$${esc(price)} per VIN retrieve · $${esc(minValid)} minimum · whole dollars only (no cents)</p>
        <p class="buy-wallet-hint mono">${esc(wallet)}</p>
      </div>
      <nav class="buy-progress" aria-label="Checkout steps">
        <span class="buy-progress-item is-on" data-step-mark="1"><i>1</i> Network</span>
        <span class="buy-progress-item" data-step-mark="2"><i>2</i> Amount</span>
        <span class="buy-progress-item" data-step-mark="3"><i>3</i> Pay</span>
        <span class="buy-progress-item" data-step-mark="4"><i>4</i> Proof</span>
      </nav>
      <div data-buy-step="1">
        <h3 class="buy-step-title">Choose USDT network</h3>
        <div class="buy-networks">${netCards}</div>
      </div>
      <div data-buy-step="2" hidden>
        <h3 class="buy-step-title">Deposit amount</h3>
        <p class="buy-selected-net sub" id="buy-selected-net"></p>
        <div class="buy-amount-note">
          <p><strong>Whole dollars only.</strong> Your USDT payment must match an exact number of credits at $${esc(price)} each.</p>
          <ul class="buy-amount-examples">
            <li><strong>$${esc(minValid)}</strong> → ${defaultCredits} retrieves</li>
            <li><strong>$24</strong> → 12 retrieves</li>
            <li><strong>$25</strong> → invalid (not divisible by $${esc(price)})</li>
          </ul>
        </div>
        <form id="buy-amount-form" class="acct-form buy-amount-form">
          <input type="hidden" name="cryptoCurrency" id="buy-network" />
          <label class="buy-amount-field">
            <span>USD amount</span>
            <div class="buy-amount-input">
              <span class="buy-amount-prefix">$</span>
              <input name="amountUsd" type="number" min="${minValid}" step="${price}" value="${minValid}" inputmode="numeric" required />
            </div>
          </label>
          <p class="buy-credits-preview" id="buy-credits-preview">${defaultCredits} VIN retrieves · $${esc(minValid)} USDT</p>
          <div class="buy-actions">
            <button class="btn btn-primary" type="submit">Continue to payment</button>
            <button type="button" class="btn btn-ghost btn-sm buy-back" data-buy-back>Back</button>
          </div>
        </form>
      </div>
      <div data-buy-step="3" hidden>
        <h3 class="buy-step-title">Send USDT now</h3>
        <div id="buy-payment-details"></div>
        <div class="buy-actions">
          <button type="button" class="btn btn-primary" data-buy-to-proof>I paid — submit proof</button>
          <button type="button" class="btn btn-ghost btn-sm buy-back" data-buy-back>Back</button>
        </div>
      </div>
      <div data-buy-step="4" hidden>
        <h3 class="buy-step-title">Submit payment proof</h3>
        <p class="sub">Upload your transaction hash and/or a wallet screenshot. We verify manually, then credits appear in your balance.</p>
        <form id="buy-proof-form" class="acct-form buy-proof-form">
          <input type="hidden" name="purchaseId" id="buy-purchase-id" />
          <label><span>Transaction hash</span><input name="txHash" type="text" autocomplete="off" placeholder="0x… or BSC hash" /></label>
          <label class="buy-file-field"><span>Payment screenshot (JPEG/PNG)</span><input name="proofFile" type="file" accept="image/jpeg,image/png" /></label>
          <label><span>Note (optional)</span><input name="payerNote" type="text" maxlength="500" placeholder="Wallet name, exchange, etc." /></label>
          <button class="btn btn-primary" type="submit">Submit for verification</button>
        </form>
      </div>
      <p id="buy-msg" class="buy-msg" role="status"></p>
    </div>`;
}

function paymentDetailsHtml(payment) {
  return `
    <div class="buy-pay-grid">
      <div class="buy-pay-qr-wrap">
        <img src="${esc(payment.qrPath)}" alt="USDT payment QR code" class="buy-qr" width="240" height="240" loading="lazy" />
        <p class="sub">Scan in MetaMask, Trust Wallet, Binance, etc.</p>
      </div>
      <div class="buy-pay-meta">
        <p class="buy-pay-network">${esc(payment.label)}</p>
        <p class="buy-pay-amount">$${esc(payment.amountUsd)} <span>USDT</span></p>
        <p class="buy-pay-credits">${esc(payment.credits)} VIN retrieves · $${esc(payment.creditPriceUsd ?? 2)}/credit</p>
        <p class="sub">Send the exact amount — whole dollars, no cents.</p>
        <div class="buy-wallet-row">
          <code class="mono buy-wallet">${esc(payment.walletAddress)}</code>
          <button type="button" class="btn btn-ghost btn-sm" data-copy-wallet>Copy</button>
        </div>
      </div>
    </div>`;
}

function showBuyStep(step) {
  document.querySelectorAll("[data-buy-step]").forEach((el) => {
    el.hidden = Number(el.dataset.buyStep) !== step;
  });
  document.querySelectorAll("[data-step-mark]").forEach((el) => {
    const n = Number(el.dataset.stepMark);
    el.classList.toggle("is-on", n === step);
    el.classList.toggle("is-done", n < step);
  });
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function wireCreditsBuy(billing) {
  const wizard = document.getElementById("buy-wizard");
  if (!wizard) return;

  const price = billing.creditPriceUsd ?? 2;
  const minUsd = billing.minCryptoDepositUsd ?? 40;
  const minValid = minValidDepositUsd(minUsd, price);
  let pendingPurchase = null;

  const msg = document.getElementById("buy-msg");
  const amountInput = wizard.querySelector('input[name="amountUsd"]');
  const preview = document.getElementById("buy-credits-preview");

  const updatePreview = () => {
    const usd = Number(amountInput?.value);
    if (!preview) return;
    preview.classList.remove("buy-preview-err");
    const check = validateDepositAmount(usd, minUsd, price);
    if (!check.ok) {
      preview.textContent = check.error;
      preview.classList.add("buy-preview-err");
      return;
    }
    preview.textContent = `${check.credits} VIN retrieves · $${usd} USDT`;
    preview.classList.remove("buy-preview-err");
  };
  amountInput?.addEventListener("input", updatePreview);

  wizard.querySelectorAll("[data-network]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const network = btn.getAttribute("data-network");
      const hidden = document.getElementById("buy-network");
      if (hidden) hidden.value = network ?? "";
      const netLabel = document.getElementById("buy-selected-net");
      if (netLabel) {
        netLabel.textContent = btn.getAttribute("data-network-label")
          ? `Paying via ${btn.getAttribute("data-network-label")}`
          : "";
      }
      showBuyStep(2);
      if (msg) msg.textContent = "";
    });
  });

  wizard.querySelectorAll("[data-buy-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const current = [...wizard.querySelectorAll("[data-buy-step]")].find((el) => !el.hidden);
      const step = current ? Number(current.dataset.buyStep) : 1;
      showBuyStep(Math.max(1, step - 1));
      if (msg) msg.textContent = "";
    });
  });

  document.getElementById("buy-amount-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const amountUsd = Number(fd.get("amountUsd"));
    const cryptoCurrency = fd.get("cryptoCurrency");
    const check = validateDepositAmount(amountUsd, minUsd, price);
    if (!check.ok) {
      if (msg) msg.textContent = check.error;
      return;
    }
    try {
      const res = await api("/client/credits/purchase", {
        method: "POST",
        body: JSON.stringify({ amountUsd, cryptoCurrency }),
      });
      pendingPurchase = res.purchase;
      const details = document.getElementById("buy-payment-details");
      if (details) details.innerHTML = paymentDetailsHtml(res.payment);
      const purchaseId = document.getElementById("buy-purchase-id");
      if (purchaseId && pendingPurchase) purchaseId.value = String(pendingPurchase.id);
      showBuyStep(3);
      if (msg) msg.textContent = "";
      details?.querySelector("[data-copy-wallet]")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(res.payment.walletAddress);
          if (msg) msg.textContent = "Wallet copied.";
        } catch {
          if (msg) msg.textContent = "Copy failed — select the address manually.";
        }
      });
    } catch (err) {
      if (msg) msg.textContent = err.message;
    }
  });

  wizard.querySelector("[data-buy-to-proof]")?.addEventListener("click", () => {
    showBuyStep(4);
    if (msg) msg.textContent = "";
  });

  document.getElementById("buy-proof-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const purchaseId = fd.get("purchaseId");
    const txHash = String(fd.get("txHash") ?? "").trim();
    const payerNote = String(fd.get("payerNote") ?? "").trim();
    const file = fd.get("proofFile");
    let proofImageBase64 = null;
    if (file && file.size > 0) {
      try {
        proofImageBase64 = await fileToBase64(file);
      } catch {
        if (msg) msg.textContent = "Could not read screenshot.";
        return;
      }
    }
    if (!txHash && !proofImageBase64) {
      if (msg) msg.textContent = "Provide a transaction hash and/or screenshot.";
      return;
    }
    try {
      await api(`/client/credits/purchase/${purchaseId}/proof`, {
        method: "POST",
        body: JSON.stringify({
          txHash: txHash || undefined,
          proofImageBase64: proofImageBase64 || undefined,
          payerNote: payerNote || undefined,
        }),
      });
      if (msg) msg.textContent = "Submitted. Credits are added after verification.";
      await dashboard("credits");
    } catch (err) {
      if (msg) msg.textContent = err.message;
    }
  });
}

function dashboardView(dash, logs, ledger, purchases, usageSeries, storedTestToken = "") {
  document.body.classList.remove("acct-auth-view");
  app.classList.remove("acct-auth-page");
  const remaining = dash.limits?.remaining ?? {};
  const usage = dash.usage ?? {};
  const tokens = (dash.tokens ?? []).filter((t) => t.isActive);
  const hasProductionToken = Boolean(dash.client?.hasProductionToken ?? tokens.some((t) => !t.isTestOnly));
  const testBearer = storedTestToken || "";
  const items = logs.items ?? [];
  const billing = dash.billing ?? {};
  const ledgerItems = ledger?.items ?? [];
  const purchaseItems = purchases?.items ?? [];
  const series = usageSeries?.series ?? [];
  const live = dash.liveFeed ?? {};
  const liveActive = Boolean(live.active);
  const liveContact = live.contactEmail || "info@getcarapi.com";
  const testVins = resolveTestVins(dash);
  const statusSegs = (usageSeries?.status ?? [])
    .slice(0, 5)
    .map((s) => ({ label: String(s.statusCode), value: s.count }));
  const totalCalls = series.reduce((s, r) => s + r.total, 0);
  const totalVin = series.reduce((s, r) => s + r.vin, 0);
  const totalLive = series.reduce((s, r) => s + r.live, 0);

  app.innerHTML = `
    <div class="acct fade-in">
      <header class="acct-head">
        <div>
          <p class="kicker">Client portal</p>
          <h1>${esc(dash.client?.name)}</h1>
          <p class="lede">${esc(dash.client?.email)}${
            hasProductionToken ? "" : " · test key active — request production key for all VINs"
          }</p>
        </div>
        <button class="btn btn-ghost" id="logout" type="button">Sign out</button>
      </header>

      <nav class="account-tabs" id="tabs" role="tablist">
        <button type="button" class="on" data-tab="overview" role="tab">Overview</button>
        <button type="button" data-tab="testvins" role="tab">Test VINs</button>
        <button type="button" data-tab="usage" role="tab">Usage</button>
        <button type="button" data-tab="docs" role="tab">API docs</button>
        <button type="button" data-tab="credits" role="tab">Credits</button>
        <button type="button" data-tab="profile" role="tab">Profile</button>
      </nav>

      <section data-panel="overview">
        <div class="acct-kpi">
          <div class="acct-kpi-item accent"><span>Credits</span><strong>${esc(billing.credits ?? 0)}</strong></div>
          <div class="acct-kpi-item"><span>Today</span><strong>${esc(usage.requestsToday ?? 0)}</strong></div>
          <div class="acct-kpi-item"><span>Retrieves (mo)</span><strong>${esc(usage.retrievesThisMonth ?? 0)}</strong></div>
          <div class="acct-kpi-item"><span>Live feed</span><strong>${liveActive ? "On" : "Off"}</strong></div>
        </div>

        <article class="acct-surface" style="margin-bottom:1rem">
          <div class="acct-row-head">
            <h2>Live stock access</h2>
            <span class="chip ${liveActive ? "chip-free" : ""}">${liveActive ? "Enabled · no credits" : "Disabled"}</span>
          </div>
          <p class="sub">${esc(live.message || "")}</p>
          ${
            liveActive
              ? `<p class="sub">${
                  live.expiresAt
                    ? `Open until <strong>${esc(new Date(live.expiresAt).toLocaleString())}</strong>.`
                    : "No expiry — open while enabled."
                } Live calls are unlimited and never use VIN credits.</p>`
              : `<p class="sub">Email <a href="mailto:${esc(liveContact)}">${esc(liveContact)}</a> for pricing, providers, and to enable live feed.</p>`
          }
        </article>

        ${testVinsCallout(testVins)}

        <div class="acct-grid-2">
          <article class="acct-surface">
            <div class="acct-row-head">
              <h2>API calls · 14 days</h2>
              <span class="sub">${esc(totalCalls)} total</span>
            </div>
            ${barChart(series, "total", { color: "#071833" })}
          </article>
          <article class="acct-surface">
            <div class="acct-row-head">
              <h2>VIN vs live</h2>
              <span class="sub">${esc(totalVin)} vin · ${esc(totalLive)} live</span>
            </div>
            <div class="acct-mini-charts">
              <div>
                <p class="acct-chart-cap">VIN retrieve</p>
                ${barChart(series, "vin", { color: "#2563eb", empty: "No VIN retrieves" })}
              </div>
              <div>
                <p class="acct-chart-cap">Live stock</p>
                ${barChart(series, "live", { color: "#0d9488", empty: "No live calls" })}
              </div>
            </div>
          </article>
        </div>

        <div class="acct-grid-2" style="margin-top:1rem">
          <article class="acct-surface token-panel">
            <div class="acct-row-head">
              <h2>API keys</h2>
              <span class="chip chip-test">Test + production</span>
            </div>
            <p class="sub">Your test key is created automatically. Production keys are issued after approval.</p>
            ${tokensPanel(dash, storedTestToken)}
          </article>
          <article class="acct-surface">
            <h2>Quick start</h2>
            <p class="sub">Use your <strong>test key</strong> with the VINs on the Test VINs tab.</p>
            <pre>${esc(bearerExample(testBearer))}</pre>
            <p class="sub" style="margin-top:.85rem">
              <button type="button" class="linkish" data-goto="docs">Open API docs</button>
              · <button type="button" class="linkish" data-goto="testvins">Test VINs</button>
              · $${esc(billing.creditPriceUsd ?? 2)} / credit (production)
            </p>
          </article>
        </div>
      </section>

      <section data-panel="testvins" hidden>${testVinsPanel(testVins, { expanded: true, bearerToken: testBearer })}</section>

      <section data-panel="usage" hidden>
        <div class="acct-grid-2">
          <article class="acct-surface">
            <div class="acct-row-head"><h2>Daily volume</h2><span class="sub">Last ${esc(usageSeries?.days ?? 14)} days</span></div>
            ${barChart(series, "total", { color: "#071833" })}
          </article>
          <article class="acct-surface">
            <div class="acct-row-head"><h2>HTTP status</h2></div>
            ${donutChart(statusSegs)}
          </article>
        </div>
        <div class="acct-grid-2" style="margin-top:1rem">
          <article class="acct-surface">
            <h2>VIN retrieves</h2>
            ${barChart(series, "vin", { color: "#2563eb" })}
          </article>
          <article class="acct-surface">
            <h2>Live calls</h2>
            ${barChart(series, "live", { color: "#0d9488" })}
          </article>
        </div>
        <article class="acct-surface" style="margin-top:1rem">
          <h2>Recent calls</h2>
          <p class="sub">No secrets or payloads.</p>
          <div class="log-list">
            ${
              items.length
                ? items
                    .map(
                      (row) => `<article class="log-card">
                        <div class="log-top"><strong>${esc(row.statusCode)}</strong><span>${when(row.requestedAt)}</span></div>
                        <div class="mono log-path">${esc(row.path)}</div>
                        <div class="log-meta"><span>${esc(row.vin ?? "—")}</span><span>${esc(row.durationMs)} ms</span></div>
                      </article>`,
                    )
                    .join("")
                : `<p class="sub">No calls yet.</p>`
            }
          </div>
        </article>
      </section>

      <section data-panel="docs" hidden>${docsPanel(dash)}</section>

      <section data-panel="credits" hidden>
        <article class="acct-surface buy-panel">
          <div class="acct-row-head">
            <div>
              <h2>Buy credits with USDT</h2>
              <p class="sub">Ethereum (ERC-20) or BNB Chain (BEP-20) · manual verification · credits added after approval</p>
            </div>
            <span class="chip">$${esc(billing.creditPriceUsd ?? 2)}/retrieve</span>
          </div>
          ${creditsBuyHtml(billing)}
        </article>
        <div class="acct-grid-2" style="margin-top:1rem">
            <article class="acct-surface">
              <h2>Purchases</h2>
              <div class="log-list">
                ${
                  purchaseItems.length
                    ? purchaseItems
                        .map(
                          (p) => `<article class="log-card">
                            <div class="log-top"><strong>${esc(p.status)}</strong><span>${when(p.createdAt)}</span></div>
                            <div>${esc(p.credits)} credits · $${esc(p.amountUsd)} · ${esc(p.cryptoCurrency)}</div>
                            <div class="mono log-path">${esc(p.txHash || "no tx")}</div>
                          </article>`,
                        )
                        .join("")
                    : `<p class="sub">No purchases yet.</p>`
                }
              </div>
            </article>
            <article class="acct-surface">
              <h2>Ledger</h2>
              <div class="log-list">
                ${
                  ledgerItems.length
                    ? ledgerItems
                        .map(
                          (row) => `<article class="log-card">
                            <div class="log-top"><strong>${row.delta > 0 ? "+" : ""}${esc(row.delta)}</strong><span>${when(row.createdAt)}</span></div>
                            <div>${esc(row.reason)} · bal ${esc(row.balanceAfter)}</div>
                          </article>`,
                        )
                        .join("")
                    : `<p class="sub">No ledger entries yet.</p>`
                }
              </div>
            </article>
        </div>
      </section>

      <section data-panel="profile" hidden>
        <article class="acct-surface acct-narrow">
          <h2>Profile</h2>
          <form id="profile-form" class="acct-form">
            <label><span>Name</span><input name="name" type="text" required minlength="2" value="${esc(dash.client?.name)}" autocomplete="name" /></label>
            <label><span>Current password</span><input name="currentPassword" type="password" autocomplete="current-password" placeholder="Only to change password" /></label>
            <label><span>New password</span><input name="password" type="password" minlength="6" autocomplete="new-password" /></label>
            <button class="btn btn-primary" type="submit">Save</button>
          </form>
          <p id="profile-msg" class="sub" role="status"></p>
        </article>
        <article class="acct-surface acct-narrow" style="margin-top:1rem">
          <h2>Live feed</h2>
          <p class="sub">${esc(live.message || "")}</p>
          <p class="sub">Status: <strong>${liveActive ? "Enabled" : "Disabled"}</strong>${
            live.expiresAt ? ` · until ${esc(new Date(live.expiresAt).toLocaleString())}` : liveActive ? " · no expiry" : ""
          }</p>
          ${
            !liveActive
              ? `<p class="sub">Contact <a href="mailto:${esc(liveContact)}">${esc(liveContact)}</a> for pricing, details, and providers.</p>`
              : `<p class="sub">Live stock does not use credits and is unlimited while enabled.</p>`
          }
        </article>
      </section>
    </div>`;

  document.getElementById("logout").addEventListener("click", async () => {
    await api("/client/auth/logout", { method: "POST" });
    notifySiteAuth(null);
    authView("login");
  });

  document.getElementById("tabs").querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });
  app.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.getAttribute("data-goto")));
  });

  app.querySelectorAll("[data-copy-vin]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const vin = btn.getAttribute("data-copy-vin");
      if (!vin) return;
      try {
        await navigator.clipboard.writeText(vin);
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = "Copy";
        }, 1500);
      } catch {
        btn.textContent = "Failed";
      }
    });
  });

  wireCreditsBuy(billing);

  const toggleBtn = document.getElementById("toggle-test-token");
  const copyBtn = document.getElementById("copy-test-token");
  const regenBtn = document.getElementById("regen-test-token");
  const secretEl = document.getElementById("test-token-value");
  const maskEl = document.getElementById("test-token-mask");

  toggleBtn?.addEventListener("click", () => {
    if (!secretEl || !maskEl) return;
    const showing = !secretEl.hidden;
    secretEl.hidden = showing;
    maskEl.hidden = !showing;
    toggleBtn.textContent = showing ? "Show key" : "Hide key";
  });

  copyBtn?.addEventListener("click", async () => {
    if (!storedTestToken) return;
    try {
      await navigator.clipboard.writeText(storedTestToken);
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1500);
    } catch {
      copyBtn.textContent = "Failed";
    }
  });

  regenBtn?.addEventListener("click", async () => {
    if (!window.confirm("Issue a new test key? The previous test key will stop working immediately.")) return;
    regenBtn.disabled = true;
    try {
      const body = await api("/client/tokens/test/regenerate", { method: "POST" });
      if (body?.testToken?.value && dash.client?.id) {
        saveStoredTestToken(dash.client.id, body.testToken.value);
      }
      await dashboard("overview");
    } catch (err) {
      alert(err.message || "Could not regenerate test key");
      regenBtn.disabled = false;
    }
  });

  document.getElementById("profile-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const msg = document.getElementById("profile-msg");
    try {
      await api("/client/auth/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: fd.get("name"),
          currentPassword: fd.get("currentPassword") || undefined,
          password: fd.get("password") || undefined,
        }),
      });
      msg.textContent = "Saved.";
      await dashboard("profile");
    } catch (err) {
      msg.textContent = err.message;
    }
  });
}

async function dashboard(tab = "overview") {
  app.innerHTML = `<div class="dash-skel fade-in"><div class="sk-bar"></div><div class="acct-kpi"><div class="acct-kpi-item"></div><div class="acct-kpi-item"></div><div class="acct-kpi-item"></div><div class="acct-kpi-item"></div></div></div>`;
  const [dash, logs, ledger, purchases, usageSeries] = await Promise.all([
    api("/client/dashboard"),
    api("/client/logs?limit=40"),
    api("/client/credits/ledger?limit=30"),
    api("/client/credits/purchases"),
    api("/client/usage/series?days=14").catch(() => ({ series: [], status: [], days: 14 })),
  ]);
  if (dash?.testTokenReveal?.value && dash?.client?.id) {
    saveStoredTestToken(dash.client.id, dash.testTokenReveal.value);
  }
  const storedTestToken = loadStoredTestToken(dash?.client?.id);
  dashboardView(dash, logs, ledger, purchases, usageSeries, storedTestToken);
  if (tab && tab !== "overview") setTab(tab);
}

async function boot() {
  await loadPortalConfig();
  captchaConfig = portalConfig;
  if (portalConfig.enabled && portalConfig.siteKey) {
    ensureGrecaptcha(portalConfig.siteKey).catch(() => {});
  }

  window.addEventListener("portal-access-request", () => {
    authView("request");
  });

  try {
    const me = await api("/client/auth/me");
    notifySiteAuth(me?.name);
    if (consumeNextRedirect()) return;
    await dashboard();
  } catch {
    const wantsAccess = wantsApiAccess();
    if (wantsAccess) {
      authView("request");
      return;
    }
    authView("login");
  }
}

boot();
