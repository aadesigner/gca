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

function apiErrorMessage(body, status) {
  if (typeof body?.error === "string" && body.error.trim()) return body.error;
  if (typeof body?.message === "string" && body.message.trim()) return body.message;
  if (body?.error && typeof body.error === "object") {
    const nested = body.error.message ?? body.error.detail ?? body.error.code;
    if (typeof nested === "string" && nested.trim()) return nested;
  }
  if (status === 409) return "An account with this email already exists";
  if (status === 429) return "Too many attempts. Wait a few minutes and try again.";
  if (status === 403) return "Registration is not available right now.";
  if (status === 503) return "Server is starting up — try again in a moment.";
  return `Request failed (${status})`;
}

async function api(path, init = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Device-Id": portalDeviceId(),
    ...(init.headers ?? {}),
  };
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers,
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(body, res.status));
  return body;
}

/** Stable browser id for abuse tracing / device bans (localStorage). */
function portalDeviceId() {
  const key = "gca_portal_device_id";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "";
  }
}

const REMEMBER_EMAIL_KEY = "gca_portal_email";
const JUST_REGISTERED_KEY = "gca_just_registered";

function markJustRegistered() {
  try {
    sessionStorage.setItem(JUST_REGISTERED_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function consumeJustRegistered(maxAgeMs = 120_000) {
  try {
    const raw = sessionStorage.getItem(JUST_REGISTERED_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(JUST_REGISTERED_KEY);
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < maxAgeMs;
  } catch {
    return false;
  }
}

function peekJustRegistered(maxAgeMs = 120_000) {
  try {
    const raw = sessionStorage.getItem(JUST_REGISTERED_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < maxAgeMs;
  } catch {
    return false;
  }
}

function loadRememberedEmail() {
  try {
    return localStorage.getItem(REMEMBER_EMAIL_KEY) || "";
  } catch {
    return "";
  }
}

function saveRememberedEmail(email) {
  const v = String(email || "").trim().toLowerCase();
  if (!v) return;
  try {
    localStorage.setItem(REMEMBER_EMAIL_KEY, v);
  } catch {
    /* ignore */
  }
}

function clearAccountUrlParams() {
  try {
    const url = new URL(location.href);
    if (!url.search && url.pathname === "/account/") return;
    url.pathname = "/account/";
    url.search = "";
    url.hash = "";
    history.replaceState({}, "", url.pathname);
  } catch {
    /* ignore */
  }
}

/** Keep URL in sync so refresh stays on the chosen tab (/account/ = login, ?register=1 = signup). */
function syncAccountAuthUrl(mode) {
  try {
    const url = new URL(location.href);
    url.pathname = "/account/";
    if (mode === "register") {
      url.searchParams.set("register", "1");
    } else {
      url.searchParams.delete("register");
      url.searchParams.delete("key");
    }
    const next = url.searchParams.toString();
    history.replaceState({}, "", next ? `${url.pathname}?${next}` : url.pathname);
  } catch {
    /* ignore */
  }
}

async function waitForSession(maxMs = 1200) {
  const delays = [0, 80, 160, 320, 640];
  let lastErr;
  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    if (delay > maxMs) break;
    try {
      await api("/client/auth/me");
      return true;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Not authenticated");
}

async function probeClientAuth() {
  const res = await fetch("/api/client/auth/me", {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Id": portalDeviceId(),
    },
  });
  if (res.ok) return { ok: true, user: await res.json().catch(() => null) };
  return { ok: false, status: res.status };
}

async function openClientDashboardAfterAuth({ isRegister = false, credentials = null } = {}) {
  if (isRegister) markJustRegistered();
  clearAccountUrlParams();
  document.body.classList.remove("acct-auth-view");
  app.classList.remove("acct-auth-page");
  if (consumeNextRedirect()) return;

  const openDashboard = async () => {
    await dashboard();
    consumeJustRegistered();
  };

  try {
    await openDashboard();
    return;
  } catch {
    /* cookie may need a tick — brief /me retry then dashboard again */
  }

  try {
    await waitForSession(isRegister ? 1500 : 800);
    await openDashboard();
    return;
  } catch {
    /* fall through to register auto-login */
  }

  if (isRegister && credentials) {
    try {
      const user = await api("/client/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      });
      notifySiteAuth(user?.name);
      await openDashboard();
      return;
    } catch {
      authView("login", null, {
        notice: "Account created. Sign in with your email and password to open your dashboard.",
        prefillEmail: String(credentials.email || ""),
      });
      return;
    }
  }

  throw new Error("Could not open your account. Sign in again.");
}

let portalConfig = {
  enabled: false,
  siteKey: null,
  registrationEnabled: true,
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
      registrationEnabled: true,
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
  if (tab === "support") wireSupportTab();
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
      <p><strong>Registration is closed right now.</strong> <a href="/account/">Sign in</a> if you have an account, or email <a href="mailto:${esc(email)}">${esc(email)}</a>.</p>
    </div>`;
  }
  return `<div class="acct-gate-closed" role="status">
    <p>Client portal sign-in is currently closed. Contact <a href="mailto:${esc(email)}">${esc(email)}</a>.</p>
  </div>`;
}

const FIELD_ICON = {
  name: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 10.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.75 16.5v-.55c0-2.1 2.35-3.2 5.25-3.2s5.25 1.1 5.25 3.2v.55" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  email: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3.5 6.25 10 11l6.5-4.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="3.5" y="5" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
  password: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="4.5" y="9" width="11" height="7.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 9V6.75a3 3 0 1 1 6 0V9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  telegram: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3.4 9.7 15.8 4.6c.55-.22 1.07.33.86.9L13.4 16c-.15.45-.7.52-1 .12l-2.75-3.55-2.2 1.85c-.28.24-.7.08-.78-.28L5.9 9.9l-2.2-.35c-.55-.09-.62-.85-.3-1.05Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  website: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 10h13M10 3.5c1.8 2 2.8 4.2 2.8 6.5S11.8 14.5 10 16.5C8.2 14.5 7.2 12.3 7.2 10S8.2 5.5 10 3.5Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
};

function authField({ name, label, type, icon, autocomplete, minlength, placeholder, required = true, optionalHint = false, value = "" }) {
  return `<label class="acct-field">
    <span class="acct-field-label">${esc(label)}${optionalHint ? ` <em class="acct-field-opt">optional</em>` : ""}</span>
    <span class="acct-field-wrap">
      <span class="acct-field-icon">${FIELD_ICON[icon] || ""}</span>
      <input name="${esc(name)}" type="${esc(type)}" ${required ? "required" : ""} autocomplete="${esc(autocomplete)}"${
        minlength ? ` minlength="${minlength}"` : ""
      }${type === "email" ? ' inputmode="email"' : ""}${type === "url" ? ' inputmode="url"' : ""} placeholder="${esc(placeholder)}"${
        value ? ` value="${esc(value)}"` : ""
      } />
    </span>
  </label>`;
}

function authAsideHtml(mode = "login") {
  const isRegister = mode === "register";
  return `<aside class="login-aside acct-gate-aside" aria-label="GetCarAPI client portal">
    <div class="acct-gate-aside-top">
      <p class="kicker">GetCarAPI</p>
      <h2>${isRegister ? "Start in minutes" : "Your API command center"}</h2>
      <p class="acct-gate-aside-lede">${
        isRegister
          ? "Free test key and 5 VIN credits — no card required."
          : "Tokens, usage graphs, and credits in one dashboard."
      }</p>
      <ul class="acct-gate-perks">
        <li><span class="acct-gate-perk-ico" aria-hidden="true">✓</span><span><strong>Test key</strong> — 5 free VIN lookups</span></li>
        <li><span class="acct-gate-perk-ico" aria-hidden="true">✓</span><span><strong>Production</strong> — after quick review</span></li>
        <li><span class="acct-gate-perk-ico" aria-hidden="true">✓</span><span><strong>Live Feed</strong> — Korea inventory add-on</span></li>
      </ul>
    </div>
    <div class="acct-gate-aside-foot">
      <span class="acct-gate-aside-label">Auth header</span>
      <code>Authorization: Bearer vdi_…</code>
    </div>
  </aside>`;
}

function authTabsHtml(mode) {
  const loginOpen = portalConfig.loginEnabled !== false;
  const registerOpen = portalConfig.registrationEnabled !== false;
  return `<div class="acct-gate-tabs" role="tablist" aria-label="Account access">
    ${
      loginOpen
        ? `<button type="button" role="tab" class="acct-gate-tab${mode === "login" ? " is-active" : ""}" data-mode="login" aria-selected="${
            mode === "login" ? "true" : "false"
          }">Sign in</button>`
        : ""
    }
    ${
      registerOpen
        ? `<button type="button" role="tab" class="acct-gate-tab${mode === "register" ? " is-active" : ""}" data-mode="register" aria-selected="${
            mode === "register" ? "true" : "false"
          }">Create account</button>`
        : ""
    }
  </div>`;
}

function authHeadline(mode) {
  if (mode === "register") {
    return {
      title: "Create your account",
      lede: "Test API key and 5 VIN credits included. Production access after review.",
    };
  }
  return { title: "Welcome back", lede: "Sign in to manage tokens, usage, and credits." };
}

function registerFormFieldsHtml() {
  return `${authField({
    name: "email",
    label: "Email",
    type: "email",
    icon: "email",
    autocomplete: "username",
    placeholder: "you@company.com",
  })}
  <div class="acct-gate-form-row acct-gate-form-row--2">
  ${authField({
    name: "telegramUsername",
    label: "Telegram",
    type: "text",
    icon: "telegram",
    autocomplete: "username",
    placeholder: "@username (optional)",
    required: false,
    optionalHint: true,
  })}
  ${authField({
    name: "websiteUrl",
    label: "Website",
    type: "text",
    icon: "website",
    autocomplete: "url",
    placeholder: "yoursite.com (optional)",
    required: false,
    optionalHint: true,
  })}
  </div>
  <div class="acct-gate-form-row acct-gate-form-row--2">
  ${authField({
    name: "password",
    label: "Password",
    type: "password",
    icon: "password",
    autocomplete: "new-password",
    minlength: 8,
    placeholder: "Min. 8 characters",
  })}
  <label class="acct-field">
    <span class="acct-field-label">Confirm password</span>
    <span class="acct-field-wrap">
      <span class="acct-field-icon">${FIELD_ICON.password}</span>
      <input name="confirmPassword" type="password" required minlength="8" autocomplete="new-password" placeholder="Repeat password" />
    </span>
  </label>
  </div>`;
}

function liveFeedOfferHtml(live, { compact = false } = {}) {
  const liveActive = Boolean(live?.active);
  const expiresAt = live?.expiresAt;
  if (liveActive) {
    const expiry = expiresAt
      ? ` Valid until ${esc(new Date(expiresAt).toLocaleString())}.`
      : " No expiry set.";
    return `<p class="sub">Live feed is active — unlimited calls within your monthly quota, no VIN credits.${expiry}</p>`;
  }
  const ticketBtn = `<button type="button" class="linkish" data-goto="support">Open a support ticket</button>`;
  if (compact) {
    return `<p class="sub"><strong>Live Feed Korea — €200/month</strong> · unlimited · up to 300,000 requests/month · Encar, KB ChaChaCha, Autowini + up to 5 sites. Enable via ${ticketBtn}.</p>`;
  }
  return `<div class="acct-live-offer">
    <p class="sub"><strong>Live Feed Korea — €200/month</strong> · unlimited usage · up to <strong>300,000 API requests/month</strong>.</p>
    <p class="sub">Sources include Encar, KB ChaChaCha, Autowini, and up to 5 Korean marketplaces total.</p>
    <p class="sub">Not enabled on signup. ${ticketBtn} to activate live feed on your account.</p>
  </div>`;
}

function authShell({ mode, error, notice, closed = false, prefillEmail = "" }) {
  const isRegister = mode === "register";
  const loginOpen = portalConfig.loginEnabled !== false;
  const registerOpen = portalConfig.registrationEnabled !== false;
  const isClosed =
    closed ||
    (mode === "register" && !registerOpen) ||
    (mode === "login" && !loginOpen);
  const { title, lede } = authHeadline(mode);

  document.body.classList.add("acct-auth-view");
  app.classList.add("acct-auth-page");

  const cardInner = `${isClosed ? portalClosedHtml(mode) : ""}
            ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ""}
            ${notice && !isClosed ? `<p class="form-notice" role="status">${esc(notice)}</p>` : ""}
            ${
              isClosed
                ? ""
                : `<form id="auth-form" class="acct-gate-form" autocomplete="on">
              ${isRegister ? registerFormFieldsHtml() : authField({
                name: "email",
                label: "Email",
                type: "email",
                icon: "email",
                autocomplete: "username",
                placeholder: "you@company.com",
                value: prefillEmail || loadRememberedEmail(),
              })}
              ${
                isRegister
                  ? ""
                  : authField({
                      name: "password",
                      label: "Password",
                      type: "password",
                      icon: "password",
                      autocomplete: "current-password",
                      placeholder: "Your password",
                    })
              }
              <button class="btn btn-primary btn-wide acct-gate-submit" type="submit" id="auth-btn">
                <span>${isRegister ? "Create account" : "Sign in"}</span>
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M4 10h11M11 6l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </form>`
            }
            ${!isClosed && portalConfig.enabled ? `<p class="sub acct-gate-cap"><span class="acct-gate-cap-ico" aria-hidden="true">🛡</span> Protected by reCAPTCHA</p>` : ""}
            ${
              isRegister && portalConfig.loginEnabled !== false
                ? `<p class="sub acct-gate-switch"><button type="button" class="linkish" data-auth-mode="login">Already have an account? Sign in</button></p>`
                : !isRegister && portalConfig.registrationEnabled !== false
                  ? `<p class="sub acct-gate-switch"><button type="button" class="linkish" data-auth-mode="register">Need an account? Create one</button></p>`
                  : ""
            }`;

  app.innerHTML = `<div class="acct-gate fade-in acct-gate--${mode}">
      <div class="login-split acct-gate-split">
        ${authAsideHtml(mode)}
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

  document.querySelectorAll("[data-auth-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-auth-mode");
      if (next) authView(next);
    });
  });

  if (isClosed) return;

  const form = document.getElementById("auth-form");
  const btn = document.getElementById("auth-btn");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    btn.disabled = true;
    btn.querySelector("span").textContent = isRegister ? "Creating…" : "Signing in…";
    const data = new FormData(event.target);
    try {
      if (isRegister) {
        const password = String(data.get("password") || "");
        const confirmPassword = String(data.get("confirmPassword") || "");
        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters");
        }
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match");
        }
      }
      const recaptchaToken = await getRecaptchaToken(isRegister ? "register" : "login");
      const payload = {
        email: data.get("email"),
        password: data.get("password"),
        recaptchaToken,
        deviceId: portalDeviceId(),
      };
      let user;
      if (isRegister) {
        const tg = String(data.get("telegramUsername") || "").trim();
        const site = String(data.get("websiteUrl") || "").trim();
        if (tg) payload.telegramUsername = tg;
        if (site) payload.websiteUrl = site;
        payload.confirmPassword = data.get("confirmPassword");
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
      saveRememberedEmail(payload.email);
      if (isRegister && user?.testToken?.value && user?.id) {
        saveStoredTestToken(user.id, user.testToken.value);
      }
      await openClientDashboardAfterAuth({
        isRegister,
        credentials: isRegister ? payload : null,
      });
    } catch (err) {
      authView(mode, err?.message || "Something went wrong. Try again.");
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
  if (mode === "register" && portalConfig.registrationEnabled === false) {
    syncAccountAuthUrl("login");
    authShell({ mode: "register", error, closed: true, ...opts });
    return;
  }
  if (mode === "login" && portalConfig.loginEnabled === false) {
    syncAccountAuthUrl("register");
    authShell({ mode: "login", error, closed: true, ...opts });
    return;
  }
  syncAccountAuthUrl(mode);
  authShell({ mode, error, ...opts });
}

function wantsRegister() {
  const params = new URLSearchParams(location.search);
  const reg = params.get("register");
  if (reg === "1" || reg === "true") return true;
  if (params.has("register") && reg === "") return true;
  return params.has("key");
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
    vin: "1FA6P8CF5K5120103",
    region: "usa",
    label: "Ford Mustang GT 2019",
    market: "iaa",
    description: "US salvage auction — 55+ imgsv CDN photos, auction timeline & events",
  },
  {
    vin: "ZAM57XSA5H1238315",
    region: "uae",
    label: "Maserati Ghibli S 2017",
    market: "dubicars",
    description: "Dubai retail listing — full imgsv gallery, price & mileage observations",
  },
  {
    vin: "WDDUX8GB8JA397509",
    region: "korea",
    label: "Mercedes-Benz S-Class 2018",
    market: "encar",
    description: "Korean Encar — 45+ registry events, 55+ imgsv photos, insurance history",
  },
  {
    vin: "ZAM57XSA4E1123233",
    region: "korea",
    label: "Maserati Ghibli 2014",
    market: "encar",
    description: "Korean Encar — 45+ events, accident & owner timeline, full photo gallery",
  },
  {
    vin: "WBS3C910XFP708160",
    region: "korea",
    label: "BMW M3 2015",
    market: "autowini",
    description: "Korean export (Autowini + Encar) — 20+ events, mileage & price history, imgsv photos",
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
  if (region === "uae") return "UAE";
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

function tokensPanel(dash, storedTestToken, { compact = false } = {}) {
  const tokens = (dash.tokens ?? []).filter((t) => t.isActive);
  const testTokens = tokens.filter((t) => t.isTestOnly);
  const prodTokens = tokens.filter((t) => !t.isTestOnly);
  const testMeta = testTokens[0];
  const hasSecret = Boolean(storedTestToken);
  const masked = storedTestToken
    ? `${storedTestToken.slice(0, 16)}…${storedTestToken.slice(-6)}`
    : testMeta
      ? `${testMeta.tokenPrefix}…`
      : "";

  const testBlock = testMeta
    ? `<article class="token-card token-card--test">
        <div class="token-card-head">
          <div class="token-card-title-row">
            <strong>${esc(testMeta.name || "Test key")}</strong>
            ${tokenKindChip(true)}
          </div>
          <p class="sub token-card-lede">${DEFAULT_TEST_VINS.length} test VINs · free · no credits</p>
        </div>
        ${
          hasSecret
            ? `<div class="token-secret-box">
                <label class="token-secret-label">Bearer token</label>
                <div class="acct-code-block token-secret-field">
                  <code id="test-token-display" class="mono token-secret" data-full="${esc(storedTestToken)}" data-masked="${esc(masked)}">${esc(masked)}</code>
                </div>
                <div class="token-secret-actions">
                  <button type="button" class="btn btn-ghost btn-sm" id="toggle-test-token">Show key</button>
                  <button type="button" class="btn btn-primary btn-sm" id="copy-test-token">Copy key</button>
                  <button type="button" class="btn btn-ghost btn-sm" id="regen-test-token">Regenerate</button>
                </div>
              </div>`
            : `<div class="token-secret-box token-secret-box--missing">
                <p class="sub">Prefix <span class="mono">${esc(testMeta.tokenPrefix)}…</span> — full secret was shown once at signup.</p>
                <button type="button" class="btn btn-primary" id="regen-test-token">Generate new test key</button>
              </div>`
        }
        <div class="token-meta">
          <span class="chip chip-free">Test VINs only</span>
          <small>Last used ${when(testMeta.lastUsedAt)}</small>
        </div>
      </article>`
    : `<article class="token-card token-card--test token-card--empty"><p class="sub">No test key yet — refresh or contact support.</p></article>`;

  const prodBlock =
    prodTokens.length > 0
      ? prodTokens
          .map(
            (token) => `<article class="token-card token-card--production">
              <div class="token-card-head">
                <div class="token-card-title-row">
                  <strong>${esc(token.name)}</strong>
                  ${tokenKindChip(false)}
                </div>
                <p class="sub token-card-lede">Full VIN history, live feed (when enabled), and paid retrieves.</p>
              </div>
              <div class="acct-code-block token-prefix-field">
                <label class="token-secret-label">Key prefix</label>
                <code class="mono token-prefix">${esc(token.tokenPrefix)}…</code>
              </div>
              <div class="token-meta">
                <span class="chip chip-production">Active</span>
                <small>Last used ${when(token.lastUsedAt)}</small>
              </div>
            </article>`,
          )
          .join("")
      : `<article class="token-card token-card--production token-card--empty">
          <div class="token-card-head">
            <div class="token-card-title-row">
              <strong>Production key</strong>
              ${tokenKindChip(false)}
            </div>
          </div>
          <p class="sub">Full VIN access · $${esc(dash.billing?.creditPriceUsd ?? 2)}/retrieve after review.</p>
          <button type="button" class="btn btn-primary" data-goto="support">Request production key</button>
        </article>`;

  if (compact) {
    const testHint = hasSecret ? masked : testMeta ? `${testMeta.tokenPrefix}…` : "—";
    const prodHint = prodTokens.length ? `${prodTokens.length} active` : "Not issued";
    return `<div class="acct-keys-teaser">
      <div class="acct-keys-teaser-row">
        <span class="chip chip-test">Test</span>
        <code class="mono">${esc(testHint)}</code>
      </div>
      <div class="acct-keys-teaser-row">
        <span class="chip chip-production">Production</span>
        <span>${esc(prodHint)}</span>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-goto="keys">Manage API keys →</button>
    </div>`;
  }

  return `<div class="acct-keys-layout">
    <div class="token-stack-section">
      <h3 class="token-stack-title">Test key</h3>
      ${testBlock}
    </div>
    <div class="token-stack-section">
      <h3 class="token-stack-title">Production ${prodTokens.length > 1 ? "keys" : "key"}</h3>
      <div class="token-list">${prodBlock}</div>
    </div>
  </div>`;
}

function keysTabPanel(dash, storedTestToken) {
  const testBearer = storedTestToken || "";
  const sampleVin = sampleTestVin(resolveTestVins(dash));
  return `
    <article class="acct-surface acct-keys-panel">
      <div class="acct-row-head">
        <div>
          <h2>API keys</h2>
          <p class="sub">Test key is ready immediately. Production keys are issued after review via support.</p>
        </div>
      </div>
      ${tokensPanel(dash, storedTestToken)}
    </article>
    <article class="acct-surface" style="margin-top:1rem">
      <h2>Authorization header</h2>
      <p class="sub">Send your key on every request. Test and production keys use the same header format.</p>
      <div class="acct-code-block acct-code-block--wide">
        <pre>${esc(bearerExample(testBearer))}</pre>
      </div>
      <p class="sub acct-links" style="margin-top:.85rem">
        <a href="/api/authentication">Authentication guide</a> · <a href="/docs">OpenAPI</a>
      </p>
    </article>
    <article class="acct-surface" style="margin-top:1rem">
      <h2>Quick test</h2>
      <p class="sub">Same VIN endpoints as production — test key + curated VIN = free, no credits.</p>
      <div class="acct-ep">
        <div class="acct-ep-meta"><code>GET /api/v1/vin/check/${esc(sampleVin)}</code><span class="chip chip-free">Free</span></div>
        <div class="acct-code-block"><pre>curl -H "${esc(bearerExample(testBearer))}" \\
  https://getcarapi.com/api/v1/vin/check/${esc(sampleVin)}</pre></div>
      </div>
    </article>`;
}

function testVinsApiCallout() {
  return `
    <div class="acct-callout acct-callout--info">
      <strong>Same API as production — not a separate test endpoint</strong>
      <p class="sub">Use your test Bearer key with the normal VIN routes. Credits are not charged on curated test VINs.</p>
      <ul class="acct-endpoint-list">
        <li><code>GET /api/v1/vin/check/{vin}</code> — free availability check</li>
        <li><code>GET /api/v1/vin/{vin}</code> — full retrieve (<code>meta.creditCharged: 0</code> on test VINs)</li>
        <li><code>GET /api/v1/test-vins</code> — optional list of the ${DEFAULT_TEST_VINS.length} curated VINs</li>
      </ul>
    </div>`;
}

function supportStatusLabel(status) {
  if (status === "awaiting_client") return "Awaiting you";
  if (status === "closed") return "Closed";
  return "Open";
}

function supportPanelShell() {
  return `
    <div class="acct-support" id="support-root">
      <div class="acct-support-toolbar">
        <div>
          <h2>Support</h2>
          <p class="sub">Open a ticket for billing, API keys, live feed, or technical help.</p>
          <p class="sub acct-support-limits" id="support-limits-hint">1 ticket per day · max 2 replies every 5 minutes</p>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="support-new-btn">New ticket</button>
      </div>
      <div class="acct-support-layout">
        <aside class="acct-support-list-wrap">
          <div class="acct-support-list-head">Your tickets</div>
          <div class="acct-support-list" id="support-list"><p class="sub acct-support-loading">Loading…</p></div>
        </aside>
        <section class="acct-support-thread" id="support-thread">
          <div class="acct-support-empty">Select a ticket or create a new one.</div>
        </section>
      </div>
      <article class="acct-surface acct-support-new" id="support-new-panel" hidden>
        <h3>New support ticket</h3>
        <form id="support-new-form" class="acct-form">
          <label><span>Subject</span><input name="subject" type="text" required minlength="3" maxlength="160" placeholder="Brief summary" /></label>
          <label><span>Message</span><textarea name="message" required minlength="10" maxlength="8000" rows="5" placeholder="Describe your question or issue"></textarea></label>
          <div class="acct-support-new-actions">
            <button type="button" class="btn btn-ghost" id="support-new-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Submit ticket</button>
          </div>
        </form>
        <p id="support-new-msg" class="sub" role="status"></p>
      </article>
    </div>`;
}

let supportPollTimer = null;
let supportTicketsCache = [];
let supportSelectedId = null;
let supportLimitsCache = null;

function applySupportLimitsUi() {
  const limits = supportLimitsCache;
  const hint = document.getElementById("support-limits-hint");
  const newBtn = document.getElementById("support-new-btn");
  if (hint && limits) {
    const ticketLeft = Math.max(0, (limits.ticketsPerDay ?? 1) - (limits.ticketsCreatedToday ?? 0));
    const replyLeft = Math.max(0, (limits.repliesPer5Minutes ?? 2) - (limits.repliesInLast5Minutes ?? 0));
    hint.textContent = `${ticketLeft} ticket${ticketLeft === 1 ? "" : "s"} left today · ${replyLeft} repl${replyLeft === 1 ? "y" : "ies"} left in the next 5 min`;
  }
  if (newBtn && limits) {
    newBtn.disabled = !limits.canCreateTicket;
    newBtn.title = limits.canCreateTicket ? "" : "Daily ticket limit reached";
  }
}

async function refreshSupportLimits() {
  try {
    supportLimitsCache = await api("/client/support/limits");
    applySupportLimitsUi();
  } catch {
    supportLimitsCache = null;
  }
  return supportLimitsCache;
}

async function refreshSupportUnreadBadge() {
  const badge = document.getElementById("support-unread-badge");
  if (!badge) return;
  try {
    const body = await api("/client/support/unread-count");
    const n = Number(body?.unreadCount ?? 0);
    if (n > 0) {
      badge.hidden = false;
      badge.textContent = n > 99 ? "99+" : String(n);
    } else {
      badge.hidden = true;
    }
  } catch {
    badge.hidden = true;
  }
}

function startSupportUnreadPoll() {
  if (supportPollTimer) clearInterval(supportPollTimer);
  refreshSupportUnreadBadge();
  supportPollTimer = setInterval(refreshSupportUnreadBadge, 45_000);
}

function renderSupportList() {
  const list = document.getElementById("support-list");
  if (!list) return;
  if (!supportTicketsCache.length) {
    list.innerHTML = `<p class="sub acct-support-empty-list">No tickets yet. Create one if you need help.</p>`;
    return;
  }
  list.innerHTML = supportTicketsCache
    .map(
      (t) => `<button type="button" class="acct-support-item${supportSelectedId === t.id ? " is-active" : ""}${t.clientUnread ? " is-unread" : ""}" data-support-id="${esc(t.id)}">
        <span class="acct-support-item-title">${esc(t.subject)}</span>
        <span class="acct-support-item-preview">${esc(t.preview || "")}</span>
        <span class="acct-support-item-meta">
          <span class="chip chip-sm">${esc(supportStatusLabel(t.status))}</span>
          <span>${when(t.lastMessageAt || t.updatedAt)}</span>
        </span>
      </button>`,
    )
    .join("");
}

function renderSupportThread(ticket, messages) {
  const thread = document.getElementById("support-thread");
  if (!thread || !ticket) return;
  const closed = ticket.status === "closed";
  const msgs = (messages || [])
    .map(
      (m) => `<article class="acct-support-msg acct-support-msg--${esc(m.authorType)}">
        <div class="acct-support-msg-head">
          <strong>${m.authorType === "admin" ? "Support" : "You"}</strong>
          <span>${when(m.createdAt)}</span>
        </div>
        <div class="acct-support-msg-body">${esc(m.body)}</div>
      </article>`,
    )
    .join("");
  thread.innerHTML = `
    <div class="acct-support-thread-head">
      <div>
        <h3>${esc(ticket.subject)}</h3>
        <p class="sub"><span class="chip chip-sm">${esc(supportStatusLabel(ticket.status))}</span> · #${esc(ticket.id)}</p>
      </div>
      <button type="button" class="btn btn-ghost btn-sm acct-support-delete" id="support-delete-ticket" data-ticket-id="${esc(ticket.id)}">Delete ticket</button>
    </div>
    <div class="acct-support-messages">${msgs || `<p class="sub">No messages yet.</p>`}</div>
    ${
      closed
        ? `<p class="sub acct-support-closed">This ticket is closed. Open a new ticket if you need more help.</p>`
        : `<form id="support-reply-form" class="acct-form acct-support-reply">
            <label><span>Reply</span><textarea name="message" required minlength="2" maxlength="8000" rows="4" placeholder="Write your reply"></textarea></label>
            <button type="submit" class="btn btn-primary btn-sm" id="support-reply-btn"${supportLimitsCache && !supportLimitsCache.canReply ? " disabled" : ""}>Send reply</button>
            <p id="support-reply-msg" class="sub" role="status"></p>
          </form>`
    }`;
}

async function loadSupportTickets(selectId) {
  await refreshSupportLimits();
  const body = await api("/client/support/tickets");
  supportTicketsCache = body?.items ?? [];
  if (selectId != null) supportSelectedId = selectId;
  else if (supportSelectedId == null && supportTicketsCache.length) supportSelectedId = supportTicketsCache[0].id;
  renderSupportList();
  if (supportSelectedId != null) await openSupportTicket(supportSelectedId, { skipList: true });
  else {
    const thread = document.getElementById("support-thread");
    if (thread) thread.innerHTML = `<div class="acct-support-empty">Select a ticket or create a new one.</div>`;
  }
}

async function openSupportTicket(id, { skipList = false } = {}) {
  supportSelectedId = id;
  if (!skipList) renderSupportList();
  const body = await api(`/client/support/tickets/${id}`);
  renderSupportThread(body.ticket, body.messages);
  await refreshSupportUnreadBadge();
  const replyForm = document.getElementById("support-reply-form");
  replyForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById("support-reply-msg");
    const fd = new FormData(e.target);
    const message = String(fd.get("message") ?? "").trim();
    try {
      const res = await api(`/client/support/tickets/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      if (res?.limits) {
        supportLimitsCache = res.limits;
        applySupportLimitsUi();
      }
      if (msgEl) msgEl.textContent = "Sent.";
      e.target.reset();
      await loadSupportTickets(id);
    } catch (err) {
      if (err.message && supportLimitsCache && !supportLimitsCache.canReply) applySupportLimitsUi();
      if (msgEl) msgEl.textContent = err.message;
    }
  });
}

function wireSupportTab() {
  const root = document.getElementById("support-root");
  if (!root || root.dataset.wired === "1") return;
  root.dataset.wired = "1";

  const newBtn = document.getElementById("support-new-btn");
  const newPanel = document.getElementById("support-new-panel");
  const newCancel = document.getElementById("support-new-cancel");
  const newForm = document.getElementById("support-new-form");

  newBtn?.addEventListener("click", () => {
    if (newPanel) newPanel.hidden = false;
  });
  newCancel?.addEventListener("click", () => {
    if (newPanel) newPanel.hidden = true;
  });

  newForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("support-new-msg");
    const fd = new FormData(e.target);
    try {
      const body = await api("/client/support/tickets", {
        method: "POST",
        body: JSON.stringify({
          subject: fd.get("subject"),
          message: fd.get("message"),
        }),
      });
      if (body?.limits) {
        supportLimitsCache = body.limits;
        applySupportLimitsUi();
      }
      if (msg) msg.textContent = "Ticket created.";
      if (newPanel) newPanel.hidden = true;
      e.target.reset();
      await loadSupportTickets(body.ticket?.id);
    } catch (err) {
      if (msg) msg.textContent = err.message;
      await refreshSupportLimits();
    }
  });

  root.addEventListener("click", async (e) => {
    const delBtn = e.target.closest("#support-delete-ticket");
    if (!delBtn) return;
    const ticketId = Number(delBtn.getAttribute("data-ticket-id"));
    if (!Number.isFinite(ticketId)) return;
    if (!window.confirm("Delete this ticket permanently? This cannot be undone.")) return;
    try {
      const body = await api(`/client/support/tickets/${ticketId}`, { method: "DELETE" });
      if (body?.limits) {
        supportLimitsCache = body.limits;
        applySupportLimitsUi();
      }
      supportSelectedId = null;
      await loadSupportTickets();
      await refreshSupportUnreadBadge();
    } catch (err) {
      alert(err.message || "Could not delete ticket");
    }
  });

  document.getElementById("support-list")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-support-id]");
    if (!btn) return;
    openSupportTicket(Number(btn.getAttribute("data-support-id"))).catch(() => {});
  });

  loadSupportTickets().catch(() => {
    const list = document.getElementById("support-list");
    if (list) list.innerHTML = `<p class="sub">Could not load tickets.</p>`;
  });
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
      ${testVinsApiCallout()}
      <div class="test-vin-grid">${rows}</div>
      ${
        expanded
          ? `<p class="sub" style="margin-top:.85rem">Response includes <code>meta.testVin: true</code> and <code>meta.creditCharged: 0</code> on retrieve.</p>`
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
      <p class="sub">Same VIN endpoints as production — use your test key, zero credits.</p>
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
            : liveFeedOfferHtml(live)
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
  if (!Number.isFinite(usd)) return { ok: false, error: "Enter a valid amount" };
  if (usd !== Math.floor(usd)) return { ok: false, error: "Whole dollars only" };
  if (usd < minUsd) return { ok: false, error: `Minimum $${Math.floor(minUsd)}` };
  if (usd % p !== 0) return { ok: false, error: `Must be a multiple of $${p}` };
  return { ok: true, credits: usd / p };
}

function depositAmountPresets(minUsd, price) {
  const minValid = minValidDepositUsd(minUsd, price);
  const candidates = [minValid, 50, 60, 100, 200, 500];
  return [...new Set(candidates)]
    .filter((n) => n >= minValid && n % price === 0)
    .sort((a, b) => a - b)
    .slice(0, 5);
}

function purchaseStatusLabel(status) {
  const map = { pending: "Pending", approved: "Credited", rejected: "Rejected" };
  return map[status] ?? status;
}

function purchaseStatusClass(status) {
  if (status === "approved") return "buy-status--ok";
  if (status === "rejected") return "buy-status--err";
  return "buy-status--wait";
}

function creditsBalanceHero(billing) {
  const price = billing.creditPriceUsd ?? 2;
  const minUsd = billing.minCryptoDepositUsd ?? 40;
  const minValid = minValidDepositUsd(minUsd, price);
  const credits = billing.credits ?? 0;
  return `
    <div class="buy-balance-hero">
      <div class="buy-balance-main">
        <span class="buy-balance-label">Credits</span>
        <strong class="buy-balance-value">${esc(credits)}</strong>
      </div>
      <div class="buy-balance-meta">
        <span>$${esc(price)} / retrieve</span>
        <span class="buy-balance-dot" aria-hidden="true">·</span>
        <span>$${esc(minValid)} min</span>
      </div>
    </div>`;
}

function creditsBuyHtml(billing) {
  const price = billing.creditPriceUsd ?? 2;
  const minUsd = billing.minCryptoDepositUsd ?? 40;
  const minValid = minValidDepositUsd(minUsd, price);
  const methods = resolveCryptoMethods(billing);
  const defaultCredits = minValid / price;
  const presets = depositAmountPresets(minUsd, price);
  const presetBtns = presets
    .map((usd, i) => {
      const credits = usd / price;
      return `<button type="button" class="buy-preset${i === 0 ? " is-on" : ""}" data-amount-preset="${usd}">
        <strong>$${usd}</strong>
        <span>${credits} credits</span>
      </button>`;
    })
    .join("");
  const netCards = methods
    .map((m) => {
      const badge = m.id === "USDT_BNB" ? "BNB" : "ETH";
      const badgeClass = m.id === "USDT_BNB" ? "buy-net-badge--bnb" : "buy-net-badge--eth";
      return `<button type="button" class="buy-net-card" data-network="${esc(m.id)}" data-network-label="${esc(m.label)}">
        <span class="buy-net-badge ${badgeClass}">${esc(badge)}</span>
        <span class="buy-net-copy">
          <strong>${esc(m.label)}</strong>
          <span>${esc(m.network)}</span>
        </span>
        <span class="buy-net-arrow" aria-hidden="true">→</span>
      </button>`;
    })
    .join("");
  return `
    <div id="buy-wizard" class="buy-wizard">
      <nav class="buy-progress" aria-label="Checkout steps">
        <span class="buy-progress-item is-on" data-step-mark="1"><i>1</i> Chain</span>
        <span class="buy-progress-item" data-step-mark="2"><i>2</i> Amount</span>
        <span class="buy-progress-item" data-step-mark="3"><i>3</i> Send</span>
        <span class="buy-progress-item" data-step-mark="4"><i>4</i> Proof</span>
      </nav>
      <div data-buy-step="1">
        <h3 class="buy-step-title">Pick chain</h3>
        <div class="buy-networks">${netCards}</div>
      </div>
      <div data-buy-step="2" hidden>
        <h3 class="buy-step-title">How much?</h3>
        <p class="buy-selected-net sub" id="buy-selected-net"></p>
        <div class="buy-preset-row" role="group" aria-label="Quick amounts">${presetBtns}</div>
        <form id="buy-amount-form" class="acct-form buy-amount-form">
          <input type="hidden" name="cryptoCurrency" id="buy-network" />
          <label class="buy-amount-field">
            <span>Or enter USD</span>
            <div class="buy-amount-input">
              <span class="buy-amount-prefix">$</span>
              <input name="amountUsd" type="number" min="${minValid}" step="${price}" value="${minValid}" inputmode="numeric" required />
            </div>
          </label>
          <p class="buy-credits-preview" id="buy-credits-preview">${defaultCredits} credits</p>
          <p class="buy-rule">Whole dollars · multiples of $${esc(price)}</p>
          <div class="buy-actions">
            <button class="btn btn-primary" type="submit">Continue</button>
            <button type="button" class="btn btn-ghost btn-sm buy-back" data-buy-back>Back</button>
          </div>
        </form>
      </div>
      <div data-buy-step="3" hidden>
        <h3 class="buy-step-title">Send USDT</h3>
        <div id="buy-payment-details"></div>
        <div class="buy-actions">
          <button type="button" class="btn btn-primary" data-buy-to-proof>I paid</button>
          <button type="button" class="btn btn-ghost btn-sm buy-back" data-buy-back>Back</button>
        </div>
      </div>
      <div data-buy-step="4" hidden>
        <h3 class="buy-step-title">Confirm payment</h3>
        <p class="buy-proof-hint">Tx hash and/or screenshot — we verify, then add credits.</p>
        <form id="buy-proof-form" class="acct-form buy-proof-form">
          <input type="hidden" name="purchaseId" id="buy-purchase-id" />
          <label><span>Transaction hash</span><input name="txHash" type="text" autocomplete="off" placeholder="0x…" /></label>
          <label class="buy-file-field"><span>Screenshot</span><input name="proofFile" type="file" accept="image/jpeg,image/png" /></label>
          <label><span>Note <em>(optional)</em></span><input name="payerNote" type="text" maxlength="500" placeholder="Exchange, wallet…" /></label>
          <button class="btn btn-primary" type="submit">Submit</button>
        </form>
      </div>
      <p id="buy-msg" class="buy-msg" role="status"></p>
    </div>`;
}

function paymentDetailsHtml(payment) {
  return `
    <div class="buy-pay-grid">
      <div class="buy-pay-qr-wrap">
        <img src="${esc(payment.qrPath)}" alt="USDT QR" class="buy-qr" width="240" height="240" loading="lazy" />
      </div>
      <div class="buy-pay-meta">
        <p class="buy-pay-amount">$${esc(payment.amountUsd)} <span>USDT</span></p>
        <p class="buy-pay-credits">= ${esc(payment.credits)} credits</p>
        <p class="buy-pay-network">${esc(payment.label)}</p>
        <div class="buy-wallet-row">
          <code class="mono buy-wallet">${esc(payment.walletAddress)}</code>
          <button type="button" class="btn btn-primary btn-sm" data-copy-wallet>Copy wallet</button>
        </div>
        <p class="buy-pay-note">Send exact amount</p>
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
    preview.textContent = `${check.credits} credits`;
    preview.classList.remove("buy-preview-err");
  };
  amountInput?.addEventListener("input", () => {
    wizard.querySelectorAll("[data-amount-preset]").forEach((b) => b.classList.remove("is-on"));
    updatePreview();
  });

  wizard.querySelectorAll("[data-amount-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const usd = Number(btn.getAttribute("data-amount-preset"));
      if (amountInput && Number.isFinite(usd)) amountInput.value = String(usd);
      wizard.querySelectorAll("[data-amount-preset]").forEach((b) => b.classList.toggle("is-on", b === btn));
      updatePreview();
    });
  });

  updatePreview();

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
      if (msg) msg.textContent = "Submitted — credits added after verification.";
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
            hasProductionToken ? "" : " · test key active — add credits for production VINs"
          }</p>
        </div>
        <div class="acct-head-actions">
          <button type="button" class="acct-notify-btn" id="support-bell" data-goto="support" aria-label="Support messages">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 22a2.2 2.2 0 0 0 2.15-1.75H9.85A2.2 2.2 0 0 0 12 22Zm6-6V11a6 6 0 1 0-12 0v5L4 18v1h16v-1l-2-2Z" fill="currentColor"/></svg>
            <span class="acct-notify-badge" id="support-unread-badge" hidden>0</span>
          </button>
          <button class="btn btn-ghost" id="logout" type="button">Sign out</button>
        </div>
      </header>

      <nav class="account-tabs" id="tabs" role="tablist">
        <button type="button" class="on" data-tab="overview" role="tab">Overview</button>
        <button type="button" data-tab="keys" role="tab">API keys</button>
        <button type="button" data-tab="testvins" role="tab">Test VINs</button>
        <button type="button" data-tab="usage" role="tab">Usage</button>
        <button type="button" data-tab="credits" role="tab">Credits</button>
        <button type="button" data-tab="support" role="tab">Support</button>
        <button type="button" data-tab="docs" role="tab">API docs</button>
        <button type="button" data-tab="profile" role="tab">Profile</button>
      </nav>

      <section data-panel="overview">
        <div class="acct-kpi">
          <button type="button" class="acct-kpi-item accent acct-kpi-link" data-goto="credits"><span>Credits</span><strong>${esc(billing.credits ?? 0)}</strong></button>
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
                } Live calls are unlimited within your monthly quota and never use VIN credits.</p>`
              : liveFeedOfferHtml(live)
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
          <article class="acct-surface">
            <div class="acct-row-head">
              <h2>API keys</h2>
              <button type="button" class="linkish" data-goto="keys">Open →</button>
            </div>
            ${tokensPanel(dash, storedTestToken, { compact: true })}
          </article>
          <article class="acct-surface">
            <h2>Quick start</h2>
            <p class="sub">Copy your test key, pick a test VIN, hit the same endpoints as production.</p>
            <div class="acct-code-block"><pre>${esc(bearerExample(testBearer))}</pre></div>
            <p class="sub" style="margin-top:.85rem">
              <button type="button" class="linkish" data-goto="keys">API keys</button>
              · <button type="button" class="linkish" data-goto="testvins">Test VINs</button>
              · <button type="button" class="linkish" data-goto="docs">API docs</button>
            </p>
          </article>
        </div>
      </section>

      <section data-panel="keys" hidden>${keysTabPanel(dash, storedTestToken)}</section>

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
        ${creditsBalanceHero(billing)}
        <article class="acct-surface buy-panel">
          <div class="acct-row-head">
            <h2>Top up · USDT</h2>
            <span class="chip">Manual verify</span>
          </div>
          ${creditsBuyHtml(billing)}
        </article>
        <div class="acct-grid-2" style="margin-top:1rem">
            <article class="acct-surface">
              <h2>Deposits</h2>
              <div class="log-list buy-history">
                ${
                  purchaseItems.length
                    ? purchaseItems
                        .map(
                          (p) => `<article class="log-card buy-history-card">
                            <div class="log-top">
                              <span class="buy-status ${purchaseStatusClass(p.status)}">${esc(purchaseStatusLabel(p.status))}</span>
                              <span>${when(p.createdAt)}</span>
                            </div>
                            <div class="buy-history-amount"><strong>+${esc(p.credits)}</strong> credits · $${esc(p.amountUsd)} USDT</div>
                            ${p.txHash ? `<div class="mono log-path buy-history-tx">${esc(p.txHash)}</div>` : ""}
                          </article>`,
                        )
                        .join("")
                    : `<p class="sub buy-history-empty">No deposits yet</p>`
                }
              </div>
            </article>
            <article class="acct-surface">
              <h2>Activity</h2>
              <div class="log-list buy-history">
                ${
                  ledgerItems.length
                    ? ledgerItems
                        .map(
                          (row) => `<article class="log-card buy-history-card">
                            <div class="log-top">
                              <strong class="${row.delta > 0 ? "buy-ledger-plus" : "buy-ledger-minus"}">${row.delta > 0 ? "+" : ""}${esc(row.delta)}</strong>
                              <span>${when(row.createdAt)}</span>
                            </div>
                            <div class="buy-history-meta">${esc(row.reason)} · balance ${esc(row.balanceAfter)}</div>
                          </article>`,
                        )
                        .join("")
                    : `<p class="sub buy-history-empty">No activity yet</p>`
                }
              </div>
            </article>
        </div>
      </section>

      <section data-panel="support" hidden>${supportPanelShell()}</section>

      <section data-panel="profile" hidden>
        <article class="acct-surface">
          <h2>Profile &amp; company</h2>
          <p class="sub">Your contact details for support and API account records.</p>
          <form id="profile-form" class="acct-form acct-form-grid">
            <label><span>Name</span><input name="name" type="text" required minlength="2" value="${esc(dash.client?.name)}" autocomplete="name" /></label>
            <label><span>Email</span><input type="email" value="${esc(dash.client?.email)}" disabled /></label>
            <label><span>Company name</span><input name="companyName" type="text" maxlength="160" value="${esc(dash.client?.companyName || "")}" placeholder="Optional" autocomplete="organization" /></label>
            <label><span>Telegram</span><input name="telegramUsername" type="text" maxlength="64" value="${esc(dash.client?.telegramUsername || "")}" placeholder="username" autocomplete="username" /></label>
            <label><span>Website URL</span><input name="websiteUrl" type="url" maxlength="400" value="${esc(dash.client?.websiteUrl || "")}" placeholder="https://example.com" autocomplete="url" /></label>
            <label class="acct-form-span"><span>Current password</span><input name="currentPassword" type="password" autocomplete="current-password" placeholder="Only to change password" /></label>
            <label class="acct-form-span"><span>New password</span><input name="password" type="password" minlength="8" autocomplete="new-password" /></label>
            <div class="acct-form-span"><button class="btn btn-primary" type="submit">Save profile</button></div>
          </form>
          <p id="profile-msg" class="sub" role="status"></p>
        </article>
        <article class="acct-surface acct-narrow" style="margin-top:1rem">
          <h2>Live feed</h2>
          <p class="sub">${esc(live.message || "")}</p>
          <p class="sub">Status: <strong>${liveActive ? "Enabled" : "Disabled"}</strong>${
            live.expiresAt ? ` · until ${esc(new Date(live.expiresAt).toLocaleString())}` : liveActive ? " · no expiry" : ""
          }</p>
          ${liveActive ? `<p class="sub">Live stock does not use credits and is unlimited within your monthly quota while enabled.</p>` : liveFeedOfferHtml(live)}
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
  document.getElementById("support-bell")?.addEventListener("click", () => setTab("support"));
  startSupportUnreadPoll();
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
  const displayEl = document.getElementById("test-token-display");

  toggleBtn?.addEventListener("click", () => {
    if (!displayEl) return;
    const reveal = displayEl.dataset.revealed !== "1";
    displayEl.textContent = reveal ? displayEl.dataset.full || "" : displayEl.dataset.masked || "";
    displayEl.dataset.revealed = reveal ? "1" : "0";
    toggleBtn.textContent = reveal ? "Hide key" : "Show key";
  });

  copyBtn?.addEventListener("click", async () => {
    const token = displayEl?.dataset.full || storedTestToken;
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = "Copy key";
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
      await dashboard("keys");
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
          companyName: fd.get("companyName"),
          telegramUsername: fd.get("telegramUsername"),
          websiteUrl: fd.get("websiteUrl"),
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

  window.addEventListener("portal-register-request", () => {
    authView("register");
  });

  window.addEventListener("portal-login-request", () => {
    authView("login");
  });

  const justRegistered = peekJustRegistered();

  for (let attempt = 0; attempt < (justRegistered ? 3 : 1); attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 120 * attempt));
    const probe = await probeClientAuth();
    if (probe.ok) {
      notifySiteAuth(probe.user?.name);
      consumeJustRegistered();
      clearAccountUrlParams();
      if (consumeNextRedirect()) return;
      await dashboard();
      return;
    }
    if (probe.status !== 401 && attempt + 1 < (justRegistered ? 3 : 1)) continue;
    if (probe.status !== 401) break;
  }

  try {
    const session = await fetch("/api/client/auth/session", { credentials: "include" }).then((r) =>
      r.json().catch(() => ({})),
    );
    if (session?.authenticated) {
      await api("/client/auth/logout", { method: "POST" });
    }
  } catch {
    /* clear stale session so login works */
  }
  consumeJustRegistered();
  notifySiteAuth(null);
  authView(wantsRegister() ? "register" : "login");
}

boot();
