import React from "react";
import { Link } from "wouter";
import { useListApiClients } from "@workspace/api-client-react";
import { ArrowRight, ExternalLink, Users } from "lucide-react";
import { ClientPortalLinks, CLIENT_PORTAL_NAV_TOOLS } from "@/components/client-portal-links";
import { Button } from "@/components/ui/button";

export default function ClientPortalHub() {
  const { data: clients, isLoading, isError, error, refetch } = useListApiClients();

  const recent =
    clients
      ?.slice()
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 8) ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-1">
            Client portal
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Portal hub</h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            Manage everything clients see at <span className="font-mono text-foreground">/account/</span> — accounts,
            tokens, credits, support, and live feed. Each section below maps to a client-area tab.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/account/" target="_blank" rel="noopener noreferrer" className="gap-1.5">
              Open client portal
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
          <Button size="sm" asChild>
            <Link href="/api-clients" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              All accounts
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {CLIENT_PORTAL_NAV_TOOLS.filter((t) => t.href !== "/client-portal").map((tool) => {
          const Icon = tool.icon;
          return (
            <Link
              key={tool.href}
              href={tool.href}
              className="rounded-xl border border-border bg-card px-3 py-2.5 hover:border-primary/40 hover:bg-muted/30 transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <Icon className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">{tool.label}</span>
            </Link>
          );
        })}
      </div>

      <ClientPortalLinks />

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-border flex items-center justify-between gap-2">
          <h2 className="font-semibold text-sm">Newest portal accounts</h2>
          <Link href="/api-clients" className="text-xs text-primary hover:underline underline-offset-2">
            View all
          </Link>
        </div>
        <div className="divide-y divide-border">
          {isError ? (
            <div className="p-8 text-center text-sm">
              <p className="text-destructive">Could not load portal accounts.</p>
              <p className="text-muted-foreground mt-1">{(error as Error)?.message || "Request failed"}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
                Retry
              </Button>
            </div>
          ) : isLoading ? (
            <div className="p-8 text-center text-muted-foreground animate-pulse text-sm">Loading…</div>
          ) : recent.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No API clients yet.</div>
          ) : (
            recent.map((client: any) => (
              <Link
                key={client.id}
                href={`/api-clients/${client.id}`}
                className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 hover:bg-muted/30 transition-colors"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{client.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {client.email || "No email"}
                    {(client as any).telegramUsername ? ` · @${(client as any).telegramUsername}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-[10px] font-mono text-muted-foreground">
                  <span>{client.creditBalance ?? 0} cr</span>
                  <span>{client.tokenCount ?? 0} tok</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
