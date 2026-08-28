import React, { useState } from "react";
import { Link } from "wouter";
import { useListVehicles, useListProviders } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  fetchVehicleStats,
  deleteVehicle,
  deleteAllVehicles,
  downloadAdminFile,
  importVinCatalog,
  type VehicleStats,
} from "@/lib/admin-api";
import { PageEnter, PageHeader, Surface, StatTile, FilterBar, ProviderChip } from "@/components/page";
import { DesktopTable, MobileCards } from "@/components/responsive";

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

/** List/search thumbnails: our CDN only (never provider source_url). */
function vehicleThumb(vehicle: VehicleRow): { url: string; label: string } | null {
  const neu = vehicle.photosNew?.find((p) => p.isPrimary) ?? vehicle.photosNew?.[0];
  if (neu?.url) return { url: neu.url, label: "Self-hosted · imgsv" };
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
  const [country, setCountry] = useState("");
  const [providerId, setProviderId] = useState("");
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState("");
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [isExporting, setIsExporting] = useState<"json" | "csv" | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: providers } = useListProviders();

  const providerNum = providerId ? parseInt(providerId, 10) : undefined;

  const listParams = {
    search: search || undefined,
    make: brand || undefined,
    country: country || undefined,
    providerId: providerNum,
    limit: 50,
  };

  const { data: vehiclesList, isLoading } = useListVehicles(listParams, {
    query: { staleTime: 15_000 },
  });

  const { data: stats, isError: statsError } = useQuery<VehicleStats>({
    queryKey: ["vehicle-stats", search, brand, country, providerId],
    queryFn: () => fetchVehicleStats(brand || undefined, country || undefined, providerNum, search || undefined),
    retry: 1,
    staleTime: 30_000,
  });

  const vehicleCount = stats?.total ?? vehiclesList?.total ?? 0;
  const items = (vehiclesList?.items ?? []) as VehicleRow[];

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

  const handleDeleteAll = async () => {
    if (deleteAllConfirm !== "DELETE ALL") {
      toast({ title: "Confirmation required", description: "Type DELETE ALL exactly.", variant: "destructive" });
      return;
    }
    setIsDeletingAll(true);
    try {
      const result = (await deleteAllVehicles()) as { deleted: number };
      toast({ title: "Bulk delete complete", description: `${result.deleted} vehicles removed` });
      setDeleteAllOpen(false);
      setDeleteAllConfirm("");
      refresh();
    } catch (e) {
      toast({ title: "Bulk delete failed", description: String(e), variant: "destructive" });
    } finally {
      setIsDeletingAll(false);
    }
  };

  const hasFilters = Boolean(search || brand || country || providerId);
  const selectClass =
    "h-11 md:h-10 w-full sm:w-auto rounded-xl border border-input bg-background px-3 text-sm sm:min-w-[160px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <PageEnter>
      <PageHeader
        title="Vehicles"
        description="Master VIN catalog. Export JSON to move this database onto a server, then Import the same file there. CSV is for spreadsheets."
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
            <Button
              variant="destructive"
              size="sm"
              className="gap-2"
              onClick={() => setDeleteAllOpen(true)}
              disabled={vehicleCount === 0 || isDeletingAll}
            >
              <Trash2 className="w-4 h-4" />
              Delete all
            </Button>
          </>
        }
      />

      {statsError && (
        <p className="text-sm text-amber-600">
          Stats unavailable — delete actions still use the vehicle list count ({vehicleCount}).
        </p>
      )}

      <Dialog open={deleteAllOpen} onOpenChange={(open) => { setDeleteAllOpen(open); if (!open) setDeleteAllConfirm(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all vehicles?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently removes <strong>{vehicleCount}</strong> vehicles and all related
            listings, observations, events, photos, and raw records. This cannot be undone.
          </p>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Type DELETE ALL to confirm
            </label>
            <Input
              value={deleteAllConfirm}
              onChange={(e) => setDeleteAllConfirm(e.target.value)}
              placeholder="DELETE ALL"
              className="font-mono"
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAllOpen(false)} disabled={isDeletingAll}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAll}
              disabled={deleteAllConfirm !== "DELETE ALL" || isDeletingAll}
            >
              {isDeletingAll ? "Deleting…" : "Delete everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatTile label="Total vehicles" value={stats.total.toLocaleString()} icon={Car} />
          <StatTile label="With listings" value={stats.withListings.toLocaleString()} />
          <StatTile label="With observations" value={stats.withObservations.toLocaleString()} />
          <StatTile
            label="Filtered results"
            value={(vehiclesList?.total ?? stats.total).toLocaleString()}
            icon={Gauge}
          />
        </div>
      )}

      <FilterBar>
        <div className="relative flex-1 w-full min-w-0 sm:min-w-[200px] sm:max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by VIN, make, model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-background font-mono text-sm rounded-xl"
          />
        </div>
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
        <select value={brand} onChange={(e) => setBrand(e.target.value)} className={selectClass}>
          <option value="">All brands</option>
          {stats?.byMake.map((row) => (
            <option key={row.make ?? "unknown"} value={row.make ?? ""}>
              {row.make ?? "Unknown"} ({row.count})
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
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setBrand("");
              setCountry("");
              setProviderId("");
            }}
          >
            Clear
          </Button>
        )}
      </FilterBar>

      <MobileCards>
        {isLoading ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground animate-pulse text-xs">
            Loading vehicles…
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
            <div key={vehicle.id} className="rounded-2xl border border-border/80 bg-card p-4">
              <div className="flex gap-3">
                {thumb ? (
                  <a href={thumb.url} target="_blank" rel="noopener noreferrer" className="shrink-0" title={thumb.label}>
                    <img
                      src={thumb.url}
                      alt=""
                      className="h-16 w-20 rounded-lg object-cover bg-muted"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </a>
                ) : (
                  <div
                    className="h-16 w-20 shrink-0 rounded-lg bg-muted/60 flex items-center justify-center text-[9px] text-muted-foreground px-1 text-center leading-tight"
                    title={oldCount > 0 ? "Awaiting imgsv mirror" : "No photos"}
                  >
                    {oldCount > 0 ? "CDN…" : "—"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-mono font-semibold text-primary text-[13px] break-all">{vehicle.vin}</div>
                  <div className="mt-1 font-medium">
                    {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">{vehicle.trim || "—"} · {vehicle.country || "—"}</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(vehicle.providerNames ?? []).map((name) => <ProviderChip key={name} name={name} />)}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground font-mono">
                Photos (new) {newCount} · Photos (old) {oldCount}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs font-mono text-muted-foreground">
                <span>{formatMileage(vehicle.currentKnownMileageKm ?? vehicle.currentKnownMileage, vehicle.currentKnownMileageMiles)}</span>
                <span>{vehicle.listingCount || 0} listings</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Link
                  href={`/vin-search?vin=${vehicle.vin}`}
                  className="inline-flex flex-1 items-center justify-center h-10 px-3 rounded-lg text-xs font-medium bg-primary/10 text-primary"
                >
                  <Search className="w-3 h-3 mr-1.5" />
                  Inspect
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
        {vehiclesList && vehiclesList.total > vehiclesList.items.length && (
          <div className="px-1 text-xs text-muted-foreground font-mono">
            Showing {vehiclesList.items.length} of {vehiclesList.total} vehicles
          </div>
        )}
      </MobileCards>

      <DesktopTable>
      <Surface>
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm text-left">
            <thead className="bg-muted/40 text-[11px] uppercase font-semibold text-muted-foreground border-b border-border tracking-[0.12em]">
              <tr>
                <th className="px-6 py-3.5">Photo</th>
                <th className="px-6 py-3.5">VIN</th>
                <th className="px-6 py-3.5">Vehicle</th>
                <th className="px-6 py-3.5">Provider</th>
                <th className="px-6 py-3.5">Photos</th>
                <th className="px-6 py-3.5">Country</th>
                <th className="px-6 py-3.5">Mileage</th>
                <th className="px-6 py-3.5">Specs</th>
                <th className="px-6 py-3.5 text-right">Listings</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/80">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-10 text-center text-muted-foreground animate-pulse text-xs">
                    Loading vehicles…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-10 text-center text-muted-foreground">
                    No vehicles match these filters.
                  </td>
                </tr>
              ) : (
                items.map((vehicle) => {
                  const thumb = vehicleThumb(vehicle);
                  const newCount = photoNewCount(vehicle);
                  const oldCount = photoOldCount(vehicle);
                  return (
                  <tr key={vehicle.id}>
                    <td className="px-6 py-4">
                      {thumb ? (
                        <a href={thumb.url} target="_blank" rel="noopener noreferrer" title={thumb.label}>
                          <img
                            src={thumb.url}
                            alt=""
                            className="h-12 w-16 rounded-md object-cover bg-muted"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        </a>
                      ) : (
                        <div
                          className="h-12 w-16 rounded-md bg-muted/50 flex items-center justify-center text-[9px] text-muted-foreground"
                          title={oldCount > 0 ? "Awaiting imgsv mirror" : "No photos"}
                        >
                          {oldCount > 0 ? "CDN…" : "—"}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-mono font-semibold text-primary text-[13px]">{vehicle.vin}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-foreground">
                        {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{vehicle.trim || "—"}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {(vehicle.providerNames ?? []).length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          vehicle.providerNames!.map((name) => <ProviderChip key={name} name={name} />)
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[11px] font-mono text-muted-foreground whitespace-nowrap">
                      <div>new {newCount}</div>
                      <div>old {oldCount}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">{vehicle.country || "—"}</td>
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                      {formatMileage(
                        vehicle.currentKnownMileageKm ?? vehicle.currentKnownMileage,
                        vehicle.currentKnownMileageMiles,
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1 text-[11px] font-medium text-muted-foreground">
                        {vehicle.bodyType && <span className="bg-secondary px-1.5 py-0.5 rounded-md">{vehicle.bodyType}</span>}
                        {vehicle.transmission && <span className="bg-secondary px-1.5 py-0.5 rounded-md">{vehicle.transmission}</span>}
                        {vehicle.driveType && <span className="bg-secondary px-1.5 py-0.5 rounded-md">{vehicle.driveType}</span>}
                        {vehicle.fuelType && <span className="bg-secondary px-1.5 py-0.5 rounded-md">{vehicle.fuelType}</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-sm tabular-nums">
                      {vehicle.listingCount || 0}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/vin-search?vin=${vehicle.vin}`}
                          className="inline-flex items-center justify-center h-8 px-3 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
                        >
                          <Search className="w-3 h-3 mr-1.5" />
                          Inspect
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
        {vehiclesList && vehiclesList.total > vehiclesList.items.length && (
          <div className="px-6 py-3 border-t border-border/80 text-xs text-muted-foreground font-mono">
            Showing {vehiclesList.items.length} of {vehiclesList.total} vehicles
          </div>
        )}
      </Surface>
      </DesktopTable>
    </PageEnter>
  );
}
