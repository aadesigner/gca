import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDualMileage } from "@/lib/format-specs";

export type AccidentRow = {
  date: string;
  type: "accident" | "flood_damage" | "damage" | string;
  category?: string | null;
  damage?: string | null;
  description?: string | null;
  repairTotal?: number | null;
  insuranceBenefit?: number | null;
  currency?: string | null;
  source?: string | null;
  mileageKm?: number | null;
  mileageMiles?: number | null;
};

function typeLabel(type: string): string {
  if (type === "flood_damage") return "Flood";
  if (type === "damage") return "Damage";
  return "Accident";
}

function formatMoney(amount: number | null | undefined, currency?: string | null): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const cur = (currency ?? "USD").toUpperCase();
  if (cur === "KRW") return `₩${amount.toLocaleString("en-US")}`;
  if (cur === "USD") return `$${amount.toLocaleString("en-US")}`;
  return `${amount.toLocaleString("en-US")} ${cur}`;
}

export function AccidentsTable({ rows }: { rows: AccidentRow[] }) {
  if (!rows.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <AlertTriangle className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No accident or damage records yet.</p>
        <p className="text-xs mt-1">Insurance accidents and auction primary/secondary damage appear here.</p>
      </div>
    );
  }

  const showCosts = rows.some((r) => r.repairTotal != null || r.insuranceBenefit != null);
  const showMileage = rows.some((r) => r.mileageKm != null);

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Accidents ({rows.length})
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
            <tr>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Type</th>
              {showMileage && <th className="px-6 py-4 text-right">Mileage</th>}
              <th className="px-6 py-4">Damage</th>
              <th className="px-6 py-4">Details</th>
              {showCosts && <th className="px-6 py-4">Repair</th>}
              {showCosts && <th className="px-6 py-4">Payout</th>}
              <th className="px-6 py-4">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => (
              <tr key={`${row.date}-${row.type}-${row.damage}-${index}`} className="hover:bg-muted/30">
                <td className="px-6 py-4 font-mono text-xs whitespace-nowrap">{row.date}</td>
                <td className="px-6 py-4">
                  <span className="bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded text-xs font-mono font-semibold">
                    {typeLabel(row.type)}
                    {row.category ? ` · ${row.category}` : ""}
                  </span>
                </td>
                {showMileage && (
                  <td className="px-6 py-4 text-right font-mono text-xs whitespace-nowrap">
                    {row.mileageKm != null ? formatDualMileage(row.mileageKm, row.mileageMiles) : "—"}
                  </td>
                )}
                <td className={cn("px-6 py-4 font-mono text-xs", !row.damage && "text-muted-foreground")}>
                  {row.damage ?? "—"}
                </td>
                <td className="px-6 py-4 text-muted-foreground text-xs max-w-md">
                  {row.description ?? "—"}
                </td>
                {showCosts && (
                  <td className="px-6 py-4 font-mono text-xs">
                    {formatMoney(row.repairTotal, row.currency) ?? "—"}
                  </td>
                )}
                {showCosts && (
                  <td className="px-6 py-4 font-mono text-xs">
                    {formatMoney(row.insuranceBenefit, row.currency) ?? "—"}
                  </td>
                )}
                <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                  {row.source ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
