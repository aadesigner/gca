import React, { useState } from "react";
import { Link } from "wouter";
import { useListListings, useListProviders } from "@workspace/api-client-react";
import { Search, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PriceDisplay, type PriceFx } from "@/components/price-display";
import { PageEnter, PageHeader, Surface, FilterBar, ProviderChip } from "@/components/page";
import { DesktopTable, MobileCards } from "@/components/responsive";

function formatMileage(km?: number | null, miles?: number | null) {
  if (km == null) return "—";
  const mi = miles ?? Math.round(km * 0.621371);
  return `${km.toLocaleString()} km (${mi.toLocaleString()} mi)`;
}

export default function Listings() {
  const [searchVin, setSearchVin] = useState("");
  const [providerId, setProviderId] = useState("");

  const { data: providers } = useListProviders();
  const { data: listingsList, isLoading } = useListListings({
    vin: searchVin || undefined,
    providerId: providerId ? parseInt(providerId) : undefined,
    limit: 50,
  });

  return (
    <PageEnter>
      <PageHeader
        title="Listings"
        description="Marketplace ads tied to a VIN. Filter by source or lookup a specific chassis."
      />

      <FilterBar>
        <div className="relative flex-1 w-full min-w-0 sm:min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Filter by VIN…"
            value={searchVin}
            onChange={(e) => setSearchVin(e.target.value)}
            className="pl-9 bg-background font-mono text-sm uppercase rounded-xl"
            maxLength={17}
          />
        </div>
        <select
          className="h-11 md:h-10 w-full sm:w-[240px] rounded-xl border border-input bg-background px-3 text-sm"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
        >
          <option value="">All providers</option>
          {providers?.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {(searchVin || providerId) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearchVin(""); setProviderId(""); }}>
            Clear
          </Button>
        )}
      </FilterBar>

      <MobileCards>
        {isLoading ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground animate-pulse text-xs">
            Loading listings…
          </div>
        ) : !listingsList || listingsList.items.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
            No listings match these filters.
          </div>
        ) : (
          listingsList.items.map((listing) => (
            <div key={listing.id} className="rounded-2xl border border-border/80 bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{listing.title || "Untitled"}</div>
                  <div className="text-xs font-mono text-muted-foreground mt-0.5">{listing.sourceId}</div>
                </div>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
                    listing.isActive
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {listing.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ProviderChip name={listing.providerName} />
                {listing.vin ? (
                  <Link href={`/vin-search?vin=${listing.vin}`} className="font-mono text-[12px] text-primary break-all">
                    {listing.vin}
                  </Link>
                ) : null}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Price</div>
                  <PriceDisplay
                    amount={listing.priceAmount}
                    currency={listing.priceCurrency}
                    usd={(listing as { priceUsd?: number | null }).priceUsd}
                    eur={(listing as { priceEur?: number | null }).priceEur}
                    fx={(listing as { fx?: PriceFx }).fx}
                    compact
                  />
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Mileage</div>
                  <div className="font-mono text-muted-foreground">
                    {formatMileage(
                      (listing as { mileageKm?: number | null }).mileageKm ?? listing.mileage,
                      (listing as { mileageMiles?: number | null }).mileageMiles,
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">{[listing.location, listing.country].filter(Boolean).join(" · ") || "—"}</span>
                {listing.sourceUrl && (
                  <a
                    href={listing.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground"
                    title="Open listing"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>
          ))
        )}
        {listingsList && (
          <div className="px-1 text-xs text-muted-foreground font-mono">
            {listingsList.items.length} of {listingsList.total} listings
          </div>
        )}
      </MobileCards>

      <DesktopTable>
      <Surface>
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm text-left">
            <thead className="bg-muted/40 text-[11px] uppercase font-semibold text-muted-foreground border-b border-border tracking-[0.12em]">
              <tr>
                <th className="px-6 py-3.5">Title / ID</th>
                <th className="px-6 py-3.5">Provider</th>
                <th className="px-6 py-3.5">VIN</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5">Location</th>
                <th className="px-6 py-3.5 text-right">Price</th>
                <th className="px-6 py-3.5 text-right">Mileage</th>
                <th className="px-6 py-3.5 text-right">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/80">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-muted-foreground animate-pulse text-xs">
                    Loading listings…
                  </td>
                </tr>
              ) : !listingsList || listingsList.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-muted-foreground">
                    No listings match these filters.
                  </td>
                </tr>
              ) : (
                listingsList.items.map((listing) => (
                  <tr key={listing.id}>
                    <td className="px-6 py-4 max-w-[280px]">
                      <div className="font-medium text-foreground truncate" title={listing.title || "Untitled"}>
                        {listing.title || "Untitled"}
                      </div>
                      <div className="text-xs font-mono text-muted-foreground mt-0.5">{listing.sourceId}</div>
                    </td>
                    <td className="px-6 py-4">
                      <ProviderChip name={listing.providerName} />
                    </td>
                    <td className="px-6 py-4">
                      {listing.vin ? (
                        <Link href={`/vin-search?vin=${listing.vin}`} className="font-mono font-medium text-primary hover:underline text-[13px]">
                          {listing.vin}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          listing.isActive
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {listing.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-foreground">
                      {[listing.location, listing.country].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <PriceDisplay
                        amount={listing.priceAmount}
                        currency={listing.priceCurrency}
                        usd={(listing as { priceUsd?: number | null }).priceUsd}
                        eur={(listing as { priceEur?: number | null }).priceEur}
                        fx={(listing as { fx?: PriceFx }).fx}
                        compact
                      />
                    </td>
                    <td className="px-6 py-4 text-right text-muted-foreground text-xs font-mono">
                      {formatMileage(
                        (listing as { mileageKm?: number | null }).mileageKm ?? listing.mileage,
                        (listing as { mileageMiles?: number | null }).mileageMiles,
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {listing.sourceUrl && (
                        <a
                          href={listing.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8 transition-colors"
                          title="Open listing"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {listingsList && (
          <div className="px-6 py-3 border-t border-border/80 text-xs text-muted-foreground font-mono">
            {listingsList.items.length} of {listingsList.total} listings
          </div>
        )}
      </Surface>
      </DesktopTable>
    </PageEnter>
  );
}
