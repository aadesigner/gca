import React from "react";
import { cn } from "@/lib/utils";

export function PageEnter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-[1.65rem] font-semibold tracking-tight text-foreground leading-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-stretch gap-2 w-full sm:w-auto sm:items-center [&>button]:flex-1 [&>button]:min-w-[calc(50%-0.25rem)] sm:[&>button]:flex-none sm:[&>button]:min-w-0 [&>a]:flex-1 [&>a]:min-w-[calc(50%-0.25rem)] sm:[&>a]:flex-none sm:[&>a]:min-w-0">
          {actions}
        </div>
      )}
    </div>
  );
}

export function Surface({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-card border border-border/80 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  icon: Icon,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border p-3.5 sm:p-5 transition-all duration-300",
        "[@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:shadow-[0_12px_32px_-16px_rgba(37,99,235,0.35)]",
        accent
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card border-border/80",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl transition-opacity duration-300",
          accent ? "bg-white/15 opacity-80" : "bg-primary/10 opacity-0 group-hover:opacity-100",
        )}
      />
      <div className="relative flex items-start justify-between gap-3">
        {Icon && (
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl",
              accent ? "bg-white/15" : "bg-primary/8 text-primary",
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="relative mt-4">
        <div className={cn("text-[1.35rem] sm:text-[1.7rem] font-semibold tracking-tight font-mono tabular-nums", accent ? "text-white" : "text-foreground")}>
          {value}
        </div>
        <div className={cn("mt-1 text-[11px] font-semibold uppercase tracking-[0.14em]", accent ? "text-white/75" : "text-muted-foreground")}>
          {label}
        </div>
        {hint && (
          <div className={cn("mt-1 text-xs", accent ? "text-white/70" : "text-muted-foreground")}>{hint}</div>
        )}
      </div>
    </div>
  );
}

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 rounded-2xl border border-border/80 bg-card/80 p-3 sm:p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-sm",
        "[&>input]:w-full [&>select]:w-full sm:[&>select]:w-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ProviderChip({ name }: { name?: string | null }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center rounded-full bg-primary/8 px-2.5 py-0.5 text-[11px] font-semibold text-primary ring-1 ring-primary/10">
      {name}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[220px] sm:min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-5 sm:px-8 py-10 sm:py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/8 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
