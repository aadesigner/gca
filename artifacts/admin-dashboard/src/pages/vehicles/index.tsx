import React, { useState, useEffect } from "react";
import { Link } from "wouter";
import { useListVehicles, useListProviders } from "@workspace/api-client-react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  Car,
  Search,
  Trash2,
  Gauge,
  Download,
  Upload,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  fetchVehicleStats,
  deleteVehicle,
  downloadAdminFile,
  importVinCatalog,
  type VehicleStats,
} from "@/lib/admin-api";
import { PageEnter, PageHeader, Surface, StatTile, FilterBar, FilterSpan, ProviderChip } from "@/components/page";
import { DesktopTable, MobileCards } from "@/components/responsive";
import { ListPager } from "@/components/list-pager";
import { PhotoLightbox, galleryFromSplitPhotos } from "@/components/photo-lightbox";
import { encarPhotoUrl } from "@/lib/live-feed-api";

const PAGE_SIZE = 50;

function formatMileage(km?: number | null, miles?: number | null) {
  if (km == null) return "—";
  const mi = miles ?? Math.round(km * 0.621371);
  return `${km.toLocaleString()} km (${mi.toLocaleString()} mi)`;
}

type VehiclePhotoEntry = {
  id: number;
  url: string;
  provider: string;
  isPrimary: boolean;
  sortOrder: number;
};

type VehicleRow = {
  id: number;
  vin: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  country?: string | null;
  bodyType?: string | null;
  transmission?: string | null;
  driveType?: string | null;
  fuelType?: string | null;
  listingCount?: number | null;
  currentKnownMileage?: number | null;
  currentKnownMileageKm?: number | null;
  currentKnownMileageMiles?: number | null;
  providerNames?: string[];
  photosNew?: VehiclePhotoEntry[];
  photosOld?: VehiclePhotoEntry[];
  photoCounts?: { new?: number; old?: number };
};

/** List thumbnails: prefer our CDN; until mirrored, provider source (not Import Motor). */
function vehicleThumb(vehicle: VehicleRow): { url: string; label: string } | null {
  const neu = vehicle.photosNew?.find((p) => p.isPrimary) ?? vehicle.photosNew?.[0];
  if (neu?.url) {
    const isStock = /no[-_]?photo/i.test(neu.url) || neu.id === -1;
    return {
      url: encarPhotoUrl(neu.url, "card"),
      label: isStock ? "No photo" : "Self-hosted · imgsv",
    };
  }
  const old = vehicle.photosOld?.find((p) => p.isPrimary) ?? vehicle.photosOld?.[0];
  if (old?.url) {
    return {
      url: encarPhotoUrl(old.url, "card"),
      label: old.provider ? `Source · ${old.provider}` : "Source",
    };
  }
  return null;
}

function photoNewCount(vehicle: VehicleRow): number {
  return vehicle.photoCounts?.new ?? vehicle.photosNew?.length ?? 0;
}

function photoOldCount(vehicle: VehicleRow): number {
  return vehicle.photoCounts?.old ?? vehicle.photosOld?.length ?? 0;
}

export default function Vehicles() {
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [country, setCountry] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [fuelType, setFuelType] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortBy, setSortBy] = useState<"createdAt" | "year" | "mileage" | "price" | "make">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [providerId, setProviderId] = useState("");
  const [isExporting, setIsExporting] = useState<"json" | "csv" | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [offset, setOffset] = useState(0);
  const [lightbox, setLightbox] = useState<{
    vin: string;
    fallbackUrl?: string;
    fallbackLabel?: string;
  } | null>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: providers } = useListProviders();

  const { data: lightboxPhotoData } = useQuery({
    queryKey: ["vehicle-photos-split", lightbox?.vin],
    enabled: Boolean(lightbox?.vin),
    queryFn: async () => {
      const res = await fetch(`/api/admin/vehicles/${encodeURIComponent(lightbox!.vin)}/photos`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Photos failed (${res.status})`);
      return res.json() as Promise<{
        photosNew: Array<{ id: number; url: string; provider: string; isPrimary: boolean; sortOrder: number }>;
        photosOld: Array<{ id: number; url: string; provider: string; isPrimary: boolean; sortOrder: number }>;
      }>;
    },
  });

  const lightboxPhotos = galleryFromSplitPhotos({
    photosNew: lightboxPhotoData?.photosNew,
    photosOld: lightboxPhotoData?.photosOld,
    excludeImportMotor: true,
  });
  const lightboxItems =
    lightboxPhotos.length > 0
      ? lightboxPhotos
      : lightbox?.fallbackUrl
        ? [{ url: lightbox.fallbackUrl, label: lightbox.fallbackLabel }]
        : [];

  const openVehiclePhotos = (vehicle: VehicleRow) => {
    const thumb = vehicleThumb(vehicle);
    if (!thumb && photoNewCount(vehicle) === 0 && photoOldCount(vehicle) === 0) return;
    setLightbox({
      vin: vehicle.vin,
      fallbackUrl: thumb?.url,
      fallbackLabel: thumb?.label,
    });
  };

  const providerNum = providerId ? parseInt(providerId, 10) : undefined;
  const yearFromNum = yearFrom ? Number(yearFrom) : undefined;
  const yearToNum = yearTo ? Number(yearTo) : undefined;
  const minPriceNum = minPrice ? Number(minPrice) : undefined;
  const maxPriceNum = maxPrice ? Number(maxPrice) : undefined;

  const listParams = {
    search: search || undefined,
    make: brand || undefined,
    model: model || undefined,
    country: country || undefined,
    yearFrom: Number.isFinite(yearFromNum) ? yearFromNum : undefined,
    yearTo: Number.isFinite(yearToNum) ? yearToNum : undefined,
    fuelType: fuelType || undefined,
    minPrice: Number.isFinite(minPriceNum) ? minPriceNum : undefined,
    maxPrice: Number.isFinite(maxPriceNum) ? maxPriceNum : undefined,
    sortBy,
    sortOrder,
    providerId: providerNum,
    limit: PAGE_SIZE,
    offset,
  };

  const { data: vehiclesList, isLoading, isError: listError, error: listErrorObj } = useListVehicles(listParams, {
    query: { staleTime: 15_000, retry: 1 },
  });

  const { data: stats, isError: statsError } = useQuery<VehicleStats>({
    queryKey: ["vehicle-stats", search, brand, country, providerId],
    queryFn: () => fetchVehicleStats(brand || undefined, country || undefined, providerNum, search || undefined),
    retry: 1,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const vehicleCount = stats?.total ?? vehiclesList?.total ?? 0;
  const items = (vehiclesList?.items ?? []) as VehicleRow[];

  useEffect(() => {
    setOffset(0);
  }, [search, brand, model, country, yearFrom, yearTo, providerId, fuelType, minPrice, maxPrice, sortBy, sortOrder]);

  // Drop model if it is no longer in the facet list for the selected brand.
  useEffect(() => {
    if (!model || !stats?.byModel?.length) return;
    if (!stats.byModel.some((r) => r.model === model)) setModel("");
  }, [brand, stats?.byModel, model]);

  const yearOptions = stats?.byYear ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/vehicles"] });
    queryClient.invalidateQueries({ queryKey: ["vehicle-stats"] });
  };

  const handleDelete = async (vin: string) => {
    if (!confirm(`Permanently delete vehicle ${vin} and all related history?`)) return;
    try {
      await deleteVehicle(vin);
      toast({ title: "Vehicle deleted", description: vin });
      refresh();
    } catch (e) {
      toast({ title: "Delete failed", description: String(e), variant: "destructive" });
    }
  };

  const selectedInternalName = providers?.find((p) => String(p.id) === providerId)?.internalName;

  const handleExport = async (format: "json" | "csv") => {
    setIsExporting(format);
    try {
      if (format === "json") {
        const qs = new URLSearchParams({ format: "json" });
        qs.set("provider", selectedInternalName || "all");
        await downloadAdminFile(`/admin/vins/export?${qs.toString()}`);
        toast({
          title: "Catalog exported",
          description: selectedInternalName
            ? `VIN catalog for ${selectedInternalName}. Import this file on the server.`
            : "VIN catalog for all providers. Import this file on the server.",
        });
      } else {
        const qs = new URLSearchParams({ enabledOnly: "1" });
        if (brand) qs.set("make", brand);
        if (country) qs.set("country", country);
        if (providerId) qs.set("providerId", providerId);
        await downloadAdminFile(`/admin/listings/export?${qs.toString()}`);
        toast({ title: "CSV exported", description: "Spreadsheet of VINs, prices, and listing URLs." });
      }
    } catch (e) {
      toast({ title: "Export failed", description: String(e), variant: "destructive" });
    } finally {
      setIsExporting(null);
    }
  };

  const handleImportFile = async (file: File) => {
    setIsImporting(true);
    try {
      const text = await file.text();
      const trimmed = text.trim();
      const payload =
        file.name.toLowerCase().endsWith(".csv") || /^vin,/i.test(trimmed.replace(/^\uFEFF/, ""))
          ? { csv: text }
          : JSON.parse(trimmed);
      const result = await importVinCatalog(payload);
      toast({
        title: "Import complete",
        description: `${result.listingsUpserted} listings, ${result.photosAdded} photos, ${result.observationsAdded} history rows.${result.skippedNoVin ? ` ${result.skippedNoVin} skipped (no VIN).` : ""}${result.errors.length ? ` ${result.errors.length} errors.` : ""}`,
      });
      refresh();
    } catch (e) {
      toast({ title: "Import failed", description: String(e), variant: "destructive" });
    } finally {
      setIsImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const hasFilters = Boolean(
    search || brand || model || country || yearFrom || yearTo || providerId || fuelType || minPrice || maxPrice,
  );
  const selectClass =
    "h-11 md:h-10 w-full sm:w-auto rounded-xl border border-input bg-background px-3 text-sm sm:min-w-[140px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const yearClass =
    "h-11 md:h-10 w-full sm:w-[6.5rem] rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <PageEnter>
      <PhotoLightbox
        open={Boolean(lightbox)}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
        photos={lightboxItems}
        initialIndex={0}
        title={lightbox ? `${lightbox.vin} photos` : "Photos"}
      />
      <PageHeader
        title="Vehicles"
        description="Browse the VIN catalog, filter by source or specs, then open a record. Export/import moves the catalog between servers."
        actions={
          <>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => importInputRef.current?.click()}
              disabled={isImporting}
            >
              <Upload className="w-4 h-4" />
              {isImporting ? "Importing…" : "Import"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => void handleExport("json")}
              disabled={isExporting !== null || vehicleCount === 0}
            >
              <Download className="w-4 h-4" />
              {isExporting === "json"
                ? "Exporting…"
                : selectedInternalName
                  ? `Export ${selectedInternalName}`
                  : "Export all"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => void handleExport("csv")}
              disabled={isExporting !== null || vehicleCount === 0}
            >
              <Download className="w-4 h-4" />
              {isExporting === "csv" ? "Exporting…" : "Export CSV"}
            </Button>
          </>
        }
      />

      {statsError && (
        <p className="text-sm text-amber-600">
          Stats unavailable — list count still shows ({vehicleCount}).
        </p>
      )}
      {listError && (
        <p className="text-sm text-destructive">
          Failed to load vehicles{listErrorObj instanceof Error ? `: ${listErrorObj.message}` : ""}. Try again or clear filters.
        </p>
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Total vehicles" value={stats.total.toLocaleString()} icon={Car} />
          <StatTile label="With listings" value={stats.withListings.toLocaleString()} />
          <StatTile label="With observations" value={stats.withObservations.toLocaleString()} />
          <StatTile
            label="Matching filters"
            value={(vehiclesList?.total ?? stats.total).toLocaleString()}
            icon={Gauge}
            accent
          />
        </div>
      )}

      <FilterBar>
        <FilterSpan>
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by VIN, make, model…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-background font-mono text-sm rounded-xl"
            />
          </div>
        </FilterSpan>
        <select
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          className={selectClass}
        >
          <option value="">All providers</option>
          {(stats?.byProvider?.length
            ? stats.byProvider
            : (providers ?? []).map((p) => ({ id: p.id, name: p.name, count: 0 }))
          ).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
              {"count" in row && row.count ? ` (${row.count})` : ""}
            </option>
          ))}
        </select>
        <select
          value={brand}
          onChange={(e) => {
            setBrand(e.target.value);
            setModel("");
          }}
          className={selectClass}
        >
          <option value="">All brands</option>
          {(stats?.byMake ?? []).map((row) => (
            <option key={row.make ?? "unknown"} value={row.make ?? ""}>
              {row.make ?? "Unknown"} ({row.count})
            </option>
          ))}
        </select>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className={selectClass}
          disabled={!brand}
        >
          <option value="">{brand ? "All models" : "Select brand first"}</option>
          {(stats?.byModel ?? []).map((row) => (
            <option key={row.model ?? "unknown"} value={row.model ?? ""}>
              {row.model ?? "Unknown"} ({row.count})
            </option>
          ))}
        </select>
        <select value={country} onChange={(e) => setCountry(e.target.value)} className={selectClass}>
          <option value="">All countries</option>
          {(stats?.byCountry ?? []).map((row) => (
            <option key={row.country ?? "unknown"} value={row.country ?? ""}>
              {row.country ?? "Unknown"} ({row.count})
            </option>
          ))}
        </select>
        <select value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} className={yearClass}>
          <option value="">Year from</option>
          {yearOptions.map((row) => (
            <option key={`from-${row.year}`} value={row.year}>
              {row.year}
            </option>
          ))}
        </select>
        <select value={yearTo} onChange={(e) => setYearTo(e.target.value)} className={yearClass}>
          <option value="">Year to</option>
          {yearOptions.map((row) => (
            <option key={`to-${row.year}`} value={row.year}>
              {row.year}
            </option>
          ))}
        </select>
        <select value={fuelType} onChange={(e) => setFuelType(e.target.value)} className={selectClass}>
          <option value="">All fuel</option>
          {(stats?.byFuel ?? []).map((row) => (
            <option key={row.fuelType} value={row.fuelType}>
              {row.fuelType} ({row.count})
            </option>
          ))}
        </select>
        <Input
          type="number"
          inputMode="numeric"
          placeholder="Min $"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
          className={yearClass}
          min={0}
        />
        <Input
          type="number"
          inputMode="numeric"
          placeholder="Max $"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          className={yearClass}
          min={0}
        />
        <select
          value={`${sortBy}:${sortOrder}`}
          onChange={(e) => {
            const [by, order] = e.target.value.split(":") as [typeof sortBy, typeof sortOrder];
            setSortBy(by);
            setSortOrder(order);
          }}
          className={selectClass}
        >
          <option value="createdAt:desc">Newest first</option>
          <option value="createdAt:asc">Oldest first</option>
          <option value="price:asc">Price ↑</option>
          <option value="price:desc">Price ↓</option>
          <option value="year:desc">Year ↓</option>
          <option value="year:asc">Year ↑</option>
          <option value="mileage:asc">Mileage ↑</option>
          <option value="mileage:desc">Mileage ↓</option>
          <option value="make:asc">Make A–Z</option>
        </select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="col-span-2 sm:col-auto"
            onClick={() => {
              setSearch("");
              setBrand("");
              setModel("");
              setCountry("");
              setYearFrom("");
              setYearTo("");
              setProviderId("");
              setFuelType("");
              setMinPrice("");
              setMaxPrice("");
            }}
          >
            Clear
          </Button>
        )}
      </FilterBar>

      {vehiclesList && !isLoading && !listError && (
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground px-0.5">
          <span className="font-mono tabular-nums">
            Showing {items.length.toLocaleString()} of {(vehiclesList.total ?? 0).toLocaleString()}
          </span>
          {hasFilters && <span>Filters applied</span>}
        </div>
      )}

      <MobileCards>
        {isLoading ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground animate-pulse text-xs">
            Loading vehicles…
          </div>
        ) : listError ? (
          <div className="rounded-2xl border border-destructive/40 bg-card p-8 text-center text-destructive">
            Could not load vehicles for this filter.
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
            No vehicles match these filters.
          </div>
        ) : (
          items.map((vehicle) => {
            const thumb = vehicleThumb(vehicle);
            const newCount = photoNewCount(vehicle);
            const oldCount = photoOldCount(vehicle);
            return (
            <div key={vehicle.id} className="rounded-2xl border border-border/80 bg-card overflow-hidden">
              <div className="flex gap-3 p-4">
                {thumb ? (
                  <button
                    type="button"
                    onClick={() => openVehiclePhotos(vehicle)}
                    className="shrink-0 text-left"
                    title={`${thumb.label} · view gallery`}
                  >
                    <img
                      src={thumb.url}
                      alt=""
                      className="h-20 w-24 rounded-xl object-cover bg-muted ring-1 ring-border/60"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                ) : (
                  <div
                    className="h-20 w-24 shrink-0 rounded-xl bg-muted/60 flex items-center justify-center text-[9px] text-muted-foreground px-1 text-center leading-tight ring-1 ring-border/40"
                    title={oldCount > 0 ? "Awaiting imgsv mirror" : "No photos"}
                  >
                    {oldCount > 0 ? "CDN…" : "—"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-mono font-semibold text-primary text-[13px] break-all">{vehicle.vin}</div>
                  <div className="mt-1 font-medium leading-snug">
                    {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{vehicle.trim || "—"} · {vehicle.country || "—"}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(vehicle.providerNames ?? []).map((name) => <ProviderChip key={name} name={name} />)}
                  </div>
                </div>
              </div>
              <div className="px-4 py-2.5 border-t border-border/60 bg-muted/20 flex items-center justify-between gap-3 text-[11px] font-mono text-muted-foreground">
                <span>{formatMileage(vehicle.currentKnownMileageKm ?? vehicle.currentKnownMileage, vehicle.currentKnownMileageMiles)}</span>
                <span className="shrink-0">CDN {newCount} · src {oldCount} · {vehicle.listingCount || 0} ads</span>
              </div>
              <div className="px-4 pb-4 pt-3 flex items-center gap-2">
                <Link
                  href={`/vin-search?vin=${vehicle.vin}`}
                  className="inline-flex flex-1 items-center justify-center h-10 px-3 rounded-xl text-xs font-medium bg-primary text-primary-foreground hover:opacity-95 transition-opacity"
                >
                  Open record
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(vehicle.vin)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            );
          })
        )}
        {vehiclesList && vehiclesList.total > PAGE_SIZE && (
          <ListPager
            offset={offset}
            pageSize={PAGE_SIZE}
            total={vehiclesList.total}
            onOffsetChange={setOffset}
            className="px-1 border-0"
          />
        )}
      </MobileCards>

      <DesktopTable>
      <Surface>
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm text-left">
            <thead className="bg-muted/40 text-[11px] uppercase font-semibold text-muted-foreground border-b border-border tracking-[0.12em]">
              <tr>
                <th className="px-5 py-3">Photo</th>
                <th className="px-5 py-3">VIN / vehicle</th>
                <th className="px-5 py-3">Sources</th>
                <th className="px-5 py-3">Photos</th>
                <th className="px-5 py-3">Origin</th>
                <th className="px-5 py-3">Mileage</th>
                <th className="px-5 py-3">Specs</th>
                <th className="px-5 py-3 text-right">Ads</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/80">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground animate-pulse text-xs">
                    Loading vehicles…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                    No vehicles match these filters.
                  </td>
                </tr>
              ) : (
                items.map((vehicle) => {
                  const thumb = vehicleThumb(vehicle);
                  const newCount = photoNewCount(vehicle);
                  const oldCount = photoOldCount(vehicle);
                  return (
                  <tr key={vehicle.id} className="hover:bg-muted/25 transition-colors">
                    <td className="px-5 py-3">
                      {thumb ? (
                        <button
                          type="button"
                          onClick={() => openVehiclePhotos(vehicle)}
                          className="text-left"
                          title={`${thumb.label} · view gallery`}
                        >
                          <img
                            src={thumb.url}
                            alt=""
                            className="h-14 w-[4.5rem] rounded-lg object-cover bg-muted ring-1 ring-border/50"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        </button>
                      ) : (
                        <div
                          className="h-14 w-[4.5rem] rounded-lg bg-muted/50 flex items-center justify-center text-[9px] text-muted-foreground ring-1 ring-border/40"
                          title={oldCount > 0 ? "Awaiting imgsv mirror" : "No photos"}
                        >
                          {oldCount > 0 ? "CDN…" : "—"}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-mono font-semibold text-primary text-[13px]">{vehicle.vin}</div>
                      <div className="font-medium text-foreground mt-0.5">
                        {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"}
                      </div>
                      {vehicle.trim ? (
                        <div className="text-xs text-muted-foreground mt-0.5">{vehicle.trim}</div>
                      ) : null}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[11rem]">
                        {(vehicle.providerNames ?? []).length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          vehicle.providerNames!.map((name) => <ProviderChip key={name} name={name} />)
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <div className="inline-flex flex-col gap-0.5 text-[11px] font-mono">
                        <span className="text-foreground">{newCount} CDN</span>
                        <span className="text-muted-foreground">{oldCount} src</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">{vehicle.country || "—"}</td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                      {formatMileage(
                        vehicle.currentKnownMileageKm ?? vehicle.currentKnownMileage,
                        vehicle.currentKnownMileageMiles,
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1 text-[11px] font-medium text-muted-foreground">
                        {vehicle.bodyType && <span className="bg-secondary px-1.5 py-0.5 rounded-md">{vehicle.bodyType}</span>}
                        {vehicle.transmission && <span className="bg-secondary px-1.5 py-0.5 rounded-md">{vehicle.transmission}</span>}
                        {vehicle.driveType && <span className="bg-secondary px-1.5 py-0.5 rounded-md">{vehicle.driveType}</span>}
                        {vehicle.fuelType && <span className="bg-secondary px-1.5 py-0.5 rounded-md">{vehicle.fuelType}</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-sm tabular-nums">
                      {vehicle.listingCount || 0}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          href={`/vin-search?vin=${vehicle.vin}`}
                          className="inline-flex items-center justify-center h-8 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-95 transition-opacity"
                        >
                          Open
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(vehicle.vin)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {vehiclesList && vehiclesList.total > PAGE_SIZE && (
          <ListPager
            offset={offset}
            pageSize={PAGE_SIZE}
            total={vehiclesList.total}
            onOffsetChange={setOffset}
          />
        )}
      </Surface>
      </DesktopTable>
    </PageEnter>
  );
}
