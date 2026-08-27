import React, { useEffect, useState } from "react";
import {
  ExternalLink,
  Shield,
  AlertTriangle,
  ClipboardCheck,
  History,
  Sparkles,
  Users,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatKm,
  encarPhotoUrl,
  type LiveVehicleDetail,
} from "@/lib/live-feed-api";
import { PriceDisplay, formatEurWon } from "@/components/price-display";
import { OwnerChangesTable, normalizeOwnerChangeRows } from "@/components/owner-changes-table";
import { formatEventDate } from "@/lib/format-specs";

const TABS = [
  { id: "overview", label: "Overview", icon: Sparkles },
  { id: "owners", label: "Owners", icon: Users },
  { id: "registry", label: "Korean registry", icon: Shield },
  { id: "accidents", label: "Accidents", icon: AlertTriangle },
  { id: "inspection", label: "Inspection", icon: ClipboardCheck },
  { id: "history", label: "Full history", icon: History },
] as const;

type TabId = (typeof TABS)[number]["id"];

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    AVAILABLE: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    RESERVED: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    SOLD: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };
  return styles[status] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30";
}

export function LiveFeedDetailView({
  detail,
  loading,
  error,
  onRetry,
  sourceLabel,
}: {
  detail: LiveVehicleDetail | null;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  sourceLabel?: string;
}) {
  const [tab, setTab] = useState<TabId>("overview");
  const [photoIdx, setPhotoIdx] = useState(0);

  const photos = detail?.photos ?? [];
  const v = detail?.vehicle;
  const listingId = v?.listingId;
  const touchX = React.useRef<number | null>(null);

  useEffect(() => {
    setPhotoIdx(0);
    setTab("overview");
  }, [listingId]);

  const goPhoto = (next: number, event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (photos.length === 0) return;
    setPhotoIdx((next + photos.length) % photos.length);
  };

  if (loading && !detail) {
    return (
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-pulse">
        <div className="h-[42vh] min-h-[280px] rounded-3xl bg-slate-800/80" />
        <div className="h-8 bg-slate-800 rounded-lg w-2/3" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-slate-800/70" />
          ))}
        </div>
      </div>
    );
  }

  if (!detail || !v) {
    return (
      <div className="max-w-xl mx-auto px-4 py-24 text-center">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl">
          🚗
        </div>
        <h2 className="text-xl font-semibold text-white">This listing could not be loaded</h2>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          {error || "The source site timed out or the car was removed. Try again, or go back to the feed."}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 h-11 px-5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8 pb-16">
      {error && (
        <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 flex items-start justify-between gap-3">
          <span>
            Full inspection data is unavailable right now. Showing the listing summary
            {error ? ` — ${error}` : ""}.
          </span>
          {onRetry && (
            <button type="button" onClick={onRetry} className="shrink-0 font-medium text-amber-50 underline underline-offset-2">
              Retry
            </button>
          )}
        </div>
      )}
      {detail.partial && !error && (
        <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
          Registry and inspection reports were not returned by the source. Specs below are from the live listing card.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.9fr)] gap-6 lg:gap-10">
        <div>
          <div
            className="relative w-full aspect-[16/10] rounded-3xl bg-slate-900 overflow-hidden border border-white/10"
            onTouchStart={(e) => {
              touchX.current = e.changedTouches[0]?.clientX ?? null;
            }}
            onTouchEnd={(e) => {
              if (touchX.current == null) return;
              const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
              touchX.current = null;
              if (dx > 40) goPhoto(photoIdx - 1);
              else if (dx < -40) goPhoto(photoIdx + 1);
            }}
          >
            {photos.length > 0 ? (
              <>
                <img
                  key={photos[photoIdx]}
                  src={encarPhotoUrl(photos[photoIdx], "display")}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                {photos.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="absolute left-3 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-black/55 text-white hover:bg-black/70"
                      onClick={(e) => goPhoto(photoIdx - 1, e)}
                      aria-label="Previous photo"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-black/55 text-white hover:bg-black/70"
                      onClick={(e) => goPhoto(photoIdx + 1, e)}
                      aria-label="Next photo"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                    <div className="absolute bottom-3 right-3 z-20 text-xs font-mono bg-black/60 px-2.5 py-1 rounded-full text-white">
                      {photoIdx + 1} / {photos.length}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-6xl opacity-20">🚗</div>
            )}
          </div>
          {photos.length > 1 && (
            <div className="flex gap-2 mt-3 overflow-x-auto chip-scroll pb-1">
              {photos.map((src, i) => (
                <button
                  key={`${src}-${i}`}
                  type="button"
                  onClick={(e) => goPhoto(i, e)}
                  className={cn(
                    "h-16 w-[5.5rem] shrink-0 rounded-xl overflow-hidden border",
                    i === photoIdx ? "border-sky-400 ring-2 ring-sky-400/30" : "border-white/10 opacity-70 hover:opacity-100",
                  )}
                >
                  <img src={encarPhotoUrl(src, "thumb")} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="xl:sticky xl:top-20 h-fit rounded-3xl border border-white/10 bg-slate-900/60 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className={cn("text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border", statusBadge(v.status))}>
              {v.status}
            </span>
            {v.sourceProvider && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-sky-500/15 text-sky-200 border-sky-400/30">
                {v.sourceProvider.name}
              </span>
            )}
            {v.accidentCount != null && v.accidentCount > 0 && (
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border bg-red-500/20 text-red-300 border-red-500/30">
                {v.accidentCount} accident{v.accidentCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <h1 className="text-2xl sm:text-[1.7rem] font-semibold tracking-tight text-white leading-snug">
            {v.year} {v.make} {v.model}
            {v.trim ? <span className="text-slate-400 font-medium"> · {v.trim}</span> : null}
          </h1>
          <div className="mt-4">
            {v.priceOnRequest || v.price == null ? (
              <div>
                <div className="text-lg font-semibold text-amber-200">Price on request</div>
                <div className="text-xs text-slate-400 mt-1">
                  The dealer listed a placeholder ask — not a real sale price.
                </div>
                {v.msrp != null && (
                  <div className="text-xs text-slate-500 mt-2 font-mono">
                    New was {formatEurWon(v.msrp, v.msrpEur)}
                  </div>
                )}
              </div>
            ) : (
              <>
                <PriceDisplay
                  amount={v.price}
                  currency={v.currency}
                  usd={v.priceUsd}
                  eur={v.priceEur}
                  fx={v.fx}
                  inverse
                />
                {v.msrp != null && (
                  <div className="text-xs text-slate-500 mt-2 font-mono">
                    New was {formatEurWon(v.msrp, v.msrpEur)}
                  </div>
                )}
              </>
            )}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-2">
            {[
              ["Mileage", formatKm(v.mileage)],
              ["Fuel", v.fuel],
              ["Gearbox", v.transmission],
              ["Location", v.location],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-950/70 border border-white/5 px-3 py-2.5">
                  <dt className="text-[10px] uppercase tracking-wider text-slate-500">{label}</dt>
                  <dd className="text-sm text-slate-100 mt-0.5 truncate">{value}</dd>
                </div>
              ))}
          </dl>
          {detail.vin && (
            <p className="text-[11px] font-mono text-slate-500 mt-4 break-all">VIN {detail.vin}</p>
          )}
          {detail.listingUrl && (
            <a
              href={detail.listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium"
            >
              View on {sourceLabel || v.sourceProvider?.name || "source"}
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </aside>
      </div>

      <div className="mt-8 rounded-3xl border border-white/10 bg-slate-900/40 overflow-hidden">
        <div className="sticky top-12 sm:top-14 z-10 flex gap-1 px-3 sm:px-4 py-2 border-b border-white/10 overflow-x-auto chip-scroll bg-slate-950/95 backdrop-blur">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 min-h-[40px]",
                tab === id
                  ? "bg-sky-600/30 text-sky-200"
                  : "text-slate-500 hover:text-slate-200 hover:bg-white/5",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
        <div className="p-4 sm:p-6">
          {tab === "overview" && <OverviewTab detail={detail} />}
          {tab === "owners" && (
            <OwnerChangesTable
              inverse
              rows={normalizeOwnerChangeRows(detail.ownerChanges ?? detail.registry?.ownerChanges)}
            />
          )}
          {tab === "registry" && <RegistryTab detail={detail} />}
          {tab === "accidents" && <AccidentsTab detail={detail} />}
          {tab === "inspection" && <InspectionTab detail={detail} />}
          {tab === "history" && <HistoryTab detail={detail} />}
        </div>
      </div>
    </div>
  );
}

function krwToEur(krw: number | undefined, fx: LiveVehicleDetail["vehicle"]["fx"]) {
  if (krw == null || !fx) return null;
  return Math.round(krw * fx.eurPerKrw);
}

function money(krw: number | undefined, fx: LiveVehicleDetail["vehicle"]["fx"]) {
  return formatEurWon(krw, krwToEur(krw, fx));
}

function OverviewTab({ detail }: { detail: LiveVehicleDetail }) {
  const v = detail.vehicle;
  return (
    <div className="space-y-4">
      <SpecGrid
        items={[
          ["Mileage", formatKm(v.mileage)],
          ["Fuel", v.fuel],
          ["Transmission", v.transmission],
          ["Drivetrain", v.drivetrain],
          ["Body", detail.bodyType ?? v.bodyType],
          ["Color", detail.color ?? v.color],
          ["Engine", detail.engineDisplacement ? `${detail.engineDisplacement} cc` : undefined],
          ["Location", v.location],
          ["Owners changed", v.ownerChangeCount?.toString()],
          ["Listing ID", v.listingId],
        ]}
      />
      {detail.features && detail.features.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-slate-500 font-mono mb-2">Features & options</h4>
          <div className="flex flex-wrap gap-2">
            {detail.features.map((f) => (
              <span key={f} className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RegistryTab({ detail }: { detail: LiveVehicleDetail }) {
  const reg = detail.registry;
  const fx = detail.vehicle.fx;
  const ownerRows = normalizeOwnerChangeRows(detail.ownerChanges ?? reg?.ownerChanges);
  if (!reg?.available) {
    return (
      <p className="text-sm text-slate-500">
        Vehicle registry data is not available for this listing (seller may have restricted access).
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <SpecGrid
        items={[
          ["First registration", reg.firstDate],
          ["Owner changes", reg.ownerChangeCount?.toString()],
          ["Insurance accidents", reg.accidentCount?.toString()],
          ["Own repair cost", reg.myAccidentCost != null ? money(reg.myAccidentCost, fx) : undefined],
          ["Third-party cost", reg.otherAccidentCost != null ? money(reg.otherAccidentCost, fx) : undefined],
          [
            "Accident cost total",
            reg.myAccidentCost != null || reg.otherAccidentCost != null
              ? money((reg.myAccidentCost ?? 0) + (reg.otherAccidentCost ?? 0), fx)
              : undefined,
          ],
          ["Total loss count", reg.totalLossCount?.toString()],
          ["Flood damage", reg.floodDamage ? "Yes" : "No"],
          ["Active loan/lien", reg.loan && reg.loan > 0 ? "Yes" : "No"],
        ]}
      />
      {ownerRows.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-slate-500 font-mono mb-2">Owner-change dates</h4>
          <ul className="space-y-1">
            {ownerRows.map((row) => (
              <li
                key={`${row.sequence}-${row.date}`}
                className="rounded-lg bg-slate-900/80 border border-white/5 px-3 py-2 text-sm text-slate-200 font-mono"
              >
                {row.sequence != null ? `${row.sequence}. ` : ""}
                {row.date}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AccidentsTab({ detail }: { detail: LiveVehicleDetail }) {
  const accidents = (detail.registry?.accidents ?? []).filter(
    (a) => (a.repairTotal ?? 0) > 0 || (a.insuranceBenefit ?? 0) > 0,
  );
  const accidentEvents = detail.events.filter((e) => {
    if (e.eventType !== "accident") return false;
    const description = e.description ?? "";
    return !(/repair ₩0/.test(description) && /payout ₩0/.test(description));
  });
  const fx = detail.vehicle.fx;

  if (accidents.length === 0 && accidentEvents.length === 0) {
    return <p className="text-sm text-slate-500">No insurance accident records reported for this vehicle.</p>;
  }

  const repairTotal = accidents.reduce((sum, a) => sum + (a.repairTotal ?? 0), 0);
  const payoutTotal = accidents.reduce((sum, a) => sum + (a.insuranceBenefit ?? 0), 0);
  const combined = repairTotal + payoutTotal;

  return (
    <div className="space-y-3">
      {(repairTotal > 0 || payoutTotal > 0) && (
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">Accident totals</div>
          <div className="mt-1 text-lg font-semibold font-mono text-white">{money(combined || repairTotal, fx)}</div>
          <div className="mt-2 text-xs text-slate-300 space-y-1">
            {repairTotal > 0 && <div>Repair total: {money(repairTotal, fx)}</div>}
            {payoutTotal > 0 && <div>Insurance payout total: {money(payoutTotal, fx)}</div>}
          </div>
        </div>
      )}
      {accidents.map((a, i) => (
        <div key={i} className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <div className="text-sm font-medium text-red-200">{a.date ?? "Unknown date"}</div>
          {a.type && <div className="text-xs text-slate-400 mt-0.5">{a.type}</div>}
          <div className="mt-2 text-xs text-slate-300 space-y-1">
            {a.repairTotal != null && <div>Repair total: {money(a.repairTotal, fx)}</div>}
            {a.insuranceBenefit != null && <div>Insurance payout: {money(a.insuranceBenefit, fx)}</div>}
          </div>
        </div>
      ))}
      {accidentEvents.map((e, i) => (
        <div key={`ev-${i}`} className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
          {e.description}
        </div>
      ))}
    </div>
  );
}

const PANEL_LABELS: Record<string, string> = {
  FRONT_DOOR_LEFT: "Front Door (Left)",
  FRONT_DOOR_RIGHT: "Front Door (Right)",
  BACK_DOOR_LEFT: "Rear Door (Left)",
  BACK_DOOR_RIGHT: "Rear Door (Right)",
  TRUNK_LID: "Trunk Lid",
  HOOD: "Hood",
  FRONT_FENDER_LEFT: "Front Fender (Left)",
  FRONT_FENDER_RIGHT: "Front Fender (Right)",
  CHECKER_COMMENT: "Diagnosis Summary",
  OUTER_PANEL_COMMENT: "Outer Panel Notes",
};

const COMMENT_ITEM_NAMES = new Set([
  "CHECKER_COMMENT",
  "OUTER_PANEL_COMMENT",
  "Diagnosis Summary",
  "Outer Panel Notes",
]);

function InspectionTab({ detail }: { detail: LiveVehicleDetail }) {
  const diag = asRecord(detail.diagnosis);
  const insp = asRecord(detail.inspection);

  if (!diag && !insp) {
    return <p className="text-sm text-slate-500">No diagnosis or inspection report available.</p>;
  }

  return (
    <div className="space-y-6">
      {diag && <DiagnosisReport data={diag} />}
      {insp && <PerformanceInspectionReport data={insp} />}
    </div>
  );
}

function DiagnosisReport({ data }: { data: Record<string, unknown> }) {
  const items = Array.isArray(data.items) ? data.items : [];
  const panels: Array<{ name: string; result: string; code?: string }> = [];
  const comments: Array<{ title: string; text: string }> = [];

  for (const item of items) {
    const row = asRecord(item);
    if (!row) continue;
    const rawName = asStr(row.name) ?? asStr(row.partName) ?? "Unknown panel";
    const resultCode = asStr(row.resultCode);
    const result = asStr(row.result) ?? "";
    const isComment = COMMENT_ITEM_NAMES.has(rawName) || (!resultCode && result.length > 24);

    if (isComment && result) {
      comments.push({ title: panelLabel(rawName), text: polishInspectionComment(result) });
      continue;
    }

    panels.push({
      name: panelLabel(rawName),
      result: resultLabel(resultCode, result),
      code: resultCode,
    });
  }

  const date =
    formatInspectionDate(asStr(data.realDiagnosisDate)) ??
    formatInspectionDate(asStr(data.diagnosisDate));
  const center = asStr(data.reservationCenterName) || asStr(data.centerCode);
  const diagnosisNo = asNum(data.diagnosisNo);

  return (
    <div className="space-y-3">
      <h4 className="text-xs uppercase tracking-wider text-slate-500 font-mono">Encar diagnosis</h4>
      <SpecGrid
        items={[
          ["Diagnosed", date],
          ["Diagnosis no.", diagnosisNo != null ? String(diagnosisNo) : undefined],
          ["Center", center],
        ]}
      />
      {comments.map((comment) => (
        <div key={comment.title} className="rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">{comment.title}</div>
          <p className="mt-1 text-sm text-slate-200 whitespace-pre-wrap">{comment.text}</p>
        </div>
      ))}
      {panels.length > 0 && (
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/5 text-[10px] uppercase tracking-wider text-slate-500 font-mono">
                <th className="text-left px-3 py-2 font-medium">Panel</th>
                <th className="text-right px-3 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {panels.map((panel) => (
                <tr key={panel.name} className="border-t border-white/5">
                  <td className="px-3 py-2 text-slate-200">{panel.name}</td>
                  <td className="px-3 py-2 text-right">
                    <ResultBadge result={panel.result} code={panel.code} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PerformanceInspectionReport({ data }: { data: Record<string, unknown> }) {
  const master = asRecord(data.master) ?? data;
  const info = asRecord(master.detail) ?? master;
  const comments = polishInspectionComment(asStr(info.comments) ?? "");
  const panelNotes = collectInspectionPanelNotes(data);
  const flood = info.waterlog === true || info.flood === true;
  const accident = master.accdient === true || master.accident === true;
  const simpleRepair = master.simpleRepair === true;
  const mileage = asNum(info.mileage);

  const flags = [
    flood ? "Flood / water damage flagged" : null,
    accident ? "Accident history flagged" : null,
    simpleRepair ? "Simple / outer-panel repair only" : null,
  ].filter((flag): flag is string => !!flag);

  return (
    <div className="space-y-3">
      <h4 className="text-xs uppercase tracking-wider text-slate-500 font-mono">Performance inspection</h4>
      {flags.length > 0 && (
        <ul className="space-y-1">
          {flags.map((flag) => (
            <li key={flag} className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-200">
              {flag}
            </li>
          ))}
        </ul>
      )}
      <SpecGrid
        items={[
          ["VIN", asStr(info.vin)],
          ["Mileage at inspection", mileage != null ? formatKm(mileage) : undefined],
          ["Issued", formatInspectionDate(asStr(info.issueDate) ?? asStr(master.registrationDate))],
          ["First registered", formatInspectionDate(asStr(info.firstRegistrationDate))],
          ["Record no.", asStr(info.recordNo)],
          ["Overall", nestedTitle(info.boardStateType)],
          ["Condition", nestedTitle(info.carStateType)],
        ]}
      />
      {comments && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">Inspector notes</div>
          <p className="mt-1 text-sm text-slate-200 whitespace-pre-wrap">{comments}</p>
        </div>
      )}
      {panelNotes.length > 0 ? (
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/5 text-[10px] uppercase tracking-wider text-slate-500 font-mono">
                <th className="text-left px-3 py-2 font-medium">Panel</th>
                <th className="text-right px-3 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {panelNotes.map((note) => (
                <tr key={`${note.name}-${note.status}`} className="border-t border-white/5">
                  <td className="px-3 py-2 text-slate-200">{note.name}</td>
                  <td className="px-3 py-2 text-right">
                    <ResultBadge result={note.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">No outer or inner panel defects were noted on this inspection.</p>
      )}
    </div>
  );
}

function ResultBadge({ result, code }: { result: string; code?: string }) {
  const key = (code ?? result).toUpperCase();
  const tone =
    /NORMAL|GOOD|NONE/.test(key)
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
      : /REPLACEMENT|SIMPLE/.test(key)
        ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
        : /REPAIR|REPAINT|FILLER/.test(key)
          ? "bg-orange-500/20 text-orange-300 border-orange-500/30"
          : "bg-red-500/20 text-red-300 border-red-500/30";
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", tone)}>
      {result}
    </span>
  );
}

function panelLabel(raw: string): string {
  return PANEL_LABELS[raw] ?? raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function resultLabel(code?: string, raw?: string): string {
  const byCode: Record<string, string> = {
    NORMAL: "Normal",
    REPLACEMENT: "Replacement",
    REPAIR: "Repair",
    SCRATCH: "Scratch",
    DENT: "Dent",
  };
  if (code && byCode[code]) return byCode[code];
  if (!raw) return "Unknown";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function polishInspectionComment(text: string): string {
  if (!text.trim()) return "";
  return text
    .replace(
      /This vehicle's Encar diagnosis shows all items normal,\s*'no accident' vehicle classification\.?/gi,
      "Encar diagnosis: all items normal. Classified as a no-accident vehicle.",
    )
    .replace(
      /vehicle diagnosis result outer panel replacement vehicle/gi,
      "Encar diagnosis: classified as an outer-panel replacement vehicle",
    )
    .replace(/\(\s*FRP\s*\)\s*panel repair,?\s*and\s*vehicle\.*/gi, "FRP panel was repaired.")
    .replace(/\bvehicle diagnosis result\b/gi, "Encar diagnosis")
    .replace(/\band vehicle\.+/gi, ".")
    .replace(/\bvehicle\s+vehicle\b/gi, "vehicle")
    .replace(/\s+\./g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function collectInspectionPanelNotes(data: Record<string, unknown>): Array<{ name: string; status: string }> {
  const notes: Array<{ name: string; status: string }> = [];
  const walk = (nodes: unknown[]) => {
    for (const node of nodes) {
      const row = asRecord(node);
      if (!row) continue;
      const name = nestedTitle(row.type) ?? nestedTitle(row.statusType) ?? asStr(row.type);
      const status = nestedTitle(row.statusType) ?? asStr(row.statusType) ?? asStr(row.status);
      if (name && status && !/^(good|normal|none)$/i.test(status)) {
        notes.push({ name, status });
      }
      if (Array.isArray(row.children)) walk(row.children);
    }
  };
  if (Array.isArray(data.outers)) walk(data.outers);
  if (Array.isArray(data.inners)) walk(data.inners);
  return notes;
}

function nestedTitle(value: unknown): string | undefined {
  const rec = asRecord(value);
  return rec ? asStr(rec.title) : asStr(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStr(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNum(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatInspectionDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const hasTime = /T\d{2}:\d{2}/.test(raw) && !/T00:00:00/.test(raw);
  return hasTime
    ? parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : parsed.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function HistoryTab({ detail }: { detail: LiveVehicleDetail }) {
  if (detail.events.filter((e) => e.eventType !== "owner_change").length === 0) {
    return <p className="text-sm text-slate-500">No history events extracted.</p>;
  }
  return (
    <div className="space-y-2">
      {detail.events.filter((e) => e.eventType !== "owner_change").map((e, i) => (
        <div key={i} className="flex gap-3 text-sm border-l-2 border-sky-500/40 pl-3 py-2">
          <div className="shrink-0 text-[10px] font-mono uppercase text-slate-500 w-28">
            {e.occurredAt ? formatEventDate(e.occurredAt) : e.eventType}
          </div>
          <div className="text-slate-300">{e.description}</div>
        </div>
      ))}
    </div>
  );
}

function SpecGrid({ items }: { items: Array<[string, string | undefined]> }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {items.filter(([, v]) => v).map(([label, value]) => (
        <div key={label} className="rounded-lg bg-slate-900/80 border border-white/5 p-2.5">
          <dt className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">{label}</dt>
          <dd className="text-slate-200 mt-0.5 text-sm break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

