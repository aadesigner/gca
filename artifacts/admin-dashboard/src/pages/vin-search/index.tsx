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
import { PriceDisplay } from "@/components/price-display";
import { OwnerChangesTable, type OwnerChangeRow } from "@/components/owner-changes-table";
import { AuctionSalesTable, type AuctionSaleRow } from "@/components/auction-sales-table";
import { AccidentsTable, type AccidentRow } from "@/components/accidents-table";
import { SalvagePanel, type SalvageRecord } from "@/components/salvage-panel";
import { ExtraTable, type VehicleExtraRow } from "@/components/extra-table";
import { ListPager } from "@/components/list-pager";
import { PageEnter, PageHeader, Surface, FilterBar, EmptyState, ProviderChip } from "@/components/page";

const SEARCH_PAGE_SIZE = 20;
const OBS_PAGE_SIZE = 50;

type VinTab = "overview" | "listings" | "auction" | "owners" | "accidents" | "salvage" | "extra" | "mileage" | "prices" | "events" | "photos" | "rawSources";

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
  return (events ?? []).filter(
    (event) =>
      event.eventType !== "owner_change" &&
      event.eventType !== "sale" &&
      !isAccidentCategoryEvent(event) &&
      !isSalvageCategoryEvent(event) &&
      !isExtraCategoryEvent(event) &&
      !isPlaceholderAccident(event) &&
      !isBuyNowTimelineNoise(event),
  );
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
    setSelectedVin("");
    setCommittedSearch(searchInput);
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
      <PageHeader
        title="VIN history"
        description="Look up a chassis to see listings, prices, mileage, and events across every source."
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
                if (selectedVin) setSelectedVin("");
              }}
              className="pl-9 font-mono text-sm uppercase rounded-xl"
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
          {selectedVin && (
            <Button type="button" variant="outline" onClick={handleClear}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          )}
        </FilterBar>
      </form>

      {/* Facet Filters */}
      {showFacets && (
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Make</label>
              <Input
                value={make}
                onChange={e => setMake(e.target.value)}
                placeholder="Hyundai, Kia..."
                className="text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Country</label>
              <Input
                value={country}
                onChange={e => setCountry(e.target.value)}
                placeholder="South Korea, US…"
                className="text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Year From</label>
              <Input
                type="number"
                value={yearFrom}
                onChange={e => setYearFrom(e.target.value)}
                placeholder="2015"
                className="text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Year To</label>
              <Input
                type="number"
                value={yearTo}
                onChange={e => setYearTo(e.target.value)}
                placeholder="2024"
                className="text-xs h-8"
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

      {/* Search Results List */}
      {!selectedVin && hasListQuery && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-3 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Search Results
          </div>
          {isSearching ? (
            <div className="p-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
              SEARCHING...
            </div>
          ) : !vehiclesList?.items.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No vehicles found{committedSearch ? <> for <span className="font-mono text-foreground">{committedSearch}</span></> : " for these filters"}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {vehiclesList.items.map((v) => (
                <button
                  key={v.id}
                  onClick={() => handleSelectVin(v.vin)}
                  className="w-full text-left px-6 py-4 hover:bg-muted/30 transition-colors flex items-center justify-between group"
                >
                  <div>
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
                  <div className="text-right text-xs text-muted-foreground space-y-1">
                    <div>{v.listingCount ?? 0} listing{v.listingCount !== 1 ? "s" : ""}</div>
                    <div>{v.observationCount ?? 0} obs.</div>
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
}: {
  vin: string;
  vehicle: any;
  isLoading: boolean;
  obsOffset: number;
  onObsOffsetChange: (next: number) => void;
}) {
  const [activeTab, setActiveTab] = useState<VinTab>("overview");

  if (isLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
        LOADING_VIN_DATA...
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <p className="text-muted-foreground">
          VIN <span className="font-mono text-foreground">{vin}</span> not found in the database.
        </p>
        <p className="text-sm text-muted-foreground mt-2">Run a collection job to populate vehicle data.</p>
      </div>
    );
  }

  const visibleEvents = displayEvents(vehicle.events);
  const eventCount = visibleEvents.length;
  const ownerChanges: OwnerChangeRow[] = vehicle.ownerChanges ?? [];
  const auctionSales: AuctionSaleRow[] = vehicle.auctionSales ?? [];
  const accidents: AccidentRow[] = vehicle.accidents ?? [];
  const salvage: SalvageRecord | null = vehicle.salvage ?? null;
  const extra: VehicleExtraRow[] = vehicle.extra ?? [];
  const mileageCount = Array.isArray(vehicle.mileageHistory)
    ? vehicle.mileageHistory.length
    : (vehicle.observations ?? []).filter((o: any) => o.mileage != null || o.mileageKm != null).length;

  const tabs: { id: VinTab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Overview", icon: Car },
    { id: "listings", label: `Listings (${vehicle.observationCount ?? observations.length})`, icon: Activity },
    { id: "auction", label: `Auction (${auctionSales.length})`, icon: Gavel },
    { id: "owners", label: `Owners (${ownerChanges.length})`, icon: Users },
    { id: "accidents", label: `Accidents (${accidents.length})`, icon: AlertTriangle },
    {
      id: "salvage",
      label: salvage ? `Salvage (${salvage.salvage ? "yes" : "no"})` : "Salvage",
      icon: ShieldAlert,
    },
    { id: "extra", label: `Extra (${extra.length})`, icon: Package },
    { id: "mileage", label: `Mileage (${mileageCount})`, icon: Gauge },
    { id: "prices", label: "Prices", icon: DollarSign },
    { id: "events", label: `Events (${eventCount})`, icon: Calendar },
    { id: "photos", label: "Photos", icon: Image },
    { id: "rawSources", label: "Raw Sources", icon: FileText },
  ];

  return (
    <div className="space-y-4">
      <Surface className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            {(() => {
              const photosNew: Array<{ url?: string; isPrimary?: boolean; provider?: string }> =
                vehicle.photosNew ?? [];
              const primary =
                photosNew.find((p) => p.isPrimary && p.url) ??
                photosNew.find((p) => p.url) ??
                null;
              if (!primary?.url) {
                return (
                  <div className="w-24 h-20 sm:w-28 sm:h-24 shrink-0 rounded-lg border border-border bg-muted/40 flex items-center justify-center">
                    <Image className="w-6 h-6 text-muted-foreground/40" />
                  </div>
                );
              }
              return (
                <a
                  href={primary.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="block w-24 h-20 sm:w-28 sm:h-24 shrink-0 rounded-lg border border-border overflow-hidden bg-muted/40"
                  title="Primary CDN photo"
                >
                  <img
                    src={primary.url}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </a>
              );
            })()}
            <div className="min-w-0">
              <div className="font-mono text-2xl font-semibold tracking-tight text-primary break-all">
                {vehicle.vin}
              </div>
              <div className="text-lg font-semibold text-foreground mt-1">
                {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Unknown vehicle"}
              </div>
              {vehicle.trim && (
                <div className="text-sm text-muted-foreground font-mono mt-0.5">{vehicle.trim}</div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-mono">
            {vehicle.bodyType && <span className="bg-secondary px-2.5 py-1 rounded-full">{vehicle.bodyType}</span>}
            {vehicle.fuelType && <span className="bg-secondary px-2.5 py-1 rounded-full">{vehicle.fuelType}</span>}
            {vehicle.transmission && <span className="bg-secondary px-2.5 py-1 rounded-full">{vehicle.transmission}</span>}
            {vehicle.driveType && <span className="bg-secondary px-2.5 py-1 rounded-full">{vehicle.driveType}</span>}
            {vehicle.engineDisplacement && (
              <span
                className="bg-secondary px-2.5 py-1 rounded-full"
                title={formatEngineDisplacement(vehicle.engineDisplacement) ?? undefined}
              >
                {formatEngineBadge(vehicle.engineDisplacement)}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-border/80">
          <div>
            <div className="text-[11px] text-muted-foreground uppercase font-semibold tracking-[0.12em]">Listings</div>
            <div className="text-2xl font-mono font-semibold text-foreground mt-1 tabular-nums">{vehicle.listingCount ?? 0}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground uppercase font-semibold tracking-[0.12em]">Observations</div>
            <div className="text-2xl font-mono font-semibold text-foreground mt-1 tabular-nums">{vehicle.observationCount ?? 0}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground uppercase font-semibold tracking-[0.12em]">Known mileage</div>
            <div className="text-lg font-mono font-semibold text-foreground mt-1">
              {formatDualMileage(
                (vehicle as any).currentKnownMileageKm ?? vehicle.currentKnownMileage,
                (vehicle as any).currentKnownMileageMiles,
              ) ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground uppercase font-semibold tracking-[0.12em]">Last seen</div>
            <div className="text-sm font-mono text-foreground mt-1">
              {vehicle.lastSeenAt
                ? new Date(vehicle.lastSeenAt).toLocaleDateString()
                : new Date(vehicle.updatedAt).toLocaleDateString()}
            </div>
          </div>
        </div>
      </Surface>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/70 p-1 rounded-xl overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && <OverviewTab vehicle={vehicle} events={visibleEvents} />}
      {activeTab === "listings" && (
        <ListingsTab
          observations={vehicle.observations ?? []}
          total={vehicle.observationCount ?? vehicle.observations?.length ?? 0}
          offset={obsOffset}
          pageSize={OBS_PAGE_SIZE}
          onOffsetChange={onObsOffsetChange}
        />
      )}
      {activeTab === "auction" && <AuctionSalesTable rows={auctionSales} />}
      {activeTab === "owners" && <OwnerChangesTable rows={ownerChanges} />}
      {activeTab === "accidents" && <AccidentsTable rows={accidents} />}
      {activeTab === "salvage" && <SalvagePanel record={salvage} />}
      {activeTab === "extra" && <ExtraTable rows={extra} />}
      {activeTab === "mileage" && (
        <MileageChartTab
          history={vehicle.mileageHistory}
          observations={vehicle.observations ?? []}
        />
      )}
      {activeTab === "prices" && <PricesChartTab observations={vehicle.observations ?? []} />}
      {activeTab === "events" && (
        <EventsTab events={visibleEvents} />
      )}
      {activeTab === "photos" && <PhotosTab vin={vehicle.vin} />}
      {activeTab === "rawSources" && <RawSourcesTab vin={vehicle.vin} />}
    </div>
  );
}

function OverviewTab({ vehicle, events }: { vehicle: any; events: any[] }) {
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
    <div className="space-y-6">
      {listingLinks.length > 0 && (
        <Surface>
          <div className="px-6 py-3.5 border-b border-border/80 bg-muted/20">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              Source links
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Listing pages (admin only). Photos are on the Photos tab.
            </p>
          </div>
          <ul className="divide-y divide-border/80">
            {listingLinks.map((l) => (
              <li key={`listing-${l.id}`} className="px-6 py-3 flex flex-wrap items-center gap-2 text-sm">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:items-stretch">
      <Surface className="flex flex-col min-h-[28rem]">
        <div className="px-6 py-3.5 border-b border-border/80 bg-muted/20 shrink-0">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Car className="w-4 h-4" />
            Specifications
          </h3>
        </div>
        {specs.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No specification data available.</div>
        ) : (
          <dl className="divide-y divide-border/80 flex-1">
            {specs.map((s) => {
              const hasOverride = overridesMap[s.label.replace(" ", "")];
              return (
                <div key={s.label} className="px-6 py-3 flex justify-between items-center">
                  <dt className="text-sm text-muted-foreground">{s.label}</dt>
                  <dd className="flex items-center gap-1.5 text-sm font-medium text-foreground font-mono">
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

      <Surface className="flex flex-col min-h-[28rem]">
        <div className="px-6 py-3.5 border-b border-border/80 bg-muted/20 shrink-0">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Recent events
            {events.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({events.length})</span>
            )}
          </h3>
        </div>
        {!events.length ? (
          <div className="p-6 text-sm text-muted-foreground">No recorded events.</div>
        ) : (
          <div className="divide-y divide-border/80 flex-1 overflow-y-auto">
            {events.map((event: any) => (
              <div key={event.id} className="px-6 py-3">
                <div className="flex justify-between items-start gap-3">
                  <span className="text-xs font-mono font-semibold uppercase text-primary">{event.eventType}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatEventDate(event.occurredAt)}
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
        No observations recorded yet. Run a collection job to populate history.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
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
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
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
      <div className="bg-card border border-border rounded-xl shadow-sm p-6">
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
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
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
      price: o.priceAmount,
      currency: o.priceCurrency ?? "",
      provider: o.providerName ?? `#${o.providerId}`,
      usd: o.priceUsd,
      eur: o.priceEur,
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

  const currency = chartData[0]?.currency ?? "";

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-6">
      <div className="flex items-center gap-2 mb-6">
        <TrendingUp className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm">Price Over Time</h3>
        <span className="text-xs text-muted-foreground">({chartData.length} data points, {currency})</span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} tickFormatter={v => `${(v / 1000000).toFixed(1)}M`} />
          <Tooltip
            formatter={(v: number, _name, item: any) => {
              const usd = item?.payload?.usd;
              const eur = item?.payload?.eur;
              const extra = [usd != null ? `$${usd.toLocaleString()}` : null, eur != null ? `€${eur.toLocaleString()}` : null]
                .filter(Boolean)
                .join(" · ");
              return [`${v.toLocaleString()} ${currency}${extra ? ` (${extra})` : ""}`, "Price"];
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
                    {formatEventDate(event.occurredAt)}
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
  const { data, isLoading } = useQuery({
    queryKey: ["vehicle-photos-split", vin],
    queryFn: async () => {
      const res = await fetch(`/api/admin/vehicles/${encodeURIComponent(vin)}/photos`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Photos failed (${res.status})`);
      return res.json() as Promise<{
        photosNew: Array<{ id: number; url: string; provider: string; isPrimary: boolean; sortOrder: number }>;
        photosOld: Array<{ id: number; url: string; provider: string; isPrimary: boolean; sortOrder: number }>;
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

  const photosNew = data?.photosNew ?? [];
  const photosOld = data?.photosOld ?? [];
  const seenUrls = new Set<string>();
  const seenKeys = new Set<string>();
  const photoKey = (url: string) =>
    url.trim().split("#")[0].split("?")[0].replace(/\/+$/, "").toLowerCase()
      .replace(/\/w_\d+x\d+\//g, "/")
      .replace(/\/\d{2,4}x\d{2,4}\//g, "/");
  const alreadySeen = (url: string) => seenUrls.has(url) || seenKeys.has(photoKey(url));
  const remember = (url: string) => {
    seenUrls.add(url);
    seenKeys.add(photoKey(url));
  };
  const displayPhotos = [...photosNew, ...photosOld.filter((p) => p.provider !== "import-motor")].filter(
    (photo) => {
      if (!photo.url || alreadySeen(photo.url)) return false;
      remember(photo.url);
      return true;
    },
  );
  const importMotorLinks = photosOld.filter((p) => p.provider === "import-motor");

  if (!displayPhotos.length && !importMotorLinks.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <Image className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No photos for <span className="font-mono text-foreground">{vin}</span></p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
        CDN and other providers render as images. Import Motor stays link-only (stored in DB for ops;
        never exported on the public VIN API).
      </div>

      {displayPhotos.length > 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Image className="w-4 h-4" />
              Photos ({displayPhotos.length})
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Cloudflare CDN and other provider sources (encar, copart, iaa, …).
            </p>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {displayPhotos.map((photo) => (
              <a
                key={`img-${photo.id}-${photo.provider}-${photo.url}`}
                href={photo.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="group relative block aspect-[4/3] overflow-hidden rounded-lg border border-border bg-muted/40"
                title={`${photo.provider} · #${photo.sortOrder + 1}`}
              >
                <img
                  src={photo.url}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
                />
                <span className="absolute left-1.5 bottom-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/65 text-white">
                  {photo.provider}
                  {photo.isPrimary ? " · primary" : ""}
                </span>
              </a>
            ))}
          </div>
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

function RawSourcesTab({ vin }: { vin: string }) {
  const { data, isLoading } = useGetVehicleRawSources(vin, {});
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
        LOADING_RAW_SOURCES...
      </div>
    );
  }

  if (!data?.items.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <Database className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No raw source records for <span className="font-mono text-foreground">{vin}</span></p>
        <p className="text-xs mt-1">Raw records are stored during collection jobs when raw data retention is enabled.</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Raw Source Records ({data.total})
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
