import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  Car,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gauge,
  History,
  ImageIcon,
  MapPin,
  ShieldAlert,
  Users,
  Gavel,
} from "lucide-react";
import { cn } from "@/lib/utils";

type RetrievePayload = Record<string, unknown>;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function formatDate(v: unknown): string {
  const s = str(v);
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatPrice(amount: unknown, currency: unknown): string {
  const a = num(amount);
  if (a == null) return "—";
  const cur = (str(currency) ?? "").toUpperCase();
  if (cur === "KRW" || cur === "₩") return `₩${a.toLocaleString("ko-KR")}`;
  if (cur === "USD" || cur === "$") return `$${a.toLocaleString("en-US")}`;
  if (cur === "EUR" || cur === "€") return `€${a.toLocaleString("en-US")}`;
  return cur ? `${a.toLocaleString()} ${cur}` : a.toLocaleString();
}

function formatFxTriplet(row: Record<string, unknown>): string {
  const native = formatPrice(row.amount ?? row.priceAmount, row.currency ?? row.priceCurrency);
  const currency = (str(row.currency ?? row.priceCurrency) ?? "").toUpperCase();
  const parts = [
    currency !== "USD" && num(row.priceUsd) != null ? `$${num(row.priceUsd)!.toLocaleString("en-US")}` : null,
    currency !== "EUR" && num(row.priceEur) != null ? `€${num(row.priceEur)!.toLocaleString("en-US")}` : null,
    currency !== "KRW" && num(row.priceKrw) != null ? `₩${num(row.priceKrw)!.toLocaleString("ko-KR")}` : null,
  ].filter(Boolean);
  if (!parts.length) return native;
  return `${native} · ${parts.join(" · ")}`;
}

function formatMileage(km: unknown, miles?: unknown): string {
  const k = num(km);
  const m = num(miles);
  if (k != null && m != null) return `${k.toLocaleString()} km · ${m.toLocaleString()} mi`;
  if (k != null) return `${k.toLocaleString()} km`;
  if (m != null) return `${m.toLocaleString()} mi`;
  return "—";
}

function collectPhotoUrls(data: RetrievePayload): string[] {
  const urls = new Set<string>();
  const add = (u: unknown) => {
    const s = str(u);
    if (s) urls.add(s);
  };

  for (const p of asArray(data.photosNew)) {
    const row = asRecord(p);
    if (row) add(row.url ?? row.storedPath);
  }
  for (const p of asArray(data.photos)) {
    const row = asRecord(p);
    if (row) add(row.url);
  }
  for (const p of asArray(data.photosOld)) {
    const row = asRecord(p);
    if (row) add(row.url ?? row.sourceUrl);
  }
  return [...urls];
}

function SpecItem({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-h-[44px] items-center gap-2 px-3 py-3 text-left transition-colors hover:bg-muted/40 sm:px-4"
      >
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-sm font-semibold">{title}</span>
        {count != null && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {count}
          </span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="border-t border-border px-3 py-3 sm:px-4 sm:py-4">{children}</div>}
    </section>
  );
}

function StackRow({
  primary,
  secondary,
  meta,
  className,
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{primary}</div>
      {(secondary || meta) && (
        <div className="flex w-full min-w-0 flex-col gap-0.5 sm:w-auto sm:items-end sm:text-right">
          {secondary}
          {meta}
        </div>
      )}
    </div>
  );
}

function Gallery({ urls }: { urls: string[] }) {
  const [idx, setIdx] = useState(0);
  if (urls.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 sm:aspect-[16/9]">
        <div className="text-center text-muted-foreground">
          <ImageIcon className="mx-auto h-8 w-8 opacity-40" />
          <p className="mt-2 text-sm">No photos in response</p>
        </div>
      </div>
    );
  }

  const current = urls[idx] ?? urls[0];
  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-zinc-900 sm:aspect-[16/9]">
        <img src={current} alt="" className="h-full w-full object-contain" loading="lazy" />
        {urls.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => setIdx((i) => (i - 1 + urls.length) % urls.length)}
              className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => setIdx((i) => (i + 1) % urls.length)}
              className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <span className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2.5 py-1 text-xs text-white">
              {idx + 1} / {urls.length}
            </span>
          </>
        )}
      </div>
      {urls.length > 1 && (
        <div className="chip-scroll flex gap-2 overflow-x-auto pb-1">
          {urls.slice(0, 12).map((url, i) => (
            <button
              key={`${url}-${i}`}
              type="button"
              onClick={() => setIdx(i)}
              className={cn(
                "h-16 w-[4.5rem] shrink-0 overflow-hidden rounded-lg border-2 transition-all sm:h-14 sm:w-20",
                i === idx ? "border-primary ring-2 ring-primary/20" : "border-transparent opacity-70 hover:opacity-100",
              )}
            >
              <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
          {urls.length > 12 && (
            <div className="flex h-16 w-[4.5rem] shrink-0 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground sm:h-14 sm:w-20">
              +{urls.length - 12}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function VinRetrievePreview({ body }: { body: unknown }) {
  const envelope = asRecord(body);
  const data = useMemo(() => asRecord(envelope?.data), [envelope]);
  const vehicle = useMemo(() => asRecord(data?.vehicle), [data]);
  const photoUrls = useMemo(() => (data ? collectPhotoUrls(data) : []), [data]);

  if (!envelope?.success || !data) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-10 text-center sm:px-6 sm:py-12">
        <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground/60" />
        <p className="mt-3 text-sm text-muted-foreground">
          Preview is available for successful retrieve responses (HTTP 200 with{" "}
          <span className="font-mono">success: true</span>).
        </p>
      </div>
    );
  }

  const vin = str(data.vin) ?? "—";
  const title = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "Vehicle";
  const listings = asArray(data.listings);
  const observations = asArray(data.observations);
  const events = asArray(data.events);
  const ownerChanges = asArray(data.ownerChanges);
  const accidents = asArray(data.accidents);
  const auctionSales = asArray(data.auctionSales);
  const mileageHistory = asArray(data.mileageHistory);
  const meta = asRecord(envelope.meta);

  const specsBlock = (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Car className="h-4 w-4 text-primary" />
        Specifications
      </h3>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        <SpecItem label="Year" value={str(vehicle?.year)} />
        <SpecItem label="Make" value={str(vehicle?.make)} />
        <SpecItem label="Model" value={str(vehicle?.model)} />
        <SpecItem label="Body" value={str(vehicle?.bodyType)} />
        <SpecItem label="Fuel" value={str(vehicle?.fuelType)} />
        <SpecItem label="Transmission" value={str(vehicle?.transmission)} />
        <SpecItem label="Drive" value={str(vehicle?.driveType)} />
        <SpecItem label="Engine" value={str(vehicle?.engineDisplacement)} />
        <SpecItem label="Color" value={str(vehicle?.color)} />
        <SpecItem
          label="Mileage"
          value={
            vehicle?.currentKnownMileage != null
              ? `${Number(vehicle.currentKnownMileage).toLocaleString()} km`
              : undefined
          }
        />
      </div>
    </div>
  );

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden sm:space-y-5">
      {/* Hero */}
      <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white shadow-lg">
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-slate-400 sm:text-xs">Vehicle report</p>
              <h2 className="mt-1 break-words text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">{title}</h2>
              {vehicle?.trim && <p className="mt-1 break-words text-sm text-slate-300 sm:text-base">{str(vehicle.trim)}</p>}
              <p className="mt-2 break-all font-mono text-xs text-slate-400 sm:mt-3 sm:text-sm">{vin}</p>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
              {meta?.creditCharged != null && (
                <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium">
                  {Number(meta.creditCharged) === 0 ? "Test VIN — free" : `${meta.creditCharged} credit charged`}
                </span>
              )}
              {vehicle?.lastSeenAt && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span className="truncate">Last seen {formatDate(vehicle.lastSeenAt)}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: specs first for quick scan; desktop: gallery left, specs right */}
      <div className="grid gap-4 lg:grid-cols-5 lg:gap-5">
        <div className="order-2 space-y-4 lg:order-1 lg:col-span-3 lg:space-y-5">
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ImageIcon className="h-4 w-4 text-primary" />
              Gallery
              {photoUrls.length > 0 && (
                <span className="ml-auto text-xs font-normal text-muted-foreground">{photoUrls.length} photos</span>
              )}
            </h3>
            <Gallery urls={photoUrls} />
          </div>

          <Section title="Listing history" icon={Car} count={listings.length}>
            {listings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No listings.</p>
            ) : (
              <div className="space-y-2">
                {listings.slice(0, 8).map((row, i) => {
                  const l = asRecord(row);
                  if (!l) return null;
                  return (
                    <StackRow
                      key={String(l.id ?? i)}
                      primary={
                        <>
                          <p className="break-words text-sm font-medium">{str(l.title) ?? "Listing"}</p>
                          <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                            <span className="break-words">{str(l.location) ?? "—"}</span>
                          </p>
                        </>
                      }
                      secondary={
                        <p className="font-mono text-sm font-semibold">{formatFxTriplet(l)}</p>
                      }
                      meta={
                        <p className="text-xs text-muted-foreground">
                          {l.isActive ? "Active" : "Inactive"} · {formatDate(l.lastSeenAt)}
                        </p>
                      }
                    />
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="Timeline events" icon={History} count={events.length} defaultOpen={events.length <= 20}>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events.</p>
            ) : (
              <ol className="relative ml-1 space-y-4 border-l border-border pl-4 sm:ml-2 sm:pl-5">
                {events.slice(0, 15).map((row, i) => {
                  const e = asRecord(row);
                  if (!e) return null;
                  return (
                    <li key={String(e.id ?? i)} className="relative min-w-0">
                      <span className="absolute -left-[1.35rem] top-1.5 h-3 w-3 rounded-full border-2 border-primary bg-background sm:-left-[1.6rem]" />
                      <p className="text-xs text-muted-foreground">{formatDate(e.occurredAt)}</p>
                      <p className="break-words text-sm font-medium capitalize">
                        {str(e.eventType)?.replace(/_/g, " ") ?? "Event"}
                      </p>
                      {e.description && (
                        <p className="mt-0.5 break-words text-sm text-muted-foreground">{str(e.description)}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
        </div>

        <div className="order-1 space-y-4 lg:order-2 lg:col-span-2 lg:space-y-5">
          {specsBlock}

          <Section title="Owner changes" icon={Users} count={ownerChanges.length} defaultOpen={ownerChanges.length > 0}>
            {ownerChanges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No owner changes recorded.</p>
            ) : (
              <ul className="space-y-2">
                {ownerChanges.map((row, i) => {
                  const o = asRecord(row);
                  if (!o) return null;
                  return (
                    <li
                      key={i}
                      className="flex flex-col gap-1 rounded-lg bg-muted/30 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span>{formatDate(o.date)}</span>
                      <span className="break-all font-mono text-xs text-muted-foreground">{str(o.plate) ?? `#${o.sequence}`}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Accidents & damage" icon={ShieldAlert} count={accidents.length} defaultOpen={accidents.length > 0}>
            {accidents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No accidents reported.</p>
            ) : (
              <ul className="space-y-2">
                {accidents.map((row, i) => {
                  const a = asRecord(row);
                  if (!a) return null;
                  return (
                    <li key={i} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm">
                      <p className="font-medium capitalize">{str(a.type)?.replace(/_/g, " ")}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(a.date)}</p>
                      {a.description && <p className="mt-1 break-words">{str(a.description)}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Mileage history" icon={Gauge} count={mileageHistory.length}>
            {mileageHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No mileage readings.</p>
            ) : (
              <ul className="space-y-1.5">
                {mileageHistory.slice(0, 10).map((row, i) => {
                  const m = asRecord(row);
                  if (!m) return null;
                  return (
                    <li
                      key={i}
                      className="flex flex-col gap-1 rounded bg-muted/30 px-2 py-1.5 text-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="text-muted-foreground">{formatDate(m.date)}</span>
                      <span className="font-mono text-sm font-medium">
                        {formatMileage(m.mileageKm, m.mileageMiles)}
                        {m.latest && (
                          <span className="ml-2 text-[10px] font-semibold uppercase text-primary">Latest</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Auction sales" icon={Gavel} count={auctionSales.length} defaultOpen={auctionSales.length > 0}>
            {auctionSales.length === 0 ? (
              <p className="text-sm text-muted-foreground">No auction sales.</p>
            ) : (
              <ul className="space-y-2">
                {auctionSales.map((row, i) => {
                  const s = asRecord(row);
                  if (!s) return null;
                  return (
                    <li
                      key={i}
                      className="flex flex-col gap-1 rounded-lg border border-border/60 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Calendar className="h-3 w-3 shrink-0" />
                        {formatDate(s.soldDate)}
                      </span>
                      <span className="font-mono font-semibold">{formatFxTriplet(s)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {observations.length > 0 && (
            <Section title="Price observations" icon={History} count={observations.length} defaultOpen={false}>
              <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                {observations.slice(0, 20).map((row, i) => {
                  const o = asRecord(row);
                  if (!o) return null;
                  return (
                    <li
                      key={String(o.id ?? i)}
                      className="flex flex-col gap-0.5 px-2 py-1 text-xs sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="text-muted-foreground">{formatDate(o.observedAt)}</span>
                      <span className="font-mono">{formatFxTriplet(o)}</span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
