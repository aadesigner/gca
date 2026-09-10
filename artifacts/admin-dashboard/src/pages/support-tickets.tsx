import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LifeBuoy,
  Search,
  Trash2,
  Send,
  User,
  X,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "awaiting_client", label: "Awaiting client" },
  { value: "closed", label: "Closed" },
] as const;

const CATEGORY_OPTIONS = [
  { value: "", label: "All categories" },
  { value: "billing", label: "Billing" },
  { value: "live_feed", label: "Live feed" },
  { value: "api", label: "API" },
  { value: "account", label: "Account" },
  { value: "other", label: "Other" },
] as const;

function formatWhen(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relTime(iso?: string | null) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return formatWhen(iso);
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return formatWhen(iso);
}

function statusLabel(status: string) {
  if (status === "awaiting_client") return "Awaiting client";
  if (status === "closed") return "Closed";
  return "Open";
}

function categoryLabel(category?: string | null) {
  switch (category) {
    case "billing":
      return "Billing";
    case "live_feed":
      return "Live feed";
    case "api":
      return "API";
    case "account":
      return "Account";
    default:
      return "Other";
  }
}

function statusClass(status: string) {
  switch (status) {
    case "open":
      return "bg-sky-500/15 text-sky-800 dark:text-sky-300";
    case "awaiting_client":
      return "bg-amber-500/15 text-amber-900 dark:text-amber-300";
    case "closed":
      return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

type Ticket = {
  id: number;
  clientId?: number;
  subject: string;
  category?: string;
  status: string;
  adminUnread?: boolean;
  clientName?: string;
  clientEmail?: string;
  companyName?: string | null;
  websiteUrl?: string | null;
  preview?: string;
  lastMessageAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

type Message = {
  id: number;
  authorType: string;
  body: string;
  createdAt?: string;
};

export default function SupportTickets() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const clientIdFilter = searchParams.get("clientId") || "";
  const ticketFromUrl = parsePositiveInt(searchParams.get("ticket"));

  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(ticketFromUrl);
  const [reply, setReply] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 280);
    return () => clearTimeout(t);
  }, [q]);

  const {
    data,
    isLoading,
    isError: listError,
    error: listErr,
    refetch: refetchList,
  } = useQuery({
    queryKey: ["support-tickets", status, category, qDebounced, unreadOnly, clientIdFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (category) params.set("category", category);
      if (qDebounced) params.set("q", qDebounced);
      if (unreadOnly) params.set("unread", "1");
      if (clientIdFilter) params.set("clientId", clientIdFilter);
      const qs = params.toString();
      return api(`/admin/support/tickets${qs ? `?${qs}` : ""}`);
    },
    refetchInterval: 45_000,
  });

  const {
    data: detail,
    isLoading: detailLoading,
    isError: detailError,
    error: detailErr,
    refetch: refetchDetail,
  } = useQuery({
    queryKey: ["support-ticket", selectedId],
    queryFn: () => api(`/admin/support/tickets/${selectedId}`),
    enabled: selectedId != null,
    refetchInterval: selectedId != null ? 40_000 : false,
  });

  const items: Ticket[] = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const messages: Message[] = detail?.messages ?? [];
  const activeTicket: Ticket | null = detail?.ticket ?? null;

  useEffect(() => {
    if (ticketFromUrl != null) setSelectedId(ticketFromUrl);
  }, [ticketFromUrl]);

  useEffect(() => {
    if (selectedId == null && items.length > 0) setSelectedId(items[0].id);
  }, [items, selectedId]);

  useEffect(() => {
    if (selectedId == null || items.length === 0) return;
    if (items.some((row) => row.id === selectedId)) return;
    // Keep deep-linked ticket even if filters exclude it from the list.
    if (ticketFromUrl != null && selectedId === ticketFromUrl) return;
    setSelectedId(items[0].id);
  }, [items, selectedId, ticketFromUrl]);

  const selectTicket = (id: number) => {
    setSelectedId(id);
    setReply("");
    const next = new URLSearchParams(search);
    next.set("ticket", String(id));
    const qs = next.toString();
    setLocation(`/support-tickets${qs ? `?${qs}` : ""}`, { replace: true });
  };

  const clearClientFilter = () => {
    const next = new URLSearchParams(search);
    next.delete("clientId");
    const qs = next.toString();
    setLocation(`/support-tickets${qs ? `?${qs}` : ""}`);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["support-tickets"] });
    qc.invalidateQueries({ queryKey: ["support-tickets-bell"] });
    if (selectedId != null) qc.invalidateQueries({ queryKey: ["support-ticket", selectedId] });
  };

  const updateStatus = useMutation({
    mutationFn: ({ id, status: next }: { id: number; status: string }) =>
      api(`/admin/support/tickets/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      }),
    onSuccess: () => {
      toast({ title: "Ticket updated" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const sendReply = useMutation({
    mutationFn: ({ id, message }: { id: number; message: string }) =>
      api(`/admin/support/tickets/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    onSuccess: () => {
      setReply("");
      toast({ title: "Reply sent" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/admin/support/tickets/${id}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      toast({ title: "Ticket deleted" });
      if (selectedId === id) {
        setSelectedId(null);
        const next = new URLSearchParams(search);
        next.delete("ticket");
        const qs = next.toString();
        setLocation(`/support-tickets${qs ? `?${qs}` : ""}`, { replace: true });
      }
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const submitReply = () => {
    if (!activeTicket || reply.trim().length < 2) return;
    sendReply.mutate({ id: activeTicket.id, message: reply.trim() });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Support</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Client tickets — triage by status and category, reply formally.
          </p>
        </div>
        {unreadCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:text-amber-300">
            <LifeBuoy className="h-3.5 w-3.5" />
            {unreadCount} unread
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8 text-sm"
            placeholder="Search tickets…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search tickets"
          />
        </div>
        <select
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value || "all-status"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
        >
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value || "all-cat"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm">
          <input
            type="checkbox"
            className="rounded border-input"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          Unread only
        </label>
        {clientIdFilter ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs">
            Client #{clientIdFilter}
            <button
              type="button"
              onClick={clearClientFilter}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear client filter"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-stretch min-h-[min(70vh,720px)]">
        <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
          <div className="border-b border-border px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tickets
          </div>
          <div className="flex-1 overflow-y-auto max-h-[min(70vh,720px)]">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground animate-pulse text-sm">Loading…</div>
            ) : listError ? (
              <div className="p-6 space-y-3 text-center">
                <p className="text-sm text-destructive">
                  {(listErr as Error)?.message || "Could not load tickets."}
                </p>
                <Button size="sm" variant="outline" onClick={() => refetchList()}>
                  Retry
                </Button>
              </div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground space-y-2">
                <p>
                  {clientIdFilter || status || category || qDebounced || unreadOnly
                    ? "No matches for these filters."
                    : "No tickets yet."}
                </p>
                {clientIdFilter ? (
                  <Button size="sm" variant="outline" onClick={clearClientFilter}>
                    Show all tickets
                  </Button>
                ) : null}
              </div>
            ) : (
              items.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => selectTicket(row.id)}
                  className={cn(
                    "w-full border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
                    selectedId === row.id && "bg-muted/55",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {row.adminUnread ? (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-label="Unread" />
                    ) : (
                      <span className="mt-1.5 h-2 w-2 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className={cn("text-sm leading-snug line-clamp-2", row.adminUnread && "font-semibold")}>
                        {row.subject}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {categoryLabel(row.category)}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                            statusClass(row.status),
                          )}
                        >
                          {statusLabel(row.status)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">{row.clientName || row.clientEmail}</span>
                        <span className="shrink-0">{relTime(row.lastMessageAt)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card min-h-[420px] flex flex-col overflow-hidden">
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center p-10 text-muted-foreground text-sm">
              Select a ticket
            </div>
          ) : detailLoading && !activeTicket ? (
            <div className="flex flex-1 items-center justify-center p-10 text-muted-foreground animate-pulse text-sm">
              Loading ticket…
            </div>
          ) : detailError && !activeTicket ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
              <p className="text-sm text-destructive">
                {(detailErr as Error)?.message || "Could not open this ticket."}
              </p>
              <Button size="sm" variant="outline" onClick={() => refetchDetail()}>
                Retry
              </Button>
            </div>
          ) : activeTicket ? (
            <>
              <div className="sticky top-0 z-[1] border-b border-border bg-card/95 backdrop-blur px-4 py-3 sm:px-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      #{activeTicket.id}
                    </p>
                    <h2 className="text-lg font-semibold leading-snug">{activeTicket.subject}</h2>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {categoryLabel(activeTicket.category)}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          statusClass(activeTicket.status),
                        )}
                      >
                        {statusLabel(activeTicket.status)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["open", "Open"],
                        ["awaiting_client", "Awaiting"],
                        ["closed", "Close"],
                      ] as const
                    ).map(([value, label]) => (
                      <Button
                        key={value}
                        size="sm"
                        variant={activeTicket.status === value ? "default" : "outline"}
                        disabled={updateStatus.isPending || activeTicket.status === value}
                        onClick={() => updateStatus.mutate({ id: activeTicket.id, status: value })}
                      >
                        {label}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (
                          !confirm(
                            `Delete ticket "${activeTicket.subject}" permanently? This cannot be undone.`,
                          )
                        ) {
                          return;
                        }
                        remove.mutate(activeTicket.id);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      Delete permanently
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 text-foreground font-medium">
                      <User className="h-3.5 w-3.5" />
                      {activeTicket.clientName}
                    </span>
                    {activeTicket.clientEmail ? <span>{activeTicket.clientEmail}</span> : null}
                    {activeTicket.companyName ? <span>{activeTicket.companyName}</span> : null}
                    {activeTicket.clientId ? (
                      <Link
                        href={`/api-clients/${activeTicket.clientId}`}
                        className="inline-flex items-center gap-1 text-primary hover:underline underline-offset-2 text-xs font-medium"
                      >
                        Portal account
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : null}
                    {activeTicket.websiteUrl ? (
                      <a
                        href={activeTicket.websiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-foreground break-all text-xs"
                      >
                        {String(activeTicket.websiteUrl).replace(/^https?:\/\//, "")}
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto bg-muted/20 px-4 py-4 sm:px-5 space-y-3 max-h-[min(52vh,520px)]">
                {messages.map((msg) => {
                  const isAdmin = msg.authorType === "admin";
                  return (
                    <article
                      key={msg.id}
                      className={cn(
                        "rounded-lg border bg-card px-3.5 py-3 text-sm shadow-sm",
                        isAdmin ? "border-l-[3px] border-l-sky-500 border-border" : "border-l-[3px] border-l-emerald-500/80 border-border",
                      )}
                    >
                      <header className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="font-bold uppercase tracking-wider text-foreground/80">
                          {isAdmin ? "Admin" : "Client"}
                        </span>
                        <time>{formatWhen(msg.createdAt)}</time>
                      </header>
                      <div className="leading-relaxed whitespace-pre-wrap break-words">{msg.body}</div>
                    </article>
                  );
                })}
              </div>

              {activeTicket.status !== "closed" ? (
                <div className="border-t border-border px-4 py-3 sm:px-5 space-y-2 bg-card">
                  <Textarea
                    placeholder="Write a reply…"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={3}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        submitReply();
                      }
                    }}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">Ctrl+Enter to send</span>
                    <Button
                      size="sm"
                      disabled={sendReply.isPending || reply.trim().length < 2}
                      onClick={submitReply}
                    >
                      <Send className="w-3.5 h-3.5 mr-1.5" />
                      Send reply
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="border-t border-border px-4 py-4 text-sm text-muted-foreground bg-amber-500/5">
                  Ticket is closed. Set status to Open to reply.
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
