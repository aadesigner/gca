import { Gavel } from "lucide-react";
import { PriceDisplay } from "@/components/price-display";
import { cn } from "@/lib/utils";

export type AuctionSaleRow = {
  soldDate: string;
  amount?: number | null;
  currency?: string | null;
  registered?: string | null;
  provider?: string | null;
  sourceListingId?: string | null;
  priceUsd?: number | null;
  priceEur?: number | null;
  fx?: { usd?: number; eur?: number } | null;
};

export function AuctionSalesTable({ rows }: { rows: AuctionSaleRow[] }) {
  if (!rows.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <Gavel className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No sold auction or marketplace records yet.</p>
        <p className="text-xs mt-1">Sold date, amount, and first registration appear here when a listing is marked sold.</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Gavel className="w-4 h-4" />
          Auction sales ({rows.length})
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
            <tr>
              <th className="px-6 py-4">Sold date</th>
              <th className="px-6 py-4">Amount</th>
              <th className="px-6 py-4">Registered</th>
              <th className="px-6 py-4">Provider</th>
              <th className="px-6 py-4">Listing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => (
              <tr key={`${row.provider}-${row.sourceListingId}-${row.soldDate}-${index}`} className="hover:bg-muted/30">
                <td className="px-6 py-4 font-mono text-xs whitespace-nowrap">{row.soldDate}</td>
                <td className="px-6 py-4 text-right sm:text-left">
                  {row.amount != null ? (
                    <PriceDisplay
                      amount={row.amount}
                      currency={row.currency ?? "KRW"}
                      usd={row.priceUsd}
                      eur={row.priceEur}
                      fx={row.fx}
                      compact
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className={cn("px-6 py-4 font-mono text-xs", !row.registered && "text-muted-foreground")}>
                  {row.registered ?? "—"}
                </td>
                <td className="px-6 py-4">
                  {row.provider ? (
                    <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-mono font-semibold">
                      {row.provider}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                  {row.sourceListingId ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
