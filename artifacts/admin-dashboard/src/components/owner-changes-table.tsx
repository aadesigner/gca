import { Users } from "lucide-react";
import { formatDualMileage } from "@/lib/format-specs";
import { cn } from "@/lib/utils";

export type OwnerChangeRow = {
  date: string;
  sequence?: number;
  info?: string;
  plate?: string;
  mileageKm?: number;
  mileageMiles?: number;
  mileageNote?: string;
  source?: string;
};

export function OwnerChangesTable({
  rows,
  inverse,
}: {
  rows: OwnerChangeRow[];
  inverse?: boolean;
}) {
  if (!rows.length) {
    return (
      <div className={cn(
        "rounded-xl border p-8 text-center text-sm",
        inverse ? "border-white/10 text-slate-500" : "border-border text-muted-foreground bg-card",
      )}>
        <Users className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p>No owner-change records.</p>
      </div>
    );
  }

  const showInfo = rows.some((r) => r.info);
  const showPlate = rows.some((r) => r.plate);
  const showMileage = rows.some((r) => r.mileageKm != null);

  const th = inverse
    ? "text-[10px] uppercase tracking-wider text-slate-500 font-mono"
    : "text-xs uppercase font-semibold text-muted-foreground tracking-wider";
  const td = inverse ? "text-sm text-slate-200" : "text-sm text-foreground";

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden",
      inverse ? "border-white/10 bg-slate-900/40" : "border-border bg-card shadow-sm",
    )}>
      <div className={cn("px-4 py-3 border-b", inverse ? "border-white/10" : "border-border bg-muted/30")}>
        <h3 className={cn("font-semibold text-sm flex items-center gap-2", inverse ? "text-white" : "")}>
          <Users className="w-4 h-4" />
          Owner changes ({rows.length})
        </h3>
      </div>
      <div className={cn("sm:hidden divide-y", inverse ? "divide-white/5" : "divide-border")}>
        {rows.map((row) => (
          <div key={`${row.sequence}-${row.date}`} className="px-4 py-3 space-y-1">
            <div className={cn("flex items-center justify-between gap-2", td)}>
              <span className="font-mono">#{row.sequence ?? "—"} · {row.date}</span>
              {showMileage && row.mileageKm != null && (
                <span className="font-mono text-xs">
                  {formatDualMileage(row.mileageKm, row.mileageMiles)}
                </span>
              )}
            </div>
            {(row.info || row.plate) && (
              <div className={inverse ? "text-xs text-slate-400" : "text-xs text-muted-foreground"}>
                {[row.info, row.plate].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className={inverse ? "border-b border-white/10" : "border-b border-border bg-muted/50"}>
              <th className={cn("px-4 py-3", th)}>#</th>
              <th className={cn("px-4 py-3", th)}>Date</th>
              {showInfo && <th className={cn("px-4 py-3", th)}>Info</th>}
              {showPlate && <th className={cn("px-4 py-3", th)}>Plate</th>}
              {showMileage && <th className={cn("px-4 py-3 text-right", th)}>Mileage</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.sequence}-${row.date}`} className={inverse ? "border-b border-white/5" : "border-b border-border"}>
                <td className={cn("px-4 py-3 font-mono", td)}>{row.sequence ?? "—"}</td>
                <td className={cn("px-4 py-3 font-mono whitespace-nowrap", td)}>{row.date}</td>
                {showInfo && (
                  <td className={cn("px-4 py-3", inverse ? "text-slate-300" : "text-muted-foreground")}>
                    {row.info ?? ""}
                  </td>
                )}
                {showPlate && <td className={cn("px-4 py-3 font-mono", td)}>{row.plate}</td>}
                {showMileage && (
                  <td className={cn("px-4 py-3 text-right font-mono", td)}>
                    {row.mileageKm != null ? formatDualMileage(row.mileageKm, row.mileageMiles) : ""}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function isGenericOwnerInfo(text: string, date?: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (t.startsWith("title transfer")) return true;
  if (t.includes("korean vehicle registry")) return true;
  if (/^owner change\b/.test(t) && (t.includes("recorded") || (date && t.includes(date.toLowerCase())))) {
    return true;
  }
  return false;
}

export function normalizeOwnerChangeRows(
  rows?: Array<OwnerChangeRow | string> | null,
): OwnerChangeRow[] {
  if (!rows?.length) return [];
  return rows.map((row, index) => {
    if (typeof row === "string") {
      return { date: row, sequence: index + 1 };
    }
    const date = row.date;
    const info = row.info && !isGenericOwnerInfo(row.info, date) ? row.info : undefined;
    return {
      sequence: row.sequence ?? index + 1,
      date,
      info,
      plate: row.plate,
      mileageKm: row.mileageKm,
      mileageMiles: row.mileageMiles,
      source: row.source,
    };
  });
}
