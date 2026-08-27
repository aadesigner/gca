import { cn } from "@/lib/utils";

export type PriceFx = {
  usdPerKrw: number;
  eurPerKrw: number;
  krwPerUsd: number;
  krwPerEur: number;
  fetchedAt: string;
  source: string;
} | null | undefined;

type PriceDisplayProps = {
  amount?: number | null;
  currency?: string | null;
  usd?: number | null;
  eur?: number | null;
  fx?: PriceFx;
  className?: string;
  compact?: boolean;
  inverse?: boolean;
};

export function formatKrw(amount?: number | null) {
  if (amount == null) return "—";
  return `₩${amount.toLocaleString("ko-KR")}`;
}

export function formatUsd(amount?: number | null) {
  if (amount == null) return null;
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatEur(amount?: number | null) {
  if (amount == null) return null;
  return `€${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatEurWon(krw?: number | null, eur?: number | null) {
  if (krw == null) return "—";
  const eurText = formatEur(eur);
  return eurText ? `${eurText} (${formatKrw(krw)})` : formatKrw(krw);
}

export function PriceDisplay({
  amount,
  currency = "KRW",
  usd,
  eur,
  fx,
  className,
  compact,
  inverse,
}: PriceDisplayProps) {
  if (amount == null) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }

  const usdText = formatUsd(usd);
  const eurText = formatEur(eur);
  const isKrw = (currency ?? "KRW").toUpperCase() === "KRW";
  const primary =
    isKrw && eurText ? `${eurText} (${formatKrw(amount)})` : isKrw ? formatKrw(amount) : `${amount.toLocaleString()} ${currency}`;
  const converted = usdText && isKrw && eurText ? usdText : [usdText, eurText].filter(Boolean).join(" · ");
  const rateHint =
    fx && !compact
      ? `1 USD = ${Math.round(fx.krwPerUsd).toLocaleString()} KRW · 1 EUR = ${Math.round(fx.krwPerEur).toLocaleString()} KRW`
      : undefined;

  return (
    <div className={cn("leading-tight", className)} title={rateHint}>
      <div className={cn("font-semibold font-mono", inverse ? "text-white" : "text-foreground")}>
        {primary}
      </div>
      {converted && (
        <div className={cn("text-xs font-mono mt-0.5", inverse ? "text-slate-400" : "text-muted-foreground")}>
          {converted}
        </div>
      )}
    </div>
  );
}
