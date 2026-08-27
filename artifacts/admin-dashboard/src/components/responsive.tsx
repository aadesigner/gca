import React from "react";
import { cn } from "@/lib/utils";

export function ChipScroll({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 overflow-x-auto chip-scroll pb-0.5", className)}>
      {children}
    </div>
  );
}

export function TableScroll({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("table-scroll", className)}>
      {children}
    </div>
  );
}

export function DesktopTable({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("hidden md:block", className)}>{children}</div>;
}

export function MobileCards({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("md:hidden space-y-3", className)}>{children}</div>;
}

export function DataCard({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-2xl border border-border/80 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        onClick && "active:bg-muted/40",
        className,
      )}
    >
      {children}
    </Comp>
  );
}

export function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0 pt-0.5">
        {label}
      </span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}
