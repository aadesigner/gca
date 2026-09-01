import React from "react";
import { Link } from "wouter";
import {
  Activity,
  BarChart3,
  BookOpen,
  Car,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Radio,
  Settings,
  User,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Mirrors tabs in /account/ (client portal). */
export const CLIENT_PORTAL_AREAS = [
  {
    clientTab: "Overview",
    adminLabel: "Account overview",
    description: "Credits, usage KPIs, live feed status",
    icon: LayoutDashboard,
    href: (clientId: number) => `/api-clients/${clientId}`,
    anchor: undefined,
  },
  {
    clientTab: "API keys",
    adminLabel: "API tokens",
    description: "Issue production keys, revoke test keys",
    icon: KeyRound,
    href: (clientId: number) => `/api-tokens?clientId=${clientId}`,
  },
  {
    clientTab: "Test VINs",
    adminLabel: "Test VIN policy",
    description: "Curated demo VINs — global billing settings",
    icon: Car,
    href: () => `/settings`,
    anchor: "billing",
  },
  {
    clientTab: "Usage",
    adminLabel: "API usage & logs",
    description: "Charts, paths, request history",
    icon: BarChart3,
    href: (clientId: number) => `/api-usage?clientId=${clientId}`,
    secondaryHref: (clientId: number) => `/api-logs?clientId=${clientId}`,
    secondaryLabel: "Raw logs",
  },
  {
    clientTab: "Credits",
    adminLabel: "Credit purchases",
    description: "Approve crypto top-ups, adjust balance",
    icon: Wallet,
    href: (clientId: number) => `/credit-purchases?clientId=${clientId}`,
  },
  {
    clientTab: "Support",
    adminLabel: "Support tickets",
    description: "Live feed requests, billing, production keys",
    icon: LifeBuoy,
    href: (clientId: number) => `/support-tickets?clientId=${clientId}`,
  },
  {
    clientTab: "API docs",
    adminLabel: "Public API docs",
    description: "Same OpenAPI the client sees",
    icon: BookOpen,
    href: () => "/docs",
    external: true,
  },
  {
    clientTab: "Profile",
    adminLabel: "Profile & company",
    description: "Email, Telegram, website, portal password",
    icon: User,
    href: (clientId: number) => `/api-clients/${clientId}`,
    anchor: "profile",
  },
  {
    clientTab: "Live feed",
    adminLabel: "Live Feed Korea",
    description: "€200/mo — enable after support ticket",
    icon: Radio,
    href: (clientId: number) => `/api-clients/${clientId}`,
    anchor: "live-feed",
  },
] as const;

export function ClientPortalLinks({
  clientId,
  compact = false,
  className,
}: {
  clientId?: number;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Client portal map</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each card matches a tab in <span className="font-mono">/account/</span>
            {clientId ? ` for client #${clientId}` : ""}.
          </p>
        </div>
        {!clientId && (
          <Link
            href="/api-clients"
            className="text-xs font-medium text-primary hover:underline underline-offset-2"
          >
            All portal accounts →
          </Link>
        )}
      </div>
      <div
        className={cn(
          "grid gap-2",
          compact ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
        )}
      >
        {CLIENT_PORTAL_AREAS.map((area) => {
          const Icon = area.icon;
          const baseHref = clientId != null ? area.href(clientId) : area.href(0).replace(/\?clientId=0/, "").replace(/\/0$/, "");
          const hash = area.anchor ? `#${area.anchor}` : "";
          const path = `${baseHref}${hash}`;

          const inner = (
            <>
              <div className="flex items-start gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {area.clientTab}
                    </span>
                    <span className="text-muted-foreground/40">→</span>
                    <span className="text-sm font-semibold text-foreground">{area.adminLabel}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{area.description}</p>
                  {"secondaryHref" in area && area.secondaryHref && clientId != null && (
                    <p className="text-[11px] mt-1.5">
                      <Link
                        href={area.secondaryHref(clientId)}
                        className="text-primary hover:underline underline-offset-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {area.secondaryLabel} →
                      </Link>
                    </p>
                  )}
                </div>
              </div>
            </>
          );

          if ("external" in area && area.external) {
            return (
              <a
                key={area.clientTab}
                href={path}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-border bg-card p-3.5 hover:border-primary/40 hover:bg-muted/20 transition-colors text-left"
              >
                {inner}
              </a>
            );
          }

          return (
            <Link
              key={area.clientTab}
              href={path}
              className="rounded-xl border border-border bg-card p-3.5 hover:border-primary/40 hover:bg-muted/20 transition-colors text-left block"
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Global client-portal admin shortcuts (no specific client). */
export const CLIENT_PORTAL_NAV_TOOLS = [
  { href: "/client-portal", label: "Portal hub", icon: LayoutDashboard },
  { href: "/api-clients", label: "Portal accounts", icon: User },
  { href: "/support-tickets", label: "Support tickets", icon: LifeBuoy },
  { href: "/credit-purchases", label: "Credit purchases", icon: CreditCard },
  { href: "/api-tokens", label: "API tokens", icon: KeyRound },
  { href: "/api-usage", label: "API usage", icon: BarChart3 },
  { href: "/api-logs", label: "API logs", icon: Activity },
  { href: "/settings", label: "Portal settings", icon: Settings },
] as const;
