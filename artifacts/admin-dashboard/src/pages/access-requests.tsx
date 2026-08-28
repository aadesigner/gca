import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Inbox, Mail, MessageCircle, Clock, Filter, Globe, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const SERVICE_LABEL: Record<string, string> = {
  live_feed: "Live feed",
  vin_api: "API token (reports)",
  both: "Live feed + API",
};

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "new", label: "New" },
  { value: "read", label: "Read" },
  { value: "contacted", label: "Contacted" },
  { value: "closed", label: "Closed" },
] as const;

function formatWhen(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusClass(status: string) {
  switch (status) {
    case "new":
      return "bg-sky-500/15 text-sky-700 dark:text-sky-300";
    case "read":
      return "bg-muted text-muted-foreground";
    case "contacted":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "closed":
      return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

type AccessRequest = {
  id: number;
  email: string;
  telegramUsername?: string | null;
  websiteUrl?: string | null;
  serviceInterest: string;
  message: string;
  status: string;
  adminNote?: string | null;
  ipAddress?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export default function AccessRequests() {
  const [status, setStatus] = useState("new");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["access-requests", status],
    queryFn: () =>
      api(`/admin/access-requests${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  });

  const update = useMutation({
    mutationFn: ({
      id,
      status: nextStatus,
      adminNote,
    }: {
      id: number;
      status?: string;
      adminNote?: string;
    }) =>
      api(`/admin/access-requests/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus, adminNote }),
      }),
    onSuccess: () => {
      toast({ title: "Request updated" });
      qc.invalidateQueries({ queryKey: ["access-requests"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      api(`/admin/access-requests/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Request removed" });
      qc.invalidateQueries({ queryKey: ["access-requests"] });
      qc.invalidateQueries({ queryKey: ["access-requests-bell"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const items: AccessRequest[] = data?.items ?? [];
  const newCount = data?.newCount ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Access requests</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Contact forms from “Get API key” — email, Telegram, service interest, and message.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {newCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300">
              <Inbox className="h-3.5 w-3.5" />
              {newCount} new
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
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground animate-pulse">Loading…</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground sm:p-12">
            No {status || ""} requests yet.
          </div>
        ) : (
          items.map((row) => (
            <article
              key={row.id}
              className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
                        statusClass(row.status),
                      )}
                    >
                      {row.status}
                    </span>
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                      {SERVICE_LABEL[row.serviceInterest] || row.serviceInterest}
                    </span>
                  </div>
                  <a
                    href={`mailto:${row.email}`}
                    className="flex items-center gap-1.5 break-all text-sm font-semibold hover:underline"
                  >
                    <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {row.email}
                  </a>
                  {row.telegramUsername ? (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MessageCircle className="h-3.5 w-3.5 shrink-0" />@{row.telegramUsername}
                    </p>
                  ) : null}
                  {row.websiteUrl ? (
                    <a
                      href={row.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground break-all"
                    >
                      <Globe className="h-3.5 w-3.5 shrink-0" />
                      {row.websiteUrl.replace(/^https?:\/\//, "")}
                    </a>
                  ) : null}
                  {!row.telegramUsername && !row.websiteUrl ? (
                    <p className="text-xs text-muted-foreground">No Telegram / website</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:justify-end">
                  <Clock className="h-3.5 w-3.5" />
                  <time dateTime={row.createdAt || undefined}>{formatWhen(row.createdAt)}</time>
                </div>
              </div>

              <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words">
                {row.message}
              </div>

              <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
                <Input
                  placeholder="Admin note (optional)"
                  className="sm:flex-1"
                  value={notes[row.id] ?? row.adminNote ?? ""}
                  onChange={(e) => setNotes((s) => ({ ...s, [row.id]: e.target.value }))}
                />
                <div className="flex flex-wrap gap-2">
                  {row.status === "new" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: row.id, status: "read" })}
                    >
                      Mark read
                    </Button>
                  )}
                  {row.status !== "contacted" && (
                    <Button
                      size="sm"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({
                          id: row.id,
                          status: "contacted",
                          adminNote: notes[row.id] ?? row.adminNote ?? undefined,
                        })
                      }
                    >
                      Contacted
                    </Button>
                  )}
                  {row.status !== "closed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({
                          id: row.id,
                          status: "closed",
                          adminNote: notes[row.id] ?? row.adminNote ?? undefined,
                        })
                      }
                    >
                      Close
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={update.isPending}
                    onClick={() =>
                      update.mutate({
                        id: row.id,
                        adminNote: notes[row.id] ?? "",
                      })
                    }
                  >
                    Save note
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (!confirm(`Remove request from ${row.email}?`)) return;
                      remove.mutate(row.id);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Remove
                  </Button>
                </div>
              </div>

              {row.adminNote ? (
                <p className="text-xs text-muted-foreground">Saved note: {row.adminNote}</p>
              ) : null}
              {row.ipAddress ? (
                <p className="text-[11px] text-muted-foreground/80 font-mono">IP {row.ipAddress}</p>
              ) : null}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
