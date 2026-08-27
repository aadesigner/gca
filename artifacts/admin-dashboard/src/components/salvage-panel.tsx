import { ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export type SalvageRecord = {
  salvage: boolean;
  title?: string | null;
  detailedTitle?: string | null;
  state?: string | null;
  status?: string | null;
  date?: string | null;
  source?: string | null;
};

export function SalvagePanel({ record }: { record: SalvageRecord | null | undefined }) {
  if (!record) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <ShieldCheck className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No US/Canada title record yet.</p>
        <p className="text-xs mt-1">Salvage yes/no appears when Vehicle title or Title type is collected from US/CA auctions.</p>
      </div>
    );
  }

  const yes = record.salvage;
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          {yes ? <ShieldAlert className="w-4 h-4 text-amber-600" /> : <ShieldCheck className="w-4 h-4 text-emerald-600" />}
          Salvage title
        </h3>
      </div>
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Salvage</span>
          <span
            className={cn(
              "px-2.5 py-1 rounded text-sm font-mono font-semibold",
              yes
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
            )}
          >
            {yes ? "yes" : "no"}
          </span>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Title</dt>
            <dd className={cn("mt-1 font-mono text-xs", !record.title && "text-muted-foreground")}>
              {record.title ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Detailed title</dt>
            <dd className={cn("mt-1 font-mono text-xs", !record.detailedTitle && "text-muted-foreground")}>
              {record.detailedTitle ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">State</dt>
            <dd className="mt-1 font-mono text-xs">{record.state ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Source</dt>
            <dd className="mt-1 font-mono text-xs text-muted-foreground">{record.source ?? "—"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
