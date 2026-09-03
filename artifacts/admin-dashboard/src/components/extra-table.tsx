import { Package } from "lucide-react";

export type VehicleExtraRow = {
  key: string;
  label: string;
  value: string;
  source?: string | null;
  observedAt?: string | null;
};

export function ExtraTable({ rows }: { rows: VehicleExtraRow[] }) {
  if (!rows.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <Package className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No extra lot specs for this VIN.</p>
        <p className="text-xs mt-1">Lot specs like keys, condition, airbags, and steering appear here.</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Package className="w-4 h-4" />
          Extra ({rows.length})
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
            <tr>
              <th className="px-6 py-4">Field</th>
              <th className="px-6 py-4">Value</th>
              <th className="px-6 py-4">Source</th>
              <th className="px-6 py-4">Observed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((row) => (
              <tr key={`${row.key}-${row.value}`} className="hover:bg-muted/20">
                <td className="px-6 py-3 font-medium">{row.label}</td>
                <td className="px-6 py-3 font-mono text-xs">{row.value}</td>
                <td className="px-6 py-3 text-muted-foreground">{row.source ?? "—"}</td>
                <td className="px-6 py-3 text-muted-foreground font-mono text-xs">{row.observedAt ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
