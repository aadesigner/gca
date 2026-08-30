const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

document.documentElement.classList.add(finePointer ? "has-hover" : "touch-ui");
document.body.classList.add("is-loading");

const pageLoad = document.getElementById("page-load");
pageLoad?.addEventListener("animationend", () => pageLoad.remove());

window.addEventListener(
  "DOMContentLoaded",
  () => {
    document.body.classList.remove("is-loading");
  },
  { once: true },
);

const menuBtn = document.getElementById("menu-btn");
const navClose = document.getElementById("nav-close");
const navBackdrop = document.getElementById("nav-backdrop");
const mobileDrawer = document.getElementById("mobile-drawer");
const histDropdown = document.getElementById("hist-dropdown");
const histDropBtn = document.getElementById("hist-drop-btn");

function setMobileNav(open) {
  const isOpen = Boolean(open);
  const wasOpen = document.body.classList.contains("nav-open");

  if (isOpen && !wasOpen) {
    const y = window.scrollY || window.pageYOffset || 0;
    document.body.dataset.navScrollY = String(y);
    document.body.style.top = `-${y}px`;
    document.body.classList.add("nav-open");
  } else if (!isOpen && wasOpen) {
    const y = Number(document.body.dataset.navScrollY || 0);
    document.body.classList.remove("nav-open");
    document.body.style.top = "";
    delete document.body.dataset.navScrollY;
    window.scrollTo(0, y);
  }

  menuBtn?.setAttribute("aria-expanded", isOpen ? "true" : "false");
  menuBtn?.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  mobileDrawer?.classList.toggle("is-open", isOpen);
  mobileDrawer?.setAttribute("aria-hidden", isOpen ? "false" : "true");
  if (navBackdrop) {
    navBackdrop.hidden = !isOpen;
    navBackdrop.classList.toggle("is-visible", isOpen);
  }
}

function closeMobileNav() {
  setMobileNav(false);
}

function closeHistDrop() {
  histDropdown?.classList.remove("is-open");
  histDropBtn?.setAttribute("aria-expanded", "false");
}

menuBtn?.addEventListener("click", () => {
  const open = !mobileDrawer?.classList.contains("is-open");
  if (open) closeHistDrop();
  setMobileNav(open);
});

navClose?.addEventListener("click", closeMobileNav);
navBackdrop?.addEventListener("click", closeMobileNav);

mobileDrawer?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", closeMobileNav);
});

if (histDropBtn && histDropdown) {
  if (finePointer) {
    histDropBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    histDropdown.addEventListener("mouseenter", () => {
      histDropBtn.setAttribute("aria-expanded", "true");
    });
    histDropdown.addEventListener("mouseleave", () => {
      closeHistDrop();
    });
  } else {
    histDropBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = !histDropdown.classList.contains("is-open");
      histDropdown.classList.toggle("is-open", open);
      histDropBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", (e) => {
      if (!histDropdown.contains(e.target)) closeHistDrop();
    });
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeHistDrop();
  closeMobileNav();
});

window.addEventListener("resize", () => {
  if (window.matchMedia("(min-width: 861px)").matches) closeMobileNav();
});

const header = document.querySelector(".site-header");
if (header) {
  const onScroll = () => {
    header.classList.toggle("is-scrolled", (window.scrollY || 0) > 8);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

const STAGGER_GRIDS =
  ".feat, .cards, .sources, .stock-grid, .faq-grid, .docs-faq-grid, .history-market-grid, .market-flag-grid, .coverage-grid, .archive-stats-grid, .docs-quickstart, .docs-flow, .docs-products-grid, .demo-grid, .history-payload-grid, .history-record-grid, .docs-auth-grid, .docs-limits, .vin-rec-keys, .live-payload-grid, .live-board-grid, .live-faq-grid";

function applyStaggerDelays() {
  if (reducedMotion) return;
  document.querySelectorAll(STAGGER_GRIDS).forEach((grid) => {
    const items = grid.querySelectorAll(
      ":scope > .reveal-on, :scope > .archive-stat, :scope > .faq-item, :scope > .docs-qs-step, :scope > .docs-flow-step, :scope > .docs-product-card, :scope > .docs-limit, :scope > .live-payload-item, :scope > .live-board, :scope > .live-faq-item",
    );
    items.forEach((el, i) => {
      el.style.setProperty("--stagger", `${Math.min(i * 55, 385)}ms`);
    });
  });
}

function animateArchiveChart(section) {
  const stage = section.querySelector("[data-archive-stage]");
  stage?.classList.add("animate");

  section.querySelectorAll(".donut-arc").forEach((el, i) => {
    const len = parseFloat(el.dataset.len);
    const circ = parseFloat(el.dataset.circ);
    if (!len || !circ) return;
    window.setTimeout(
      () => {
        const dash = `${len} ${circ - len}`;
        el.style.strokeDasharray = dash;
        const hit = section.querySelector(`.donut-hit[data-i="${el.dataset.i}"]`);
        if (hit) hit.style.strokeDasharray = dash;
      },
      reducedMotion ? 0 : 80 + i * 55,
    );
  });

  const counter = section.querySelector(".donut-count");
  if (!counter || reducedMotion) return;
  const target = parseInt(counter.dataset.target || "10", 10);
  const start = performance.now();
  const duration = 900;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    counter.textContent = String(Math.round(eased * target));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function initArchiveChartInteraction(section) {
  const stage = section.querySelector("[data-archive-stage]");
  const hub = section.querySelector(".donut-hub");
  if (!stage || !hub) return;

  const hubKicker = hub.querySelector(".donut-hub-kicker");
  const hubMain = hub.querySelector(".donut-hub-main");
  const hubSub = hub.querySelector(".donut-hub-sub");
  const hubExtra = hub.querySelector(".donut-hub-extra");
  const hubFill = hub.querySelector(".donut-hub-fill");
  const counter = hub.querySelector(".donut-count");

  const resetHub = () => {
    if (hubKicker) hubKicker.textContent = "Total archive";
    if (hubMain && counter) {
      hubMain.innerHTML = `<strong class="donut-count" data-target="10">${counter.textContent || "10"}</strong><span class="donut-suffix">M+</span>`;
    }
    if (hubSub) hubSub.textContent = "vehicles since 2021";
    if (hubExtra) hubExtra.textContent = "USA · Korea · 5 more · still expanding";
    if (hubFill) hubFill.style.width = "100%";
  };

  const arcs = [...section.querySelectorAll(".donut-arc")];
  const hits = [...section.querySelectorAll(".donut-hit")];
  const legend = [...section.querySelectorAll(".archive-chart-legend .leg-item")];
  let locked = null;

  const metaOf = (el) => ({
    i: el.dataset.i,
    label: el.dataset.label,
    count: el.dataset.count,
    pct: el.dataset.pct,
  });

  const setFocus = (i) => {
    const idx = String(i);
    stage.classList.add("is-focus");
    arcs.forEach((a) => a.classList.toggle("is-active", a.dataset.i === idx));
    legend.forEach((l) => l.classList.toggle("is-active", l.dataset.i === idx));
    const m = metaOf(
      arcs.find((a) => a.dataset.i === idx) ||
        hits.find((h) => h.dataset.i === idx) ||
        legend.find((l) => l.dataset.i === idx),
    );
    if (!m.label || !hubKicker || !hubMain || !hubSub) return;
    const pct = Number(m.pct) || 0;
    const approxM = ((10 * pct) / 100).toFixed(1);
    hubKicker.textContent = m.label;
    hubMain.innerHTML = `<strong class="donut-records">${m.count}</strong>`;
    hubSub.textContent = `${pct}% of 10M+ archive`;
    if (hubExtra) hubExtra.textContent = `≈ ${approxM}M vehicles · 6 fields per record`;
    if (hubFill) hubFill.style.width = `${pct}%`;
  };

  const clearFocus = () => {
    locked = null;
    stage.classList.remove("is-focus");
    arcs.forEach((a) => a.classList.remove("is-active"));
    legend.forEach((l) => l.classList.remove("is-active"));
    resetHub();
  };

  const bind = (el) => {
    el.addEventListener("mousedown", (e) => {
      if (e.button === 0) e.preventDefault();
    });
    el.addEventListener("mouseenter", () => {
      if (locked !== null) return;
      setFocus(el.dataset.i);
    });
    el.addEventListener("focus", () => setFocus(el.dataset.i));
    el.addEventListener("click", (e) => {
      e.preventDefault();
      locked = locked === el.dataset.i ? null : el.dataset.i;
      if (locked !== null) setFocus(locked);
      else clearFocus();
    });
  };

  hits.forEach((h) => {
    h.setAttribute("tabindex", "0");
    h.setAttribute("role", "button");
    h.setAttribute("aria-label", `${h.dataset.label}: ${h.dataset.pct}%`);
    bind(h);
  });
  legend.forEach(bind);

  stage.addEventListener("mouseleave", () => {
    if (locked === null) clearFocus();
  });

  section.addEventListener("keydown", (e) => {
    if (e.key === "Escape") clearFocus();
  });
}

const revealRootMargin = window.innerWidth <= 860 ? "0px 0px -3% 0px" : "0px 0px -6% 0px";

if ("IntersectionObserver" in window) {
  applyStaggerDelays();

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.06, rootMargin: revealRootMargin },
  );
  document.querySelectorAll(".reveal-on").forEach((el) => io.observe(el));

  document.querySelectorAll(".page-visual").forEach((el) => {
    const visualIo = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("in-view");
          visualIo.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" },
    );
    visualIo.observe(el);
  });

  const chartSection = document.getElementById("archive-chart");
  if (chartSection) {
    initArchiveChartInteraction(chartSection);
    const chartIo = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          animateArchiveChart(chartSection);
          chartIo.disconnect();
        }
      },
      { threshold: 0.18 },
    );
    chartIo.observe(chartSection);
  }
} else {
  document.querySelectorAll(".reveal-on").forEach((el) => el.classList.add("in"));
  document.querySelectorAll(".page-visual").forEach((el) => el.classList.add("in-view"));
  const chartSection = document.getElementById("archive-chart");
  if (chartSection) {
    initArchiveChartInteraction(chartSection);
    animateArchiveChart(chartSection);
  }
}

function initHeroSlideshows() {
  document.querySelectorAll("[data-hero-slideshow]").forEach((root) => {
    const slides = [...root.querySelectorAll(".land-slide")];
    if (slides.length < 2) return;

    slides.forEach((img) => {
      if (!img.src || img.complete) return;
      const pre = new Image();
      pre.src = img.src;
    });

    let idx = 0;
    const tick = () => {
      slides[idx].classList.remove("is-active");
      idx = (idx + 1) % slides.length;
      slides[idx].classList.add("is-active");
    };
    if (!reducedMotion) window.setInterval(tick, 3000);
  });
}

function initVinRecordShowcases() {
  document.querySelectorAll("[data-vin-record]").forEach((stage) => {
    const keys = [...stage.querySelectorAll(".vin-rec-key")];
    const panels = [...stage.querySelectorAll(".vin-rec-panel")];
    const railSegs = [...stage.querySelectorAll(".vin-rec-rail-seg")];
    if (!keys.length || !panels.length) return;

    stage.classList.add("is-ready");

    const activate = (keyId) => {
      if (!keyId) return;
      const activeIdx = keys.findIndex((b) => b.dataset.vinKey === keyId);

      keys.forEach((btn) => {
        const on = btn.dataset.vinKey === keyId;
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
        btn.tabIndex = on ? 0 : -1;
      });

      panels.forEach((panel) => {
        const on = panel.dataset.vinPanel === keyId;
        panel.classList.toggle("is-on", on);
        if (on) panel.removeAttribute("hidden");
        else panel.setAttribute("hidden", "");
      });

      railSegs.forEach((seg, i) => {
        const match = seg.dataset.vinRail === keyId;
        seg.classList.toggle("is-on", match);
        seg.classList.toggle("is-done", activeIdx >= 0 && i < activeIdx);
      });
    };

    keys.forEach((btn) => {
      btn.addEventListener("click", () => activate(btn.dataset.vinKey));
    });

    const tablist = stage.querySelector(".vin-rec-keys");
    tablist?.addEventListener("keydown", (e) => {
      const current = keys.findIndex((b) => b.classList.contains("is-on"));
      if (current < 0) return;
      let next = -1;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (current + 1) % keys.length;
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (current - 1 + keys.length) % keys.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = keys.length - 1;
      else return;
      e.preventDefault();
      const btn = keys[next];
      btn.focus();
      activate(btn.dataset.vinKey);
    });

    const initial = keys.find((b) => b.classList.contains("is-on"))?.dataset.vinKey || keys[0]?.dataset.vinKey;
    if (initial) activate(initial);
  });
}

initHeroSlideshows();
initVinRecordShowcases();

const ACCESS_CTA_RE = /^(get api key|get a key|request access)$/i;

function isAccessCtaLink(el) {
  if (!(el instanceof HTMLAnchorElement)) return false;
  if (el.dataset.accessCta !== undefined) return true;
  const href = (el.getAttribute("href") || "").split("#")[0];
  if (!/^\/account\/?(\?.*)?$/.test(href)) return false;
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  return ACCESS_CTA_RE.test(text);
}

function initPortalAccessCtas() {
  const onAccount = location.pathname.replace(/\/+$/, "") === "/account";

  document.addEventListener(
    "click",
    (e) => {
      const link = e.target.closest("a");
      if (!link || !isAccessCtaLink(link)) return;

      if (onAccount) {
        e.preventDefault();
        if (!location.search.includes("key=1")) {
          history.replaceState(null, "", "/account/?key=1");
        }
        window.dispatchEvent(new CustomEvent("portal-access-request"));
        return;
      }

      const href = link.getAttribute("href") || "/account/?key=1";
      if (!href.includes("key=1")) {
        e.preventDefault();
        location.href = "/account/?key=1";
      }
    },
    true,
  );
}

initPortalAccessCtas();
