import React, { useState, useEffect } from "react";
import { fetchVehicleDetail } from "@/lib/admin-api";
import {
  useListVehicles,
  useGetVehicleRawSources,
  useListNormalizationOverrides,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Car,
  Activity,
  Image,
  Database,
  Hash,
  MapPin,
  Gauge,
  DollarSign,
  Calendar,
  ArrowLeft,
  FileText,
  TrendingUp,
  AlertTriangle,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Filter,
  Users,
  Gavel,
  Package,
  RotateCw,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  formatDualMileage,
  formatEngineBadge,
  formatEngineDisplacement,
  formatEventDate,
} from "@/lib/format-specs";
import {
  PhotoLightbox,
  galleryFromSplitPhotos,
} from "@/components/photo-lightbox";
import { PriceDisplay } from "@/components/price-display";
import { OwnerChangesTable, type OwnerChangeRow } from "@/components/owner-changes-table";
import { AuctionSalesTable, type AuctionSaleRow } from "@/components/auction-sales-table";
import { AccidentsTable, type AccidentRow } from "@/components/accidents-table";
import {
  BodyConditionDiagram,
  type BodyCondition,
} from "@/components/body-condition-diagram";
import { SalvagePanel, type SalvageRecord } from "@/components/salvage-panel";
import { ExtraTable, type VehicleExtraRow } from "@/components/extra-table";
import { ListPager } from "@/components/list-pager";
import { PageEnter, PageHeader, Surface, FilterBar, EmptyState, ProviderChip } from "@/components/page";
import { encarPhotoUrl } from "@/lib/live-feed-api";

const SEARCH_PAGE_SIZE = 20;
const OBS_PAGE_SIZE = 50;

type VinTab =
  | "overview"
  | "sources"
  | "owners"
  | "accidents"
  | "condition"
  | "salvage"
  | "extra"
  | "mileage"
  | "prices"
  | "events"
  | "photos"
  | "photos360";

type SplitPhoto = {
  id?: number;
  url?: string;
  provider?: string;
  isPrimary?: boolean;
  sortOrder?: number;
  group?: string;
};

function isPlaceholderAccident(event: { eventType?: string; description?: string | null }): boolean {
  if (event.eventType !== "accident") return false;
  const description = String(event.description ?? "");
  return /repair ₩0/.test(description) && /payout ₩0/.test(description);
}

function isAccidentCategoryEvent(event: {
  eventType?: string;
  description?: string | null;
  metadata?: string | Record<string, unknown> | null;
}): boolean {
  const type = (event.eventType ?? "").toLowerCase();
  if (type === "accident" || type === "flood_damage") return true;
  let meta: Record<string, unknown> = {};
  if (typeof event.metadata === "string") {
    try {
      const parsed = JSON.parse(event.metadata);
      if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
    } catch {
      meta = {};
    }
  } else if (event.metadata && typeof event.metadata === "object") {
    meta = event.metadata;
  }
  const field = typeof meta.field === "string" ? meta.field.toLowerCase() : "";
  if (field === "primary_damage" || field === "secondary_damage") return true;
  return /^(primary|secondary)\s+damage\s*:/i.test(String(event.description ?? ""));
}

function isSalvageCategoryEvent(event: { eventType?: string }): boolean {
  return (event.eventType ?? "").toLowerCase() === "title_status";
}

function isBuyNowTimelineNoise(event: {
  eventType?: string;
  description?: string | null;
  metadata?: unknown;
}): boolean {
  const meta =
    typeof event.metadata === "string"
      ? (() => {
          try {
            return JSON.parse(event.metadata);
          } catch {
            return null;
          }
        })()
      : event.metadata && typeof event.metadata === "object"
        ? (event.metadata as Record<string, unknown>)
        : null;
  if (meta && String(meta.field ?? "") === "buy_now") return true;
  return /^buy\s*now\s*:/i.test(String(event.description ?? ""));
}

function isExtraCategoryEvent(event: {
  eventType?: string;
  description?: string | null;
  metadata?: unknown;
}): boolean {
  const meta =
    typeof event.metadata === "string"
      ? (() => {
          try {
            return JSON.parse(event.metadata);
          } catch {
            return null;
          }
        })()
      : event.metadata && typeof event.metadata === "object"
        ? (event.metadata as Record<string, unknown>)
        : null;
  const field = typeof meta?.field === "string" ? meta.field.toLowerCase() : "";
  if (
    field === "keys" ||
    field === "key_status" ||
    field === "airbags" ||
    field === "odometer_status" ||
    field === "runs_drives" ||
    field === "condition"
  ) {
    return true;
  }
  const desc = String(event.description ?? "");
  return /^keys available:/i.test(desc) || /^key status:/i.test(desc);
}

function displayEvents(events: any[] | undefined): any[] {
  const filtered = (events ?? []).filter(
    (event) =>
      event.eventType !== "owner_change" &&
      event.eventType !== "sale" &&
      !isAccidentCategoryEvent(event) &&
      !isSalvageCategoryEvent(event) &&
      !isExtraCategoryEvent(event) &&
      !isPlaceholderAccident(event) &&
      !isBuyNowTimelineNoise(event),
  );
  const isFirstReg = (event: any) => {
    const type = String(event.eventType ?? "").toLowerCase();
    const desc = String(event.description ?? "");
    let field = "";
    try {
      const meta = typeof event.metadata === "string" ? JSON.parse(event.metadata) : event.metadata;
      field = String(meta?.field ?? meta?.kind ?? "");
    } catch {
      /* ignore */
    }
    if (/firstRegistration|firstDate|first_reg|firstRegistrationDate/i.test(field) && type !== "inspection") {
      return true;
    }
    return /first registration/i.test(desc) && (type === "delivery" || type === "other");
  };
  const firstRegs = filtered.filter(isFirstReg);
  const rest = filtered.filter((e) => !isFirstReg(e));
  const byNewest = (a: any, b: any) => {
    const ta = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
    const tb = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
    return tb - ta;
  };
  rest.sort(byNewest);
  return firstRegs.length ? [firstRegs[0], ...rest] : rest;
}

export default function VinSearch() {
  const params = new URLSearchParams(window.location.search);
  const initialVin = params.get("vin") ?? "";

  const [searchInput, setSearchInput] = useState(initialVin);
  const [committedSearch, setCommittedSearch] = useState(initialVin);
  const [selectedVin, setSelectedVin] = useState<string>(initialVin);

  // Facet filters
  const [make, setMake] = useState("");
  const [country, setCountry] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [showFacets, setShowFacets] = useState(false);
  const [searchOffset, setSearchOffset] = useState(0);
  const [obsOffset, setObsOffset] = useState(0);

  const hasListQuery = Boolean(committedSearch || make || country || yearFrom || yearTo);

  useEffect(() => {
    setSearchOffset(0);
  }, [committedSearch, make, country, yearFrom, yearTo]);

  useEffect(() => {
    setObsOffset(0);
  }, [selectedVin]);

  useEffect(() => {
    if (selectedVin) {
      const url = new URL(window.location.href);
      url.searchParams.set("vin", selectedVin);
      window.history.replaceState({}, "", url.toString());
    }
  }, [selectedVin]);

  const { data: vehiclesList, isLoading: isSearching } = useListVehicles(
    {
      search: committedSearch || undefined,
      make: make || undefined,
      country: country || undefined,
      yearFrom: yearFrom ? parseInt(yearFrom, 10) : undefined,
      yearTo: yearTo ? parseInt(yearTo, 10) : undefined,
      limit: SEARCH_PAGE_SIZE,
      offset: searchOffset,
    },
    {
      query: {
        enabled: !selectedVin && hasListQuery,
        queryKey: ["listVehicles", committedSearch, make, country, yearFrom, yearTo, searchOffset],
      },
    },
  );

  const { data: vehicleDetail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ["getVehicle", selectedVin, obsOffset],
    queryFn: () =>
      fetchVehicleDetail(selectedVin, {
        observationsLimit: OBS_PAGE_SIZE,
        observationsOffset: obsOffset,
      }),
    enabled: !!selectedVin,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim().toUpperCase();
    if (/^[A-HJ-NPR-Z0-9]{11,17}$/.test(q)) {
      setSelectedVin(q);
      setCommittedSearch("");
      setSearchOffset(0);
      return;
    }
    setSelectedVin("");
    setCommittedSearch(q);
    setSearchOffset(0);
  };

  const handleSelectVin = (vin: string) => {
    setSelectedVin(vin);
    setSearchInput(vin);
  };

  const handleClear = () => {
    setSelectedVin("");
    setSearchInput("");
    setCommittedSearch("");
    setMake("");
    setCountry("");
    setYearFrom("");
    setYearTo("");
    const url = new URL(window.location.href);
    url.searchParams.delete("vin");
    window.history.replaceState({}, "", url.toString());
  };

  return (
    <PageEnter>
      {!selectedVin ? (
        <>
          <PageHeader
            title="VIN history"
            description="Look up a chassis to open its dedicated record — listings, prices, mileage, and photos."
          />

          <form onSubmit={handleSearch}>
            <FilterBar>
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Enter VIN, make, or model…"
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value.toUpperCase());
                  }}
                  className="pl-9 font-mono text-base sm:text-sm uppercase rounded-xl min-h-[44px] sm:min-h-9"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  inputMode="text"
                  autoFocus
                />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowFacets(!showFacets)}>
                <Filter className="w-3.5 h-3.5 mr-1.5" />
                Filters
              </Button>
              <Button type="submit" disabled={!searchInput && !make && !country && !yearFrom && !yearTo}>
                <Search className="w-4 h-4 mr-2" />
                Search
              </Button>
            </FilterBar>
          </form>
        </>
      ) : null}

      {/* Facet Filters — search mode only */}
      {!selectedVin && showFacets && (
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Make</label>
              <Input
                value={make}
                onChange={e => setMake(e.target.value)}
                placeholder="Hyundai, Kia..."
                className="text-base sm:text-xs h-10 sm:h-8"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Country</label>
              <Input
                value={country}
                onChange={e => setCountry(e.target.value)}
                placeholder="South Korea, US…"
                className="text-base sm:text-xs h-10 sm:h-8"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Year From</label>
              <Input
                type="number"
                value={yearFrom}
                onChange={e => setYearFrom(e.target.value)}
                placeholder="2015"
                className="text-base sm:text-xs h-10 sm:h-8"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Year To</label>
              <Input
                type="number"
                value={yearTo}
                onChange={e => setYearTo(e.target.value)}
                placeholder="2024"
                className="text-base sm:text-xs h-10 sm:h-8"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => { setMake(""); setCountry(""); setYearFrom(""); setYearTo(""); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear filters
              </button>
            </div>
          </div>
        </div>
      )}

      {!selectedVin && hasListQuery && (
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Search results
            </div>
            {vehiclesList?.total != null && (
              <div className="text-xs font-mono text-muted-foreground tabular-nums">
                {vehiclesList.total.toLocaleString()} match{vehiclesList.total === 1 ? "" : "es"}
              </div>
            )}
          </div>
          {isSearching ? (
            <div className="p-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
              Searching…
            </div>
          ) : !vehiclesList?.items.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No vehicles found{committedSearch ? <> for <span className="font-mono text-foreground">{committedSearch}</span></> : " for these filters"}
            </div>
          ) : (
            <div className="divide-y divide-border/80">
              {vehiclesList.items.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => handleSelectVin(v.vin)}
                  className="w-full text-left px-5 py-3.5 hover:bg-muted/30 transition-colors flex items-center justify-between gap-4 group"
                >
                  <div className="min-w-0">
                    <div className="font-mono font-semibold text-primary group-hover:underline">{v.vin}</div>
                    <div className="text-sm text-foreground mt-0.5">
                      {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Unknown Vehicle"}
                    </div>
                    {(v.fuelType || v.transmission) && (
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {[v.fuelType, v.transmission].filter(Boolean).join(" • ")}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground space-y-1 shrink-0">
                    <div className="font-mono tabular-nums">{v.listingCount ?? 0} listing{(v.listingCount ?? 0) !== 1 ? "s" : ""}</div>
                    <div className="font-mono tabular-nums">{v.observationCount ?? 0} obs.</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {vehiclesList && vehiclesList.total > SEARCH_PAGE_SIZE && (
            <ListPager
              offset={searchOffset}
              pageSize={SEARCH_PAGE_SIZE}
              total={vehiclesList.total}
              onOffsetChange={setSearchOffset}
            />
          )}
        </div>
      )}

      {/* VIN Detail View */}
      {selectedVin && (
        <VinDetail
          vin={selectedVin}
          vehicle={vehicleDetail}
          isLoading={isLoadingDetail}
          obsOffset={obsOffset}
          onObsOffsetChange={setObsOffset}
          onBack={handleClear}
        />
      )}

      {/* Empty State */}
      {!selectedVin && !hasListQuery && (
        <EmptyState
          icon={Hash}
          title="Look up a VIN"
          description="Search by chassis number or make/model to open the full history: listings, prices, mileage, and events from every source."
        />
      )}
    </PageEnter>
  );
}

function VinDetail({
  vin,
  vehicle,
  isLoading,
  obsOffset,
  onObsOffsetChange,
  onBack,
}: {
  vin: string;
  vehicle: any;
  isLoading: boolean;
  obsOffset: number;
  onObsOffsetChange: (next: number) => void;
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState<VinTab>("overview");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Button type="button" variant="outline" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground animate-pulse font-mono text-xs">
          Loading vehicle…
        </div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="space-y-4">
        <Button type="button" variant="outline" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <p className="text-muted-foreground">
            VIN <span className="font-mono text-foreground">{vin}</span> not found in the database.
          </p>
          <p className="text-sm text-muted-foreground mt-2">Run a collection job to populate vehicle data.</p>
        </div>
      </div>
    );
  }

  const visibleEvents = displayEvents(vehicle.events);
  const eventCount = visibleEvents.length;
  const ownerChanges: OwnerChangeRow[] = vehicle.ownerChanges ?? [];
  const auctionSales: AuctionSaleRow[] = vehicle.auctionSales ?? [];
  const accidents: AccidentRow[] = vehicle.accidents ?? [];
  const bodyCondition: BodyCondition | null = vehicle.bodyCondition ?? null;
  const salvage: SalvageRecord | null = vehicle.salvage ?? null;
  const extra: VehicleExtraRow[] = vehicle.extra ?? [];
  const obsList = vehicle.observations ?? [];
  const mileageCount = Array.isArray(vehicle.mileageHistory)
    ? vehicle.mileageHistory.length
    : obsList.filter((o: any) => o.mileage != null || o.mileageKm != null).length;
  const photoHint =
    (vehicle.photosNew?.length ?? 0) + (vehicle.photosOld?.length ?? 0);
  const photo360Hint =
    (vehicle.photosExterior3d?.length ?? 0) +
    (vehicle.photosExterior3dOld?.length ?? 0);

  const listingCount = vehicle.observationCount ?? obsList.length;
  const tabs: { id: VinTab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Info", icon: Car },
    { id: "photos", label: photoHint > 0 ? `Photos (${photoHint})` : "Photos", icon: Image },
    {
      id: "photos360",
      label: photo360Hint > 0 ? `360° (${photo360Hint})` : "360°",
      icon: RotateCw,
    },
    { id: "mileage", label: `Km (${mileageCount})`, icon: Gauge },
    { id: "prices", label: "Prices", icon: DollarSign },
    { id: "events", label: `Events (${eventCount})`, icon: Calendar },
    { id: "extra", label: `Extra (${extra.length})`, icon: Package },
    {
      id: "sources",
      label: `Src (${listingCount})`,
      icon: Database,
    },
    {
      id: "condition",
      label: bodyCondition ? `Body (${bodyCondition.panels.length})` : "Body",
      icon: Car,
    },
    { id: "accidents", label: `Acc (${accidents.length})`, icon: AlertTriangle },
    {
      id: "salvage",
      label: salvage ? (salvage.salvage ? "Salvage" : "Clean") : "Salvage",
      icon: ShieldAlert,
    },
    { id: "owners", label: `Owners (${ownerChanges.length})`, icon: Users },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={onBack} className="gap-2 shrink-0">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
            Vehicle record
          </div>
          <div className="font-mono text-sm sm:text-base font-semibold text-foreground truncate">
            {vehicle.vin}
          </div>
        </div>
      </div>

      <Surface className="overflow-hidden">
        <div className="relative bg-gradient-to-br from-muted/50 via-card to-card p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0 pt-0.5">
                <div className="font-mono text-xl sm:text-2xl font-semibold tracking-tight text-primary break-all">
                  {vehicle.vin}
                </div>
                <div className="text-base sm:text-lg font-semibold text-foreground mt-1">
                  {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Unknown vehicle"}
                </div>
                {vehicle.trim && (
                  <div className="text-sm text-muted-foreground font-mono mt-0.5">{vehicle.trim}</div>
                )}
                <div className="flex flex-wrap gap-1.5 mt-3 text-[11px] font-mono">
                  {vehicle.bodyType && (
                    <span className="bg-background/80 border border-border/70 px-2 py-0.5 rounded-md">{vehicle.bodyType}</span>
                  )}
                  {vehicle.fuelType && (
                    <span className="bg-background/80 border border-border/70 px-2 py-0.5 rounded-md">{vehicle.fuelType}</span>
                  )}
                  {vehicle.transmission && (
                    <span className="bg-background/80 border border-border/70 px-2 py-0.5 rounded-md">{vehicle.transmission}</span>
                  )}
                  {vehicle.driveType && (
                    <span className="bg-background/80 border border-border/70 px-2 py-0.5 rounded-md">{vehicle.driveType}</span>
                  )}
                  {vehicle.engineDisplacement && (
                    <span
                      className="bg-background/80 border border-border/70 px-2 py-0.5 rounded-md"
                      title={formatEngineDisplacement(vehicle.engineDisplacement) ?? undefined}
                    >
                      {formatEngineBadge(vehicle.engineDisplacement)}
                    </span>
                  )}
                </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-border/60">
            <div className="rounded-xl bg-background/60 border border-border/50 px-3 py-2.5">
              <div className="text-[10px] text-muted-foreground uppercase font-semibold tracking-[0.12em]">Listings</div>
              <div className="text-xl font-mono font-semibold text-foreground mt-0.5 tabular-nums">{vehicle.listingCount ?? 0}</div>
            </div>
            <div className="rounded-xl bg-background/60 border border-border/50 px-3 py-2.5">
              <div className="text-[10px] text-muted-foreground uppercase font-semibold tracking-[0.12em]">Observations</div>
              <div className="text-xl font-mono font-semibold text-foreground mt-0.5 tabular-nums">{vehicle.observationCount ?? 0}</div>
            </div>
            <div className="rounded-xl bg-background/60 border border-border/50 px-3 py-2.5">
              <div className="text-[10px] text-muted-foreground uppercase font-semibold tracking-[0.12em]">Known mileage</div>
              <div className="text-sm sm:text-base font-mono font-semibold text-foreground mt-0.5">
                {formatDualMileage(
                  (vehicle as any).currentKnownMileageKm ?? vehicle.currentKnownMileage,
                  (vehicle as any).currentKnownMileageMiles,
                ) ?? "—"}
              </div>
            </div>
            <div className="rounded-xl bg-background/60 border border-border/50 px-3 py-2.5">
              <div className="text-[10px] text-muted-foreground uppercase font-semibold tracking-[0.12em]">Last seen</div>
              <div className="text-sm font-mono text-foreground mt-0.5">
                {vehicle.lastSeenAt
                  ? new Date(vehicle.lastSeenAt).toLocaleDateString()
                  : new Date(vehicle.updatedAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>
      </Surface>

      <div className="flex gap-1 bg-muted/60 p-1 rounded-xl overflow-x-auto border border-border/60">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/80"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" && (
        <OverviewTab
          vehicle={vehicle}
          events={visibleEvents}
        />
      )}
      {activeTab === "photos" && <PhotosTab vin={vehicle.vin} />}
      {activeTab === "photos360" && <Photos360Tab vin={vehicle.vin} />}
      {activeTab === "mileage" && (
        <MileageChartTab
          history={vehicle.mileageHistory}
          observations={obsList}
        />
      )}
      {activeTab === "prices" && <PricesChartTab observations={obsList} />}
      {activeTab === "condition" &&
        (bodyCondition ? (
          <BodyConditionDiagram data={bodyCondition} />
        ) : (
          <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
            <Car className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No body-condition diagram yet.</p>
            <p className="text-xs mt-1">
              Encar diagnosis / performance inspection panel marks (Z W R C N P) appear here when collected.
            </p>
          </div>
        ))}
      {activeTab === "accidents" && <AccidentsTable rows={accidents} />}
      {activeTab === "salvage" && <SalvagePanel record={salvage} />}
      {activeTab === "events" && <EventsTab events={visibleEvents} />}
      {activeTab === "extra" && <ExtraTable rows={extra} />}
      {activeTab === "owners" && <OwnerChangesTable rows={ownerChanges} />}
      {activeTab === "sources" && (
        <SourcesTab
          vin={vehicle.vin}
          observations={obsList}
          listingTotal={listingCount}
          auctionSales={auctionSales}
          offset={obsOffset}
          pageSize={OBS_PAGE_SIZE}
          onOffsetChange={onObsOffsetChange}
        />
      )}
    </div>
  );
}

function OverviewTab({
  vehicle,
  events,
}: {
  vehicle: any;
  events: any[];
}) {
  const { data: overrides } = useListNormalizationOverrides(vehicle.id);

  const listings: Array<{
    id: number;
    providerName?: string | null;
    providerInternalName?: string | null;
    sourceUrl?: string | null;
    title?: string | null;
    isActive?: boolean | null;
  }> = vehicle.listings ?? [];

  const specs = [
    { label: "Make", value: vehicle.make },
    { label: "Model", value: vehicle.model },
    { label: "Year", value: vehicle.year },
    { label: "Trim", value: vehicle.trim },
    { label: "Body Type", value: vehicle.bodyType },
    { label: "Fuel Type", value: vehicle.fuelType },
    { label: "Transmission", value: vehicle.transmission },
    { label: "Drive Type", value: vehicle.driveType },
    {
      label: "Engine",
      value: formatEngineDisplacement(vehicle.engineDisplacement),
    },
    { label: "Color", value: vehicle.color },
    { label: "Country", value: vehicle.country },
    {
      label: "Current Mileage",
      value: formatDualMileage(
        vehicle.currentKnownMileageKm ?? vehicle.currentKnownMileage,
        vehicle.currentKnownMileageMiles,
      ),
    },
  ].filter((s) => s.value);

  const overridesMap = Object.fromEntries((overrides ?? []).map(o => [o.field, o]));
  const listingLinks = listings.filter((l) => l.sourceUrl);

  return (
    <div className="space-y-5">
      {listingLinks.length > 0 && (
        <Surface>
          <div className="px-5 py-3 border-b border-border/80 bg-muted/20">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              Source links
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Listing pages (admin only). Galleries are on the Photos / 360° tabs.
            </p>
          </div>
          <ul className="divide-y divide-border/80">
            {listingLinks.map((l) => (
              <li key={`listing-${l.id}`} className="px-5 py-2.5 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {l.providerInternalName || l.providerName || "listing"}
                </span>
                {l.isActive === false && (
                  <span className="text-[10px] uppercase text-muted-foreground">inactive</span>
                )}
                <a
                  href={l.sourceUrl!}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="min-w-0 flex-1 truncate font-mono text-xs text-primary hover:underline"
                  title={l.sourceUrl!}
                >
                  {l.title || l.sourceUrl}
                </a>
              </li>
            ))}
          </ul>
        </Surface>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:items-stretch">
      <Surface className="flex flex-col min-h-[22rem]">
        <div className="px-5 py-3 border-b border-border/80 bg-muted/20 shrink-0">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Car className="w-4 h-4" />
            Specifications
          </h3>
        </div>
        {specs.length === 0 ? (
          <div className="p-5 text-sm text-muted-foreground">No specification data available.</div>
        ) : (
          <dl className="divide-y divide-border/80 flex-1">
            {specs.map((s) => {
              const hasOverride = overridesMap[s.label.replace(" ", "")];
              return (
                <div key={s.label} className="px-5 py-2.5 flex justify-between items-center gap-3">
                  <dt className="text-sm text-muted-foreground">{s.label}</dt>
                  <dd className="flex items-center gap-1.5 text-sm font-medium text-foreground font-mono text-right">
                    {String(s.value)}
                    {hasOverride && (
                      <span title="Manually overridden" className="text-green-600 text-xs">✓</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </Surface>

      <Surface className="flex flex-col min-h-[22rem]">
        <div className="px-5 py-3 border-b border-border/80 bg-muted/20 shrink-0">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Recent events
            {events.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({events.length})</span>
            )}
          </h3>
        </div>
        {!events.length ? (
          <div className="p-5 text-sm text-muted-foreground">No recorded events.</div>
        ) : (
          <div className="divide-y divide-border/80 flex-1 overflow-y-auto max-h-[28rem]">
            {events.slice(0, 12).map((event: any) => (
              <div key={event.id} className="px-5 py-2.5">
                <div className="flex justify-between items-start gap-3">
                  <span className="text-xs font-mono font-semibold uppercase text-primary">{event.eventType}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatEventDate(event.occurredAt, event)}
                  </span>
                </div>
                {event.description && <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{event.description}</p>}
              </div>
            ))}
          </div>
        )}
      </Surface>
      </div>
    </div>
  );
}

function SourcesTab({
  vin,
  observations,
  listingTotal,
  auctionSales,
  offset,
  pageSize,
  onOffsetChange,
}: {
  vin: string;
  observations: any[];
  listingTotal: number;
  auctionSales: AuctionSaleRow[];
  offset: number;
  pageSize: number;
  onOffsetChange: (next: number) => void;
}) {
  return (
    <div className="space-y-4">
      <ListingsTab
        observations={observations}
        total={listingTotal}
        offset={offset}
        pageSize={pageSize}
        onOffsetChange={onOffsetChange}
      />
      <AuctionSalesTable rows={auctionSales} />
      <RawSourcesTab vin={vin} />
    </div>
  );
}

function ListingsTab({
  observations,
  total,
  offset,
  pageSize,
  onOffsetChange,
}: {
  observations: any[];
  total: number;
  offset: number;
  pageSize: number;
  onOffsetChange: (next: number) => void;
}) {
  if (!total) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <Activity className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No listings yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Listings ({total})
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
            <tr>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Provider</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Price</th>
              <th className="px-6 py-4 text-right">Mileage</th>
              <th className="px-6 py-4">Location</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {observations.map((obs) => (
              <tr key={obs.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-6 py-4 font-mono text-xs whitespace-nowrap">
                  {new Date(obs.observedAt).toLocaleDateString()}{" "}
                  <span className="text-muted-foreground">
                    {new Date(obs.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <ProviderChip name={obs.providerName ?? `#${obs.providerId}`} />
                </td>
                <td className="px-6 py-4">
                  {obs.listingStatus && (
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      obs.listingStatus === "active" ? "bg-green-100 text-green-700" :
                      obs.listingStatus === "sold" ? "bg-blue-100 text-blue-700" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {obs.listingStatus.toUpperCase()}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <PriceDisplay
                    amount={obs.priceAmount}
                    currency={obs.priceCurrency}
                    usd={obs.priceUsd}
                    eur={obs.priceEur}
                    fx={obs.fx}
                    compact
                  />
                </td>
                <td className="px-6 py-4 text-right font-mono text-sm">
                  {obs.mileage ? (
                    <span>
                      {formatDualMileage(obs.mileageKm ?? obs.mileage, obs.mileageMiles)}
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-6 py-4 text-sm text-muted-foreground">{obs.location ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager
        offset={offset}
        pageSize={pageSize}
        total={total}
        onOffsetChange={onOffsetChange}
      />
    </div>
  );
}

function MileageChartTab({
  history,
  observations,
}: {
  history?: Array<{
    date: string;
    mileageKm: number;
    mileageMiles?: number;
    kind?: string;
    source?: string;
    sources?: string[];
    latest?: boolean;
    tag?: string;
  }>;
  observations: any[];
}) {
  const rows =
    history && history.length > 0
      ? [...history].sort((a, b) => a.date.localeCompare(b.date))
      : observations
          .filter((o) => o.mileage != null || o.mileageKm != null)
          .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime())
          .map((o, index, all) => {
            const source = o.providerName ?? `#${o.providerId}`;
            return {
              date: new Date(o.observedAt).toISOString().slice(0, 10),
              mileageKm: o.mileageKm ?? o.mileage,
              mileageMiles: o.mileageMiles ?? (o.mileage != null ? Math.round(o.mileage * 0.621371) : undefined),
              kind: "listing",
              source,
              sources: [source],
              latest: index === all.length - 1,
              tag: index === all.length - 1 ? "latest" : undefined,
            };
          });

  const chartData = rows.map((row) => ({
    date: row.date,
    mileage: row.mileageKm,
    mileageMiles: row.mileageMiles ?? Math.round(row.mileageKm * 0.621371),
    source: row.source,
    latest: Boolean(row.latest || row.tag === "latest"),
  }));

  if (!chartData.length) {
    return (
      <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground">
        <Gauge className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No mileage data available.</p>
        <p className="text-xs mt-1">Mileage is collected from listings, owners, inspections, and accidents.</p>
      </div>
    );
  }

  const kindLabel = (kind?: string) => {
    if (kind === "owner") return "Owner";
    if (kind === "accident") return "Accident";
    if (kind === "inspection") return "Inspection";
    if (kind === "sale") return "Sale";
    if (kind === "listing") return "Listing";
    if (kind === "salvage") return "Title";
    return kind ? kind.replace(/_/g, " ") : "Record";
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-6">
          <Gauge className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Mileage Over Time</h3>
          <span className="text-xs text-muted-foreground">({chartData.length} data points)</span>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(v: number, _name, item: any) => {
                const mi = item?.payload?.mileageMiles;
                return [`${v.toLocaleString()} km${mi != null ? ` (${mi.toLocaleString()} mi)` : ""}`, "Mileage"];
              }}
              contentStyle={{ fontSize: 12 }}
            />
            <Line type="monotone" dataKey="mileage" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-3 border-b border-border bg-muted/30">
          <h3 className="font-semibold text-sm">Mileage history</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
              <tr>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3 text-right">Mileage</th>
                <th className="px-6 py-3">Source</th>
                <th className="px-6 py-3">Kind</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...rows].reverse().map((row, index) => {
                const isLatest = Boolean(row.latest || row.tag === "latest");
                return (
                  <tr key={`${row.date}-${row.mileageKm}-${index}`} className={isLatest ? "bg-primary/5" : undefined}>
                    <td className="px-6 py-3 font-mono text-xs whitespace-nowrap">{row.date}</td>
                    <td className="px-6 py-3 text-right font-mono text-xs whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        {formatDualMileage(row.mileageKm, row.mileageMiles)}
                        {isLatest && (
                          <span className="bg-primary/15 text-primary px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold">
                            Latest
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">
                      {(row.sources && row.sources.length > 0 ? row.sources : [row.source]).filter(Boolean).join(" · ")}
                    </td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">{kindLabel(row.kind)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PricesChartTab({ observations }: { observations: any[] }) {
  const chartData = observations
    .filter(o => o.priceAmount != null)
    .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime())
    .map(o => ({
      date: new Date(o.observedAt).toLocaleDateString(),
      price: o.priceUsd ?? o.priceAmount,
      nativePrice: o.priceAmount,
      currency: o.priceCurrency ?? "",
      provider: o.providerName ?? `#${o.providerId}`,
      usd: o.priceUsd,
      eur: o.priceEur,
      krw: o.priceKrw,
    }));

  if (!chartData.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <DollarSign className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No price data available.</p>
        <p className="text-xs mt-1">Price data is collected during collection jobs.</p>
      </div>
    );
  }

  const currency = "USD";

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-6">
      <div className="flex items-center gap-2 mb-6">
        <TrendingUp className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm">Price Over Time</h3>
        <span className="text-xs text-muted-foreground">({chartData.length} data points, USD normalized)</span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} tickFormatter={v => `$${Number(v).toLocaleString()}`} />
          <Tooltip
            formatter={(v: number, _name, item: any) => {
              const native = item?.payload?.nativePrice;
              const nativeCur = item?.payload?.currency;
              const eur = item?.payload?.eur;
              const krw = item?.payload?.krw;
              const extra = [
                native != null && nativeCur && nativeCur.toUpperCase() !== "USD"
                  ? `${Number(native).toLocaleString()} ${nativeCur}`
                  : null,
                eur != null ? `€${eur.toLocaleString()}` : null,
                krw != null && String(nativeCur ?? "").toUpperCase() !== "KRW"
                  ? `₩${krw.toLocaleString("ko-KR")}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return [`$${Number(v).toLocaleString()}${extra ? ` (${extra})` : ""}`, "USD"];
            }}
            contentStyle={{ fontSize: 12 }}
          />
          <Line type="monotone" dataKey="price" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function EventsTab({ events }: { events: any[] }) {
  const EVENT_ICONS: Record<string, string> = {
    sale: "🔨",
    owner_change: "👤",
    price_change: "💰",
    status_change: "🔄",
    new_listing: "🆕",
    delisted: "🚫",
  };

  if (!events.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <Calendar className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No events recorded.</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Vehicle Event Timeline ({events.length})
        </h3>
      </div>
      <div className="relative p-6">
        <div className="absolute left-10 top-6 bottom-6 w-px bg-border" />
        <div className="space-y-4">
          {events.map((event) => (
            <div key={event.id} className="flex gap-4 relative">
              <div className="w-8 h-8 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center text-sm z-10 shrink-0">
                {EVENT_ICONS[event.eventType] ?? "📋"}
              </div>
              <div className="flex-1 bg-muted/30 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold uppercase text-primary">
                    {event.eventType.replace("_", " ")}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {formatEventDate(event.occurredAt, event)}
                  </span>
                </div>
                {event.description && (
                  <p className="text-sm text-muted-foreground mt-1">{event.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PhotosTab({ vin }: { vin: string }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["vehicle-photos-split", vin],
    queryFn: async () => {
      const res = await fetch(`/api/admin/vehicles/${encodeURIComponent(vin)}/photos`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Photos failed (${res.status})`);
      return res.json() as Promise<{
        photosNew: Array<SplitPhoto & { id: number; url: string; provider: string; isPrimary: boolean; sortOrder: number }>;
        photosOld: Array<SplitPhoto & { id: number; url: string; provider: string; isPrimary: boolean; sortOrder: number }>;
      }>;
    },
  });

  if (isLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
        LOADING_PHOTOS...
      </div>
    );
  }

  const isGallery = (p: SplitPhoto) => !p.group || p.group === "gallery";
  const photosNew = (data?.photosNew ?? []).filter(isGallery);
  const photosOld = (data?.photosOld ?? []).filter(isGallery);
  const providerOld = photosOld.filter((p) => p.provider !== "import-motor");
  const hasCdn = photosNew.length > 0;
  const cdnIds = new Set(photosNew.map((p) => p.id));
  const pendingThumbs = providerOld.filter((p) => !cdnIds.has(p.id));
  const galleryPhotos = galleryFromSplitPhotos({
    photosNew,
    photosOld: providerOld,
    excludeImportMotor: true,
  });
  const originalSourceLinks = [
    ...providerOld.filter((p) => Boolean(p.url)),
    ...photosOld.filter((p) => p.provider === "import-motor" && Boolean(p.url)),
  ].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const importMotorLinks: typeof photosOld = [];

  if (!galleryPhotos.length && !originalSourceLinks.length && !importMotorLinks.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <Image className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No photos for <span className="font-mono text-foreground">{vin}</span></p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PhotoLightbox
        open={lightboxIndex != null && galleryPhotos.length > 0}
        onOpenChange={(open) => {
          if (!open) setLightboxIndex(null);
        }}
        photos={galleryPhotos}
        initialIndex={lightboxIndex ?? 0}
        title={`${vin} CDN photos`}
      />

      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
      Gallery only — 360° exterior/interior frames are on the 360° tab. Cloudflare CDN photos
      render when mirrored; Copart/IAA stay as original links. Import Motor domains are hosted
      on Cloudflare; Import Motor source URLs stay link-only here and are never on the public API.
      </div>

      {galleryPhotos.length > 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Image className="w-4 h-4" />
              {hasCdn && pendingThumbs.length > 0
                ? `Cloudflare CDN (${photosNew.length}) + pending (${pendingThumbs.length})`
                : hasCdn
                  ? "Cloudflare CDN"
                  : "Provider photos (mirror pending)"}{" "}
              ({galleryPhotos.length})
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {hasCdn
                ? "CDN copies on imgsv.getcarapi.com. Tap to swipe — original source links are listed below."
                : "Shown until Cloudflare mirroring completes. Tap to swipe."}
            </p>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {galleryPhotos.map((photo, i) => (
              <button
                key={`img-${i}-${photo.label ?? "p"}-${photo.url}`}
                type="button"
                onClick={() => setLightboxIndex(i)}
                className="group relative block aspect-[4/3] overflow-hidden rounded-lg border border-border bg-muted/40 text-left"
                title={`${photo.label ?? "photo"}${photo.isPrimary ? " · primary" : ""}`}
              >
                <img
                  src={encarPhotoUrl(photo.url, "display")}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
                />
                <span className="absolute left-1.5 bottom-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/65 text-white">
                  {photo.label ?? "photo"}
                  {photo.isPrimary ? " · primary" : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {originalSourceLinks.length > 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              Original source images ({originalSourceLinks.length})
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Provider URLs for this VIN — click to open the original image.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {originalSourceLinks.map((photo) => (
              <li
                key={`src-${photo.id}-${photo.url}`}
                className="px-4 py-3 flex flex-wrap items-center gap-2 gap-y-1.5 text-sm"
              >
                <span className="font-mono text-[11px] text-muted-foreground w-8 shrink-0">
                  #{photo.sortOrder + 1}
                </span>
                {photo.isPrimary && (
                  <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded font-semibold">
                    PRIMARY
                  </span>
                )}
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {photo.provider}
                </span>
                <a
                  href={photo.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="min-w-0 flex-1 truncate font-mono text-xs text-primary hover:underline"
                  title={photo.url}
                >
                  {photo.url}
                </a>
                <button
                  type="button"
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => navigator.clipboard?.writeText(photo.url)}
                >
                  Copy
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {importMotorLinks.length > 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              Import Motor (links only) ({importMotorLinks.length})
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Internal reference — do not embed; public API never returns these URLs.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {importMotorLinks.map((photo) => (
              <li
                key={`im-${photo.id}`}
                className="px-4 py-3 flex flex-wrap items-center gap-2 gap-y-1.5 text-sm"
              >
                <span className="font-mono text-[11px] text-muted-foreground w-8 shrink-0">
                  #{photo.sortOrder + 1}
                </span>
                {photo.isPrimary && (
                  <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded font-semibold">
                    PRIMARY
                  </span>
                )}
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  import-motor
                </span>
                <a
                  href={photo.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="min-w-0 flex-1 truncate font-mono text-xs text-primary hover:underline"
                  title={photo.url}
                >
                  {photo.url}
                </a>
                <button
                  type="button"
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => navigator.clipboard?.writeText(photo.url)}
                >
                  Copy
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type Photos360Payload = {
  photosExterior3d: Array<SplitPhoto & { id: number; url: string; provider: string; isPrimary: boolean; sortOrder: number }>;
  photosExterior3dOld: Array<SplitPhoto & { id: number; url: string; provider: string; isPrimary: boolean; sortOrder: number }>;
};

function Photos360Tab({ vin }: { vin: string }) {
  const [lightbox, setLightbox] = useState<{ index: number } | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["vehicle-photos-360", vin],
    queryFn: async () => {
      const res = await fetch(`/api/admin/vehicles/${encodeURIComponent(vin)}/photos`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Photos failed (${res.status})`);
      return res.json() as Promise<Photos360Payload>;
    },
  });

  if (isLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
        LOADING_360...
      </div>
    );
  }

  const exteriorCdn = data?.photosExterior3d ?? [];
  const exteriorSrc = (data?.photosExterior3dOld ?? []).filter((p) => p.provider !== "import-motor");
  const exteriorIm = (data?.photosExterior3dOld ?? []).filter((p) => p.provider === "import-motor");

  const exteriorGallery = galleryFromSplitPhotos({
    photosNew: exteriorCdn,
    photosOld: exteriorSrc,
    excludeImportMotor: true,
  });

  const total = exteriorGallery.length + exteriorIm.length;

  if (total === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <RotateCw className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No 360° frames for <span className="font-mono text-foreground">{vin}</span></p>
        <p className="text-xs mt-2 max-w-md mx-auto">
          Exterior spin sequences come from IAA crawls. Image URLs stay as source links when not mirrored.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PhotoLightbox
        open={lightbox != null && exteriorGallery.length > 0}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
        photos={exteriorGallery}
        initialIndex={lightbox?.index ?? 0}
        title={`${vin} exterior 360°`}
      />

      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
        Exterior 360° only. Interior cabin 360 is not collected.
      </div>

      <Photos360Section
        title="Exterior 360°"
        cdnCount={exteriorCdn.length}
        gallery={exteriorGallery}
        sourceLinks={exteriorSrc}
        importMotorLinks={exteriorIm}
        onOpen={(index) => setLightbox({ index })}
      />
    </div>
  );
}

function Photos360Section({
  title,
  cdnCount,
  gallery,
  sourceLinks,
  importMotorLinks,
  onOpen,
}: {
  title: string;
  cdnCount: number;
  gallery: ReturnType<typeof galleryFromSplitPhotos>;
  sourceLinks: Array<{ id: number; url: string; provider: string; isPrimary: boolean; sortOrder: number }>;
  importMotorLinks: Array<{ id: number; url: string; provider: string; isPrimary: boolean; sortOrder: number }>;
  onOpen: (index: number) => void;
}) {
  if (!gallery.length && !sourceLinks.length && !importMotorLinks.length) return null;

  return (
    <div className="space-y-3">
      {gallery.length > 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <RotateCw className="w-4 h-4" />
              {title} ({gallery.length})
              {cdnCount > 0 ? (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {cdnCount} CDN
                </span>
              ) : null}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Tap a frame to swipe the spin sequence.
            </p>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {gallery.map((photo, i) => (
              <button
                key={`${title}-img-${i}-${photo.url}`}
                type="button"
                onClick={() => onOpen(i)}
                className="group relative block aspect-square overflow-hidden rounded-lg border border-border bg-muted/40 text-left"
                title={`${photo.label ?? "360"}${photo.isPrimary ? " · primary" : ""}`}
              >
                <img
                  src={encarPhotoUrl(photo.url, "display")}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
                />
                <span className="absolute left-1 bottom-1 text-[10px] font-mono px-1 py-0.5 rounded bg-black/65 text-white">
                  {i + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {sourceLinks.length > 0 && gallery.length === 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              {title} — Copart / IAA source links ({sourceLinks.length})
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Not hosted on Cloudflare — open the original auction CDN frame.
            </p>
          </div>
          <ul className="divide-y divide-border max-h-80 overflow-y-auto">
            {sourceLinks.map((photo) => (
              <li
                key={`${title}-src-${photo.id}-${photo.url}`}
                className="px-4 py-2.5 flex flex-wrap items-center gap-2 text-sm"
              >
                <span className="font-mono text-[11px] text-muted-foreground w-8 shrink-0">
                  #{photo.sortOrder + 1}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {photo.provider}
                </span>
                <a
                  href={photo.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="min-w-0 flex-1 truncate font-mono text-xs text-primary hover:underline"
                  title={photo.url}
                >
                  {photo.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {importMotorLinks.length > 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              {title} — Import Motor (pending mirror) ({importMotorLinks.length})
            </h3>
          </div>
          <ul className="divide-y divide-border max-h-48 overflow-y-auto">
            {importMotorLinks.map((photo) => (
              <li key={`${title}-im-${photo.id}`} className="px-4 py-2.5 flex gap-2 text-sm">
                <span className="font-mono text-[11px] text-muted-foreground w-8 shrink-0">
                  #{photo.sortOrder + 1}
                </span>
                <a
                  href={photo.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="min-w-0 flex-1 truncate font-mono text-xs text-primary hover:underline"
                >
                  {photo.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RawSourcesTab({ vin }: { vin: string }) {
  const { data, isLoading } = useGetVehicleRawSources(vin, {});
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
        Loading raw…
      </div>
    );
  }

  if (!data?.items.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <Database className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No raw records.</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Raw ({data.total})
        </h3>
      </div>
      <div className="divide-y divide-border">
        {data.items.map((record) => (
          <div key={record.id}>
            <button
              className="w-full px-6 py-4 text-left hover:bg-muted/30 transition-colors flex items-center justify-between"
              onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
            >
              <div className="flex items-center gap-3">
                <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-mono font-semibold">
                  {record.providerName ?? `#${record.providerId}`}
                </span>
                {record.parserVersion && (
                  <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded text-xs font-mono">
                    v{record.parserVersion}
                  </span>
                )}
                <span className="font-mono text-xs text-muted-foreground">{record.sourceId}</span>
              </div>
              <div className="flex items-center gap-3">
                {record.requestUrl && (
                  <a
                    href={record.requestUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-muted-foreground hover:text-primary"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <span className="text-xs text-muted-foreground font-mono">
                  {new Date(record.collectedAt).toLocaleDateString()}
                </span>
                {expandedId === record.id ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            </button>
            {expandedId === record.id && (
              <div className="px-6 py-4 bg-muted/20 border-t border-border">
                {record.contentHash && (
                  <div className="text-xs font-mono text-muted-foreground mb-3">
                    Hash: <span className="text-foreground">{record.contentHash}</span>
                  </div>
                )}
                {record.rawJson ? (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Raw JSON Payload
                    </div>
                    <pre className="text-xs font-mono bg-background border border-border rounded-lg p-3 overflow-x-auto max-h-96 whitespace-pre-wrap">
                      {(() => {
                        try { return JSON.stringify(JSON.parse(record.rawJson), null, 2); }
                        catch { return record.rawJson; }
                      })()}
                    </pre>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No raw JSON payload stored.</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
