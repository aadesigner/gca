import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Bell, LifeBuoy } from "lucide-react";
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

type SupportItem = {
  id: number;
  subject: string;
  clientName?: string;
  clientEmail?: string;
  lastMessageAt?: string;
};

export function AdminNotificationBell() {
  const { data: supportData } = useQuery({
    queryKey: ["support-tickets-bell"],
    queryFn: async () => {
      const [countBody, listBody] = await Promise.all([
        api("/admin/support/unread-count"),
        api("/admin/support/tickets"),
      ]);
      const items = (listBody?.items ?? []).filter((t: SupportItem & { adminUnread?: boolean }) => t.adminUnread);
      return { unreadCount: Number(countBody?.unreadCount ?? 0), items: items.slice(0, 6) };
    },
    refetchInterval: 45_000,
    staleTime: 20_000,
  });

  const supportItems: SupportItem[] = supportData?.items ?? [];
  const totalCount = Number(supportData?.unreadCount ?? 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground",
            "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label={totalCount > 0 ? `${totalCount} support notifications` : "Notifications"}
        >
          <Bell className="h-4 w-4" />
          {totalCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-bold leading-none text-white">
              {totalCount > 99 ? "99+" : totalCount}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(100vw-2rem,22rem)]">
        <DropdownMenuLabel className="flex items-center justify-between gap-2 font-semibold">
          <span>Support tickets</span>
          {totalCount > 0 ? (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
              {totalCount} unread
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {supportItems.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">No unread tickets</div>
        ) : (
          supportItems.map((row) => (
            <DropdownMenuItem key={row.id} asChild className="cursor-pointer p-0">
              <Link href="/support-tickets" className="flex flex-col items-start gap-0.5 px-2 py-2.5">
                <span className="w-full truncate text-sm font-medium">{row.subject}</span>
                <span className="flex w-full items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{row.clientName || row.clientEmail || "Client"}</span>
                  <span>{relativeTime(row.lastMessageAt)}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer">
          <Link href="/support-tickets" className="flex items-center gap-2">
            <LifeBuoy className="h-3.5 w-3.5" />
            Open support inbox
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
