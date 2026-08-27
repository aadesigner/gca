import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Bell, Inbox } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

async function api(path: string) {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

const SERVICE_LABEL: Record<string, string> = {
  live_feed: "Live feed",
  vin_api: "API token",
  both: "Live + API",
};

function relativeTime(iso?: string) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

type Item = {
  id: number;
  email: string;
  serviceInterest: string;
  createdAt?: string;
  status: string;
};

export function AccessRequestBell() {
  const { data } = useQuery({
    queryKey: ["access-requests-bell"],
    queryFn: () => api("/admin/access-requests?status=new"),
    refetchInterval: 45_000,
    staleTime: 20_000,
  });

  const items: Item[] = (data?.items ?? []).slice(0, 6);
  const newCount = Number(data?.newCount ?? items.length);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground",
            "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label={newCount > 0 ? `${newCount} new access requests` : "Access requests"}
        >
          <Bell className="h-4.5 w-4.5 h-4 w-4" />
          {newCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-bold leading-none text-white">
              {newCount > 99 ? "99+" : newCount}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(100vw-2rem,20rem)]">
        <DropdownMenuLabel className="flex items-center justify-between gap-2 font-semibold">
          <span>Access requests</span>
          {newCount > 0 ? (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
              {newCount} new
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">No new requests</div>
        ) : (
          items.map((row) => (
            <DropdownMenuItem key={row.id} asChild className="cursor-pointer p-0">
              <Link href="/access-requests" className="flex flex-col items-start gap-0.5 px-2 py-2.5">
                <span className="w-full truncate text-sm font-medium">{row.email}</span>
                <span className="flex w-full items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>{SERVICE_LABEL[row.serviceInterest] || row.serviceInterest}</span>
                  <span>{relativeTime(row.createdAt)}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer">
          <Link href="/access-requests" className="flex items-center gap-2">
            <Inbox className="h-3.5 w-3.5" />
            View all requests
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
