import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  Search,
  SlidersHorizontal,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  MapPin,
  Fuel,
  Gauge,
  Database,
  Zap,
  X,
} from "lucide-react";
import { LiveFeedTestShell } from "@/components/layout/live-feed-test-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  browseLiveFeedVehicles,
  peekLiveBrowseCache,
  fetchLiveFeedCapabilities,
  filterIsSupported,
  formatKm,
  encarPhotoUrl,
  liveVehicleHref,
  rememberLiveVehicleSnapshot,
  type LiveVehicle,
  type LiveVehicleFilters,
  type LiveFeedCapabilities,
  type LiveFeedFilterOptions,
} from "@/lib/live-feed-api";
import { PriceDisplay } from "@/components/price-display";
import { cn } from "@/lib/utils";
import {
  ENGINE_STEPS,
  KRW_PRICE_STEPS,
  MILEAGE_STEPS,
  USD_PRICE_STEPS,
  YEAR_OPTIONS,
  formatEngineFilter,
  formatPriceFilter,
  makesForCarType,
  modelsForMake,
} from "@/lib/live-feed-catalog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";

const PAGE_SIZE = 12;
const WARM_CACHE_SKIP_MS = 90_000;

function sanitizeFiltersForFeed(
  internalName: string | undefined,
  next: LiveVehicleFilters,
): LiveVehicleFilters {
  if (internalName === "combined_live") {
    const filters = { ...next };
    if (filters.priceMin != null && filters.priceMin >= 500_000) filters.priceMin = undefined;
    if (filters.priceMax != null && filters.priceMax >= 500_000) filters.priceMax = undefined;
    return filters;
  }
  if (internalName !== "autowini_live") return next;
  const filters = { ...next };
  if (filters.priceMin != null && filters.priceMin >= 500_000) filters.priceMin = undefined;
  if (filters.priceMax != null && filters.priceMax >= 500_000) filters.priceMax = undefined;
  if (filters.carType) filters.carType = undefined;
  return filters;
}

function parseFiltersFromUrl(search: string, combined = false): LiveVehicleFilters {
  const p = new URLSearchParams(search);
  const num = (k: string) => {
    const v = p.get(k);
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    search: p.get("search") || undefined,
    make: p.get("make") || undefined,
    model: p.get("model") || undefined,
    modelGroup: p.get("modelGroup") || undefined,
    badgeGroup: p.get("badgeGroup") || undefined,
    fuel: p.get("fuel") || undefined,
    transmission: p.get("transmission") || undefined,
    drivetrain: p.get("drivetrain") || undefined,
    bodyType: p.get("bodyType") || undefined,
    color: p.get("color") || undefined,
    carType: (p.get("carType") as LiveVehicleFilters["carType"]) || (combined ? "all" : "import"),
    location: p.get("location") || undefined,
    yearFrom: num("yearFrom"),
    yearTo: num("yearTo"),
    priceMin: num("priceMin"),
    priceMax: num("priceMax"),
    mileageMin: num("mileageMin"),
    mileageMax: num("mileageMax"),
    engineMin: num("engineMin"),
    engineMax: num("engineMax"),
    sortBy: (p.get("sortBy") as LiveVehicleFilters["sortBy"]) || "createdDate",
    sortOrder: (p.get("sortOrder") as LiveVehicleFilters["sortOrder"]) || "desc",
    offset: num("offset") ?? 0,
    limit: PAGE_SIZE,
  };
}

function parseFeedParam(raw?: string): LiveFeedId | null {
  if (raw === "all" || raw === "combined") return "combined";
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function sourceLabel(internalName?: string) {
  if (internalName === "encar_live") return "Encar";
  if (internalName === "autowini_live") return "Autowini";
  if (internalName === "kbchachacha_live") return "KB";
  return internalName ?? "Live";
}

function isUsdFeed(internalName?: string) {
  return internalName === "autowini_live" || internalName === "combined_live";
}

function filtersToUrl(filters: LiveVehicleFilters): string {
  const p = new URLSearchParams();
  const set = (k: string, v: string | number | undefined) => {
    if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
  };
  set("search", filters.search);
  set("make", filters.make);
  set("model", filters.model);
  set("modelGroup", filters.modelGroup);
  set("badgeGroup", filters.badgeGroup);
  set("fuel", filters.fuel);
  set("transmission", filters.transmission);
  set("drivetrain", filters.drivetrain);
  set("bodyType", filters.bodyType);
  set("color", filters.color);
  set("carType", filters.carType);
  set("location", filters.location);
  set("yearFrom", filters.yearFrom);
  set("yearTo", filters.yearTo);
  set("priceMin", filters.priceMin);
  set("priceMax", filters.priceMax);
  set("mileageMin", filters.mileageMin);
  set("mileageMax", filters.mileageMax);
  set("engineMin", filters.engineMin);
  set("engineMax", filters.engineMax);
  set("sortBy", filters.sortBy ?? "createdDate");
  set("sortOrder", filters.sortOrder ?? "desc");
  if (filters.offset && filters.offset > 0) set("offset", filters.offset);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    AVAILABLE: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    RESERVED: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    SOLD: "bg-slate-500/20 text-slate-400 border-slate-500/30",
    REMOVED: "bg-red-500/20 text-red-300 border-red-500/30",
    UNKNOWN: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };
  return styles[status] ?? styles.UNKNOWN;
}

export default function LiveFeedTestPage() {
  const [, params] = useRoute("/live-feeds/:id/test");
  const feedId = parseFeedParam(params?.id);
  const combined = feedId === "combined";

  const [filters, setFilters] = useState<LiveVehicleFilters>(() =>
    parseFiltersFromUrl(typeof window !== "undefined" ? window.location.search : "", combined),
  );
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const [showFilters, setShowFilters] = useState(false);
  const [bypassCache, setBypassCache] = useState(false);

  const [feedMeta, setFeedMeta] = useState<{ name: string; internalName: string; isEnabled?: boolean } | null>(null);
  const [capabilities, setCapabilities] = useState<LiveFeedCapabilities | null>(null);
  const [filterOptions, setFilterOptions] = useState<LiveFeedFilterOptions | null>(null);
  const [vehicles, setVehicles] = useState<LiveVehicle[]>([]);
  const [total, setTotal] = useState(0);
  const [cached, setCached] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [sourceNotes, setSourceNotes] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const offset = filters.offset ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const syncUrl = useCallback(
    (next: LiveVehicleFilters) => {
      const qs = filtersToUrl(next);
      const nextUrl = `${window.location.pathname}${qs}`;
      if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
        window.history.replaceState(window.history.state, "", nextUrl);
      }
    },
    [],
  );

  const updateFilters = useCallback(
    (patch: Partial<LiveVehicleFilters>, resetPage = true) => {
      setFilters((prev) => {
        const next = {
          ...prev,
          ...patch,
          limit: PAGE_SIZE,
          offset: resetPage ? 0 : (patch.offset ?? prev.offset ?? 0),
        };
        syncUrl(next);
        return next;
      });
    },
    [syncUrl],
  );

  const loadVehicles = useCallback(async (force = false) => {
    if (feedId == null) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    const useBypass = force || bypassCache;
    const queryFilters = sanitizeFiltersForFeed(combined ? "combined_live" : feedMeta?.internalName, filters);
    if (!useBypass) {
      const warm = peekLiveBrowseCache(feedId, queryFilters);
      if (warm?.response.data) {
        setVehicles(warm.response.data.vehicles);
        setTotal(warm.response.data.total);
        setCached(true);
        setCachedAt(warm.response.data.cachedAt);
        setFeedMeta(warm.response.data.provider);
        setLoading(false);
        if (warm.ageMs < WARM_CACHE_SKIP_MS) {
          setRefreshing(false);
          return;
        }
        setRefreshing(true);
      }
    }
    setVehicles((current) => {
      if (current.length === 0) setLoading(true);
      else setRefreshing(true);
      return current;
    });
    try {
      const res = await browseLiveFeedVehicles(
        feedId,
        queryFilters,
        { bypassCache: useBypass, signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      setVehicles(res.data.vehicles);
      setTotal(res.data.total);
      setCached(res.data.cached);
      setCachedAt(res.data.cachedAt);
      setFeedMeta(res.data.provider);
      const failed = (res.data.sources ?? []).filter((s) => s.error);
      const ok = (res.data.sources ?? []).filter((s) => !s.error);
      if (res.data.sources?.length) {
        const names = ok.map((s) => sourceLabel(s.internalName)).join(", ");
        const warn = failed.map((s) => `${sourceLabel(s.internalName)}: ${s.error}`).join(" · ");
        setSourceNotes(warn ? `${names || "No sources"} · ${warn}` : names);
      } else {
        setSourceNotes(null);
      }
    } catch (err) {
      if (ac.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [feedId, filters, bypassCache, combined]);

  useEffect(() => {
    if (feedId == null) return;
    fetchLiveFeedCapabilities(feedId)
      .then((c) => {
        setFeedMeta({ name: c.provider.name, internalName: c.provider.internalName, isEnabled: c.provider.isEnabled });
        setCapabilities(c.capabilities);
        setFilterOptions(c.filterOptions);
      })
      .catch(() => {});
  }, [feedId]);

  useEffect(() => {
    if (feedId == null || !filters.make) {
      setRemoteModels([]);
      return;
    }
    let cancelled = false;
    fetchLiveFeedCapabilities(feedId, { make: filters.make, carType: filters.carType })
      .then((c) => {
        if (cancelled) return;
        if (c.filterOptions?.models?.length) setRemoteModels(c.filterOptions.models);
        else setRemoteModels([]);
      })
      .catch(() => {
        if (!cancelled) setRemoteModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [feedId, filters.make, filters.carType]);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  useEffect(() => {
    const onPop = () => {
      const next = parseFiltersFromUrl(window.location.search, combined);
      setFilters(next);
      setSearchInput(next.search ?? "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = searchInput.trim() || undefined;
      if (next !== (filters.search || undefined)) updateFilters({ search: next });
    }, 400);
    return () => window.clearTimeout(t);
  }, [searchInput, filters.search, updateFilters]);

  const clearFilters = () => {
    setSearchInput("");
    updateFilters({
      search: undefined,
      make: undefined,
      model: undefined,
      modelGroup: undefined,
      badgeGroup: undefined,
      fuel: undefined,
      transmission: undefined,
      drivetrain: undefined,
      bodyType: undefined,
      color: undefined,
      carType: combined ? "all" : "import",
      location: undefined,
      yearFrom: undefined,
      yearTo: undefined,
      priceMin: undefined,
      priceMax: undefined,
      mileageMin: undefined,
      mileageMax: undefined,
      engineMin: undefined,
      engineMax: undefined,
      sortBy: "createdDate",
      sortOrder: "desc",
    });
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.search) n++;
    if (filters.make) n++;
    if (filters.model) n++;
    if (filters.modelGroup) n++;
    if (filters.badgeGroup) n++;
    if (filters.fuel) n++;
    if (filters.transmission) n++;
    if (filters.location) n++;
    if (filters.yearFrom != null) n++;
    if (filters.yearTo != null) n++;
    if (filters.priceMin != null) n++;
    if (filters.priceMax != null) n++;
    if (filters.mileageMin != null) n++;
    if (filters.mileageMax != null) n++;
    if (filters.engineMin != null) n++;
    if (filters.engineMax != null) n++;
    if (filters.drivetrain) n++;
    if (filters.bodyType) n++;
    if (filters.color) n++;
    if (filters.carType && filters.carType !== (combined ? "all" : "import")) n++;
    return n;
  }, [filters, combined]);

  const activePills = useMemo(() => {
    const pills: Array<{ key: string; label: string; clear: () => void }> = [];
    const drop = (patch: Partial<LiveVehicleFilters>) => updateFilters(patch);
    if (filters.search) {
      pills.push({
        key: "search",
        label: `Search: ${filters.search}`,
        clear: () => {
          setSearchInput("");
          drop({ search: undefined });
        },
      });
    }
    if (filters.make) pills.push({ key: "make", label: filters.make, clear: () => drop({ make: undefined }) });
    if (filters.modelGroup) pills.push({ key: "modelGroup", label: filters.modelGroup, clear: () => drop({ modelGroup: undefined }) });
    if (filters.model) pills.push({ key: "model", label: filters.model, clear: () => drop({ model: undefined }) });
    if (filters.badgeGroup) pills.push({ key: "badgeGroup", label: filters.badgeGroup, clear: () => drop({ badgeGroup: undefined }) });
    if (filters.fuel) pills.push({ key: "fuel", label: filters.fuel, clear: () => drop({ fuel: undefined }) });
    if (filters.transmission) pills.push({ key: "transmission", label: filters.transmission, clear: () => drop({ transmission: undefined }) });
    if (filters.location) pills.push({ key: "location", label: filters.location, clear: () => drop({ location: undefined }) });
    if (filters.yearFrom != null || filters.yearTo != null) {
      pills.push({
        key: "year",
        label: [filters.yearFrom ?? "…", filters.yearTo ?? "…"].join("–"),
        clear: () => drop({ yearFrom: undefined, yearTo: undefined }),
      });
    }
    const usd = isUsdFeed(feedMeta?.internalName);
    if (filters.priceMin != null) {
      pills.push({
        key: "priceMin",
        label: `From ${formatPriceFilter(filters.priceMin, usd)}`,
        clear: () => drop({ priceMin: undefined }),
      });
    }
    if (filters.priceMax != null) {
      pills.push({
        key: "priceMax",
        label: `To ${formatPriceFilter(filters.priceMax, usd)}`,
        clear: () => drop({ priceMax: undefined }),
      });
    }
    if (filters.mileageMin != null) pills.push({ key: "mileageMin", label: `Min ${filters.mileageMin.toLocaleString()} km`, clear: () => drop({ mileageMin: undefined }) });
    if (filters.mileageMax != null) pills.push({ key: "mileageMax", label: `Max ${filters.mileageMax.toLocaleString()} km`, clear: () => drop({ mileageMax: undefined }) });
    if (filters.engineMin != null) {
      pills.push({
        key: "engineMin",
        label: `From ${formatEngineFilter(filters.engineMin)}`,
        clear: () => drop({ engineMin: undefined }),
      });
    }
    if (filters.engineMax != null) {
      pills.push({
        key: "engineMax",
        label: `To ${formatEngineFilter(filters.engineMax)}`,
        clear: () => drop({ engineMax: undefined }),
      });
    }
    if (filters.drivetrain) pills.push({ key: "drivetrain", label: filters.drivetrain, clear: () => drop({ drivetrain: undefined }) });
    if (filters.bodyType) pills.push({ key: "bodyType", label: filters.bodyType, clear: () => drop({ bodyType: undefined }) });
    if (filters.color) pills.push({ key: "color", label: filters.color, clear: () => drop({ color: undefined }) });
    if (filters.carType && filters.carType !== (combined ? "all" : "import")) {
      pills.push({
        key: "carType",
        label: filters.carType,
        clear: () => drop({ carType: combined ? "all" : "import" }),
      });
    }
    return pills;
  }, [filters, updateFilters, feedMeta?.internalName]);

  const catalogMakes = makesForCarType(
    feedMeta?.internalName === "autowini_live" ||
      feedMeta?.internalName === "kbchachacha_live" ||
      feedMeta?.internalName === "combined_live"
      ? filters.carType === "import" || filters.carType === "domestic"
        ? filters.carType
        : "all"
      : filters.carType,
  );
  const makeOptions =
    (feedMeta?.internalName === "autowini_live" || feedMeta?.internalName === "combined_live") &&
    filterOptions?.makes?.length
      ? filterOptions.makes
      : catalogMakes;
  const modelOptions = remoteModels.length ? remoteModels : modelsForMake(filters.make);

  if (feedId == null) {
    return (
      <LiveFeedTestShell showAllFeedsLink={!combined}>
        <div className="max-w-lg mx-auto mt-24 text-center text-slate-400">
          Invalid feed ID. <a href="/live-feeds" className="text-sky-400 hover:underline">Back to Live Feeds</a>
        </div>
      </LiveFeedTestShell>
    );
  }

  const headerExtra = (
    <>
      <label className="hidden md:flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
        <input
          type="checkbox"
          checked={bypassCache}
          onChange={(e) => setBypassCache(e.target.checked)}
          className="rounded border-white/20 bg-slate-800 w-4 h-4"
        />
        Bypass cache
      </label>
      <Button
        size="sm"
        variant="outline"
        className="touch-target border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white gap-1.5 h-9 px-3"
        onClick={() => void loadVehicles(true)}
        disabled={loading && vehicles.length === 0}
      >
        <RefreshCw className={cn("w-4 h-4", (loading || refreshing) && "animate-spin")} />
        <span className="hidden sm:inline">Refresh</span>
      </Button>
    </>
  );

  return (
    <LiveFeedTestShell
      feedName={feedMeta?.name ?? (combined ? "All enabled feeds" : undefined)}
      headerExtra={headerExtra}
      showAllFeedsLink={!combined}
    >
      <div className="live-test">
      {refreshing && <div className="live-progress sticky top-12 sm:top-14 z-30" />}

      <div className="sticky top-12 sm:top-14 z-20 border-b border-white/10 bg-slate-950/95 backdrop-blur-md">
        <div className="max-w-[1400px] mx-auto px-3 sm:px-4 lg:px-8 py-2.5 sm:py-3 space-y-2.5">
          <div className="flex flex-col lg:flex-row gap-2">
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              updateFilters({ search: searchInput.trim() || undefined });
            }}
          >
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={
                  feedMeta?.internalName === "encar_live"
                    ? "BMW 5 Series, E-Class, Seoul…"
                    : "Search make, model, location…"
                }
                className="pl-10 pr-16 h-11 rounded-xl text-base bg-slate-900 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-sky-500/40"
              />
              {searchInput ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500"
                  onClick={() => {
                    setSearchInput("");
                    updateFilters({ search: undefined });
                  }}
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : null}
            </div>
          </form>
          <div className="flex gap-2 lg:w-auto">
            <Button
              variant="outline"
              className="flex-1 lg:hidden h-11 border-white/10 bg-slate-900 text-slate-200 gap-2"
              onClick={() => setShowFilters(true)}
            >
              <SlidersHorizontal className="w-4 h-4 shrink-0" />
              Filters
              {activeFilterCount > 0 && (
                <span className="bg-sky-600 text-white text-[11px] min-w-[1.25rem] h-5 px-1.5 rounded-full inline-flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            <label className="relative flex-1 lg:flex-none lg:w-52">
              <select
                value={`${filters.sortBy ?? "createdDate"}:${filters.sortOrder ?? "desc"}`}
                onChange={(e) => {
                  const [sortBy, sortOrder] = e.target.value.split(":") as [
                    LiveVehicleFilters["sortBy"],
                    LiveVehicleFilters["sortOrder"],
                  ];
                  updateFilters({ sortBy, sortOrder });
                }}
                className="w-full h-11 appearance-none rounded-xl border border-white/10 bg-slate-900 pl-3 pr-9 text-sm text-slate-200"
              >
                <option value="createdDate:desc">Newest</option>
                <option value="price:asc">Price: low</option>
                <option value="price:desc">Price: high</option>
                <option value="year:desc">Year: newest</option>
                <option value="mileage:asc">Mileage: lowest</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            </label>
          </div>
          </div>
          {activePills.length > 0 && (
            <div className="flex gap-2 items-center overflow-x-auto chip-scroll pb-0.5">
              {activePills.map((pill) => (
                <button
                  key={pill.key}
                  type="button"
                  onClick={pill.clear}
                  className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs bg-sky-500/15 text-sky-100 border border-sky-400/25 shrink-0"
                >
                  {pill.label}
                  <X className="w-3 h-3 opacity-70" />
                </button>
              ))}
              <button type="button" onClick={clearFilters} className="text-xs text-slate-500 shrink-0 px-1">
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

        <Sheet open={showFilters} onOpenChange={setShowFilters}>
          <SheetContent
            side="bottom"
            className="lg:hidden rounded-t-2xl border-white/10 bg-slate-950 text-white p-0 max-h-[min(86dvh,680px)] h-[min(86dvh,680px)] flex flex-col min-h-0 overflow-hidden safe-bottom [&>button.absolute]:hidden data-[state=open]:duration-200 data-[state=closed]:duration-150"
          >
            <SheetHeader className="px-4 pt-3 pb-3 border-b border-white/10 text-left shrink-0">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              <SheetTitle className="text-white text-base">Filters</SheetTitle>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
              <FilterPanel
                filters={filters}
                capabilities={capabilities}
                filterOptions={filterOptions}
                makeOptions={makeOptions}
                modelOptions={modelOptions}
                internalName={feedMeta?.internalName}
                onChange={updateFilters}
                onClear={clearFilters}
                activeCount={activeFilterCount}
              />
            </div>
            <SheetFooter className="p-3 border-t border-white/10 shrink-0">
              <Button
                className="w-full h-12 bg-sky-600 hover:bg-sky-500 text-white rounded-xl"
                onClick={() => setShowFilters(false)}
              >
                Show {total.toLocaleString()} results
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <div className="max-w-[1400px] mx-auto px-3 sm:px-4 lg:px-8 py-4 lg:py-5 pb-8">
        <div className="flex gap-6 lg:gap-8">
          <aside className="hidden lg:block w-[280px] shrink-0">
            <div className="lg:sticky lg:top-[7.5rem] max-h-[calc(100dvh-8rem)] overflow-y-auto overscroll-contain pr-1">
            <FilterPanel
              filters={filters}
              capabilities={capabilities}
              filterOptions={filterOptions}
              makeOptions={makeOptions}
              modelOptions={modelOptions}
              internalName={feedMeta?.internalName}
              onChange={updateFilters}
              onClear={clearFilters}
              activeCount={activeFilterCount}
            />
            </div>
          </aside>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-3 text-xs text-slate-500">
              <span className="text-slate-200 font-semibold text-sm tabular-nums">
                {total.toLocaleString()} listings
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-500">
                <Database className="w-3 h-3" />
                {cached ? "Cached" : "Live"}
                {cachedAt ? ` · ${new Date(cachedAt).toLocaleTimeString()}` : ""}
              </span>
            </div>
            {error && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
                {error}
              </div>
            )}
            {sourceNotes && combined && (
              <div className="mb-3 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
                Merged from {sourceNotes}
              </div>
            )}
            {feedMeta?.isEnabled === false && (
              <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200">
                This live provider is currently disabled, so empty or stale results are expected until it is re-enabled.
              </div>
            )}

            {loading && vehicles.length === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-72 rounded-3xl bg-slate-900/60 animate-pulse border border-white/5" />
                ))}
              </div>
            ) : vehicles.length === 0 ? (
              <div className="text-center py-20 px-4 rounded-3xl border border-white/10 bg-slate-900/40">
                <Zap className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="font-medium text-slate-200">
                  {error ? "Could not load listings" : "No vehicles match your filters"}
                </p>
                <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                  {error
                    ? "The live source timed out or is blocked. Try refresh, or wait a moment and search again."
                    : "Widen the year, price, or make filters to see more cars."}
                </p>
                <Button variant="link" className="text-sky-400 mt-2" onClick={clearFilters}>
                  Clear filters
                </Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                  {vehicles.map((v, i) => (
                    <MemoVehicleCard
                      key={`${v.sourceProvider?.id ?? "src"}:${v.listingId}`}
                      vehicle={v}
                      priority={i < 2}
                      href={liveVehicleHref(params?.id ?? feedId ?? "all", v.listingId, v.sourceProvider?.id)}
                      onOpen={() => feedId != null && rememberLiveVehicleSnapshot(feedId, v)}
                    />
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between sm:justify-center gap-3 mt-5">
                    <Button
                      variant="outline"
                      disabled={page <= 1}
                      className="flex-1 lg:flex-none border-white/10 bg-slate-900 text-slate-300 h-11 lg:h-9"
                      onClick={() => updateFilters({ offset: Math.max(0, offset - PAGE_SIZE) }, false)}
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </Button>
                    <span className="text-sm text-slate-400 font-mono shrink-0 tabular-nums">
                      {page} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      disabled={page >= totalPages}
                      className="flex-1 lg:flex-none border-white/10 bg-slate-900 text-slate-300 h-11 lg:h-9"
                      onClick={() => updateFilters({ offset: offset + PAGE_SIZE }, false)}
                    >
                      <ChevronRight className="w-5 h-5" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      </div>
    </LiveFeedTestShell>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-1.5 rounded-lg text-xs font-medium border shrink-0",
        active
          ? "bg-sky-600/25 border-sky-500/40 text-sky-100"
          : "bg-slate-950 border-white/10 text-slate-400",
      )}
    >
      {label}
    </button>
  );
}

function DebouncedInput({
  value,
  onCommit,
  delay = 450,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value?: string | number;
  onCommit: (value: string) => void;
  delay?: number;
}) {
  const [local, setLocal] = useState(value == null ? "" : String(value));
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    setLocal(value == null ? "" : String(value));
  }, [value]);

  const flush = useCallback(() => {
    const next = local;
    if (String(valueRef.current ?? "") !== next) onCommitRef.current(next);
  }, [local]);

  useEffect(() => {
    const t = window.setTimeout(flush, delay);
    return () => window.clearTimeout(t);
  }, [local, delay, flush]);

  return (
    <Input
      {...props}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          flush();
        }
      }}
    />
  );
}

function FilterPanel({
  filters,
  capabilities,
  filterOptions,
  makeOptions,
  modelOptions,
  internalName,
  onChange,
  onClear,
  activeCount,
}: {
  filters: LiveVehicleFilters;
  capabilities: LiveFeedCapabilities | null;
  filterOptions: LiveFeedFilterOptions | null;
  makeOptions: string[];
  modelOptions: string[];
  internalName?: string;
  onChange: (patch: Partial<LiveVehicleFilters>) => void;
  onClear: () => void;
  activeCount: number;
}) {
  const [more, setMore] = useState(false);
  const show = (key: keyof LiveVehicleFilters) => filterIsSupported(capabilities, key);
  const fuelChips = filterOptions?.fuels?.length
    ? filterOptions.fuels.slice(0, 8)
    : ["Gasoline", "Diesel", "Electric", "Hybrid", "LPG"];
  const transChips = filterOptions?.transmissions?.length
    ? filterOptions.transmissions.slice(0, 5)
    : ["Automatic", "Manual", "CVT"];
  const usdPrices = isUsdFeed(internalName);
  const priceSteps = usdPrices ? USD_PRICE_STEPS : KRW_PRICE_STEPS;
  const selectedModel = filters.modelGroup || filters.model;
  const popularMakes = makeOptions.slice(0, 6);
  const defaultCarType = internalName === "combined_live" ? "all" : "import";
  const selectCls =
    "w-full h-10 appearance-none rounded-lg border border-white/10 bg-slate-950 px-3 pr-8 text-sm text-slate-200";
  const inputCls = "h-10 bg-slate-950 border-white/10 text-white text-sm rounded-lg";

  const setMake = (make?: string) =>
    onChange({ make, model: undefined, modelGroup: undefined, badgeGroup: undefined });

  const setModel = (value?: string) => {
    if (internalName === "encar_live") onChange({ modelGroup: value, model: undefined });
    else onChange({ modelGroup: value, model: value });
  };

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Filters</h3>
        {activeCount > 0 && (
          <button type="button" onClick={onClear} className="text-xs text-sky-400">
            Clear ({activeCount})
          </button>
        )}
      </div>

      {show("carType") && filterOptions?.carTypes?.length ? (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mb-2">Market</div>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-950 p-1 border border-white/10">
            {filterOptions.carTypes.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() =>
                  onChange({
                    carType: c.value as LiveVehicleFilters["carType"],
                    make: undefined,
                    model: undefined,
                    modelGroup: undefined,
                  })
                }
                className={cn(
                  "h-8 rounded-md text-xs font-medium",
                  (filters.carType ?? defaultCarType) === c.value ? "bg-sky-600 text-white" : "text-slate-400",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {show("make") && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mb-2">Make</div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Chip label="All" active={!filters.make} onClick={() => setMake(undefined)} />
            {popularMakes.map((m) => (
              <Chip
                key={m}
                label={m.replace("Mercedes-Benz", "Mercedes")}
                active={filters.make === m}
                onClick={() => setMake(filters.make === m ? undefined : m)}
              />
            ))}
          </div>
          <NativeSelect
            className={selectCls}
            value={filters.make ?? ""}
            onChange={(v) => setMake(v || undefined)}
          >
            <option value="">All makes</option>
            {makeOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </NativeSelect>
        </div>
      )}

      {(show("model") || show("modelGroup")) && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mb-2">Model</div>
          <NativeSelect
            className={selectCls}
            value={selectedModel ?? ""}
            onChange={(v) => setModel(v || undefined)}
            disabled={!filters.make}
          >
            <option value="">{filters.make ? "All models" : "Select a make first"}</option>
            {modelOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </NativeSelect>
        </div>
      )}

      {(show("yearFrom") || show("yearTo")) && (
        <RangeField label="Year">
          <NativeSelect
            className={selectCls}
            value={filters.yearFrom != null ? String(filters.yearFrom) : ""}
            onChange={(v) => {
              const yearFrom = v ? Number(v) : undefined;
              const yearTo = yearFrom != null && filters.yearTo != null && filters.yearTo < yearFrom
                ? yearFrom
                : filters.yearTo;
              onChange({ yearFrom, yearTo });
            }}
          >
            <option value="">From</option>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </NativeSelect>
          <NativeSelect
            className={selectCls}
            value={filters.yearTo != null ? String(filters.yearTo) : ""}
            onChange={(v) => {
              const yearTo = v ? Number(v) : undefined;
              const yearFrom = yearTo != null && filters.yearFrom != null && filters.yearFrom > yearTo
                ? yearTo
                : filters.yearFrom;
              onChange({ yearFrom, yearTo });
            }}
          >
            <option value="">To</option>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </NativeSelect>
        </RangeField>
      )}

      {(show("priceMin") || show("priceMax")) && (
        <RangeField label={usdPrices ? "Price (USD)" : "Price"}>
          <NativeSelect
            className={selectCls}
            value={filters.priceMin != null ? String(filters.priceMin) : ""}
            onChange={(v) => onChange({ priceMin: v ? Number(v) : undefined })}
          >
            {priceSteps.map((s) => (
              <option key={`min-${s.label}`} value={s.value ?? ""}>{s.value ? `From ${s.label}` : "From"}</option>
            ))}
          </NativeSelect>
          <NativeSelect
            className={selectCls}
            value={filters.priceMax != null ? String(filters.priceMax) : ""}
            onChange={(v) => onChange({ priceMax: v ? Number(v) : undefined })}
          >
            {priceSteps.map((s) => (
              <option key={`max-${s.label}`} value={s.value ?? ""}>{s.value ? `To ${s.label}` : "To"}</option>
            ))}
          </NativeSelect>
        </RangeField>
      )}

      <RangeField label="Engine">
        <NativeSelect
          className={selectCls}
          value={filters.engineMin != null ? String(filters.engineMin) : ""}
          onChange={(v) => onChange({ engineMin: v ? Number(v) : undefined })}
        >
          {ENGINE_STEPS.map((s) => (
            <option key={`emin-${s.label}`} value={s.value ?? ""}>{s.value ? `From ${s.label}` : "From"}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          className={selectCls}
          value={filters.engineMax != null ? String(filters.engineMax) : ""}
          onChange={(v) => onChange({ engineMax: v ? Number(v) : undefined })}
        >
          {ENGINE_STEPS.map((s) => (
            <option key={`emax-${s.label}`} value={s.value ?? ""}>{s.value ? `To ${s.label}` : "To"}</option>
          ))}
        </NativeSelect>
      </RangeField>

      {(show("mileageMin") || show("mileageMax")) && (
        <RangeField label="Mileage">
          <NativeSelect
            className={selectCls}
            value={filters.mileageMin != null ? String(filters.mileageMin) : ""}
            onChange={(v) => onChange({ mileageMin: v ? Number(v) : undefined })}
          >
            {MILEAGE_STEPS.map((s) => (
              <option key={`mmin-${s.label}`} value={s.value ?? ""}>{s.value ? `From ${s.label}` : "From"}</option>
            ))}
          </NativeSelect>
          <NativeSelect
            className={selectCls}
            value={filters.mileageMax != null ? String(filters.mileageMax) : ""}
            onChange={(v) => onChange({ mileageMax: v ? Number(v) : undefined })}
          >
            {MILEAGE_STEPS.map((s) => (
              <option key={`mmax-${s.label}`} value={s.value ?? ""}>{s.value ? `To ${s.label}` : "To"}</option>
            ))}
          </NativeSelect>
        </RangeField>
      )}

      {show("fuel") && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mb-2">Fuel</div>
          <div className="flex flex-wrap gap-1.5">
            <Chip label="All" active={!filters.fuel} onClick={() => onChange({ fuel: undefined })} />
            {fuelChips.map((f) => (
              <Chip
                key={f}
                label={f}
                active={filters.fuel === f}
                onClick={() => onChange({ fuel: filters.fuel === f ? undefined : f })}
              />
            ))}
          </div>
        </div>
      )}

      {show("transmission") && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mb-2">Transmission</div>
          <div className="flex flex-wrap gap-1.5">
            {transChips.map((t) => (
              <Chip
                key={t}
                label={t}
                active={filters.transmission === t}
                onClick={() => onChange({ transmission: filters.transmission === t ? undefined : t })}
              />
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        className="flex items-center justify-between w-full text-xs text-slate-400 py-1"
      >
        More filters
        <ChevronDown className={cn("w-4 h-4 transition-transform duration-150", more && "rotate-180")} />
      </button>

      {more && (
        <div className="space-y-3 pt-1">
          {show("model") && (
            <Field label="Trim / exact model">
              <DebouncedInput
                value={filters.model && filters.model !== filters.modelGroup ? filters.model : ""}
                onCommit={(v) => onChange({ model: v || undefined })}
                placeholder="e.g. 520d, M Sport"
                className={inputCls}
              />
            </Field>
          )}
          {show("badgeGroup") && (
            <Field label="Badge group">
              <DebouncedInput
                value={filters.badgeGroup ?? ""}
                onCommit={(v) => onChange({ badgeGroup: v || undefined })}
                placeholder="Trim group"
                className={inputCls}
              />
            </Field>
          )}
          {show("location") && (
            <Field label="Location">
              <DebouncedInput
                value={filters.location ?? ""}
                onCommit={(v) => onChange({ location: v || undefined })}
                placeholder="Seoul, Busan…"
                className={inputCls}
              />
            </Field>
          )}
          {show("drivetrain") && (
            <Field label="Drivetrain">
              <NativeSelect
                className={selectCls}
                value={filters.drivetrain ?? ""}
                onChange={(v) => onChange({ drivetrain: v || undefined })}
              >
                <option value="">Any</option>
                {(filterOptions?.drivetrains ?? ["FWD", "RWD", "AWD"]).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {show("bodyType") && (
            <Field label="Body type">
              <DebouncedInput
                value={filters.bodyType ?? ""}
                onCommit={(v) => onChange({ bodyType: v || undefined })}
                placeholder="SUV, Sedan…"
                className={inputCls}
              />
            </Field>
          )}
          {show("color") && (
            <Field label="Color">
              <DebouncedInput
                value={filters.color ?? ""}
                onCommit={(v) => onChange({ color: v || undefined })}
                placeholder="Black, White…"
                className={inputCls}
              />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

function RangeField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mb-2">{label}</div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function NativeSelect({
  className,
  value,
  onChange,
  disabled,
  children,
}: {
  className: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="relative block">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(className, disabled && "opacity-50")}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-slate-500 font-mono block mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function VehicleCard({
  vehicle: v,
  href,
  onOpen,
  priority,
}: {
  vehicle: LiveVehicle;
  href: string;
  onOpen: () => void;
  priority?: boolean;
}) {
  const photo = v.photos?.[0] ? encarPhotoUrl(v.photos[0], "card") : null;
  return (
    <Link
      href={href}
      onClick={onOpen}
      className="group text-left rounded-2xl border border-white/10 bg-slate-900/60 overflow-hidden w-full flex sm:block hover:border-sky-500/35 transition-colors"
    >
      <div className="w-28 h-24 sm:w-full sm:h-auto sm:aspect-[4/3] bg-slate-950 relative overflow-hidden shrink-0">
        {photo ? (
          <img
            src={photo}
            alt=""
            width={387}
            height={290}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={priority ? "high" : "low"}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center text-slate-600 text-xs">
            No photo
          </div>
        )}
        {v.sourceProvider && (
          <span className="absolute top-2 left-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-black/55 text-sky-100 border border-white/10">
            {sourceLabel(v.sourceProvider.internalName)}
          </span>
        )}
        <span
          className={cn(
            "absolute bottom-2 right-2 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border",
            statusBadge(v.status),
          )}
        >
          {v.status}
        </span>
      </div>
      <div className="flex-1 min-w-0 p-3 sm:p-3.5 flex flex-col gap-2">
        <div className="font-semibold text-white text-sm leading-snug line-clamp-2">
          {v.year} {v.make} {v.model}
          {v.trim ? <span className="text-slate-400 font-normal"> · {v.trim}</span> : null}
        </div>
        <div>
          {v.priceOnRequest || v.price == null ? (
            <div className="text-sm font-medium text-amber-200">Price on request</div>
          ) : (
            <PriceDisplay
              amount={v.price}
              currency={v.currency}
              usd={v.priceUsd}
              eur={v.priceEur}
              fx={v.fx}
              compact
              inverse
            />
          )}
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Gauge className="w-3 h-3" /> {formatKm(v.mileage)}
          </span>
          {v.fuel && (
            <span className="inline-flex items-center gap-1">
              <Fuel className="w-3 h-3" /> {v.fuel}
            </span>
          )}
          {v.location && (
            <span className="inline-flex items-center gap-1 truncate max-w-[10rem]">
              <MapPin className="w-3 h-3 shrink-0" /> {v.location}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

const MemoVehicleCard = React.memo(VehicleCard);
