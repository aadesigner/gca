import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Clock, Filter, Trash2, Send, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "awaiting_client", label: "Awaiting client" },
  { value: "closed", label: "Closed" },
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

function statusClass(status: string) {
  switch (status) {
    case "open":
      return "bg-sky-500/15 text-sky-700 dark:text-sky-300";
    case "awaiting_client":
      return "bg-amber-500/15 text-amber-800 dark:text-amber-300";
    case "closed":
      return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

type Ticket = {
  id: number;
  clientId?: number;
  subject: string;
  status: string;
  adminUnread?: boolean;
  clientName?: string;
  clientEmail?: string;
  companyName?: string | null;
  websiteUrl?: string | null;
  preview?: string;
  lastMessageAt?: string;
};

type Message = {
  id: number;
  authorType: string;
  body: string;
  createdAt?: string;
};

export default function SupportTickets() {
  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const initialClientId = searchParams.get("clientId") || "";
  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState(initialClientId);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["support-tickets", status, clientId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (clientId) params.set("clientId", clientId);
      const q = params.toString();
      return api(`/admin/support/tickets${q ? `?${q}` : ""}`);
    },
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["support-ticket", selectedId],
    queryFn: () => api(`/admin/support/tickets/${selectedId}`),
    enabled: selectedId != null,
  });

  const items: Ticket[] = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const messages: Message[] = detail?.messages ?? [];
  const activeTicket: Ticket | null = detail?.ticket ?? null;

  useEffect(() => {
    if (selectedId == null && items.length > 0) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

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
      toast({ title: "Ticket removed" });
      if (selectedId === id) setSelectedId(null);
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Support tickets</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Client support threads from the portal — reply, change status, or remove.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unreadCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
              <LifeBuoy className="h-3.5 w-3.5" />
              {unreadCount} unread
            </span>
          )}
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="h-4 w-4 shrink-0" />
            <select
              className="h-10 min-w-[8.5rem] rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {clientId ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs">
              Client #{clientId}
              <Link href="/support-tickets" className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </Link>
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr] lg:items-start">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">Inbox</div>
          <div className="max-h-[min(70vh,640px)] overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground animate-pulse">Loading…</div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No tickets yet.</div>
            ) : (
              items.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                  className={cn(
                    "w-full border-b border-border/70 px-4 py-3 text-left transition-colors hover:bg-muted/40",
                    selectedId === row.id && "bg-muted/60",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold leading-snug line-clamp-2">{row.subject}</span>
                    {row.adminUnread ? (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-label="Unread" />
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{row.preview}</p>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate">{row.clientName || row.clientEmail}</span>
                    <span>{formatWhen(row.lastMessageAt)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card min-h-[420px] flex flex-col">
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center p-10 text-muted-foreground text-sm">
              Select a ticket
            </div>
          ) : detailLoading && !activeTicket ? (
            <div className="flex flex-1 items-center justify-center p-10 text-muted-foreground animate-pulse">
              Loading ticket…
            </div>
          ) : activeTicket ? (
            <>
              <div className="border-b border-border px-4 py-4 sm:px-5 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
                      statusClass(activeTicket.status),
                    )}
                  >
                    {activeTicket.status.replace("_", " ")}
                  </span>
                  <span className="text-xs text-muted-foreground">#{activeTicket.id}</span>
                </div>
                <h2 className="text-lg font-semibold leading-snug">{activeTicket.subject}</h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    {activeTicket.clientName}
                  </span>
                  {activeTicket.clientId ? (
                    <Link
                      href={`/api-clients/${activeTicket.clientId}`}
                      className="text-primary hover:underline underline-offset-2 text-xs font-medium"
                    >
                      Open portal account →
                    </Link>
                  ) : null}
                  {activeTicket.clientEmail ? <span>{activeTicket.clientEmail}</span> : null}
                  {activeTicket.companyName ? <span>{activeTicket.companyName}</span> : null}
                  {activeTicket.websiteUrl ? (
                    <a
                      href={activeTicket.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-foreground break-all"
                    >
                      {activeTicket.websiteUrl.replace(/^https?:\/\//, "")}
                    </a>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {activeTicket.status !== "open" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updateStatus.isPending}
                      onClick={() => updateStatus.mutate({ id: activeTicket.id, status: "open" })}
                    >
                      Reopen
                    </Button>
                  )}
                  {activeTicket.status !== "awaiting_client" && activeTicket.status !== "closed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updateStatus.isPending}
                      onClick={() =>
                        updateStatus.mutate({ id: activeTicket.id, status: "awaiting_client" })
                      }
                    >
                      Awaiting client
                    </Button>
                  )}
                  {activeTicket.status !== "closed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updateStatus.isPending}
                      onClick={() => updateStatus.mutate({ id: activeTicket.id, status: "closed" })}
                    >
                      Close
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (!confirm(`Remove ticket "${activeTicket.subject}"?`)) return;
                      remove.mutate(activeTicket.id);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Remove
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 space-y-3 max-h-[min(50vh,480px)]">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "rounded-lg px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
                      msg.authorType === "admin"
                        ? "bg-primary/10 border border-primary/15 ml-4 sm:ml-10"
                        : "bg-muted/50 border border-border mr-4 sm:mr-10",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <strong className="font-semibold uppercase tracking-wide">
                        {msg.authorType === "admin" ? "You" : "Client"}
                      </strong>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatWhen(msg.createdAt)}
                      </span>
                    </div>
                    {msg.body}
                  </div>
                ))}
              </div>

              {activeTicket.status !== "closed" ? (
                <div className="border-t border-border px-4 py-4 sm:px-5 space-y-2">
                  <Textarea
                    placeholder="Write a reply…"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={3}
                  />
                  <Button
                    disabled={sendReply.isPending || reply.trim().length < 2}
                    onClick={() => sendReply.mutate({ id: activeTicket.id, message: reply.trim() })}
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Send reply
                  </Button>
                </div>
              ) : (
                <div className="border-t border-border px-4 py-4 text-sm text-muted-foreground">
                  Ticket is closed. Reopen to reply.
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
