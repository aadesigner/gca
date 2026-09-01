import React, { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Wallet, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

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

export default function CreditPurchases() {
  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const initialClientId = searchParams.get("clientId") || "";
  const [status, setStatus] = useState("pending");
  const [clientId] = useState(initialClientId);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["credit-purchases", status, clientId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (clientId) params.set("clientId", clientId);
      return api(`/admin/credit-purchases?${params}`);
    },
  });

  const approve = useMutation({
    mutationFn: ({ id, adminNote }: { id: number; adminNote?: string }) =>
      api(`/admin/credit-purchases/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ adminNote }),
      }),
    onSuccess: () => {
      toast({ title: "Purchase approved — credits added" });
      qc.invalidateQueries({ queryKey: ["credit-purchases"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: ({ id, adminNote }: { id: number; adminNote?: string }) =>
      api(`/admin/credit-purchases/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ adminNote }),
      }),
    onSuccess: () => {
      toast({ title: "Purchase rejected" });
      qc.invalidateQueries({ queryKey: ["credit-purchases"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Credit purchases</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manual crypto verification. Approving credits the client account.
          </p>
        </div>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
        {clientId ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs">
            Client #{clientId}
            <Link href="/credit-purchases" className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </Link>
          </span>
        ) : null}
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground animate-pulse">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground border border-dashed border-border rounded-xl">
            No {status || ""} purchases.
          </div>
        ) : (
          items.map((row: any) => (
            <article key={row.id} className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Wallet className="w-4 h-4 text-muted-foreground" />
                    <strong>{row.clientName || `Client #${row.clientId}`}</strong>
                    {row.clientId ? (
                      <Link
                        href={`/api-clients/${row.clientId}`}
                        className="text-xs text-primary hover:underline underline-offset-2"
                      >
                        Portal account
                      </Link>
                    ) : null}
                    <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-muted">{row.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-1">{row.clientEmail || "—"}</p>
                </div>
                <div className="text-right text-sm">
                  <div className="font-mono font-semibold">{row.credits} credits</div>
                  <div className="text-muted-foreground">${row.amountUsd} · {row.cryptoCurrency?.replace(/_/g, " ")}</div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Tx:</span> <span className="font-mono break-all">{row.txHash || "—"}</span></div>
                <div><span className="text-muted-foreground">Note:</span> {row.payerNote || "—"}</div>
                <div>
                  <span className="text-muted-foreground">Proof:</span>{" "}
                  {row.hasProof ? (
                    <a
                      href={`/api/admin/credit-purchases/${row.id}/proof`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      View screenshot
                    </a>
                  ) : (
                    "—"
                  )}
                </div>
                <div className="text-muted-foreground text-xs">{row.createdAt ? new Date(row.createdAt).toLocaleString() : ""}</div>
              </div>
              {row.status === "pending" && (
                <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border">
                  <Input
                    placeholder="Admin note (optional)"
                    value={notes[row.id] ?? ""}
                    onChange={(e) => setNotes((s) => ({ ...s, [row.id]: e.target.value }))}
                  />
                  <Button
                    className="gap-1"
                    onClick={() => approve.mutate({ id: row.id, adminNote: notes[row.id] })}
                    disabled={approve.isPending}
                  >
                    <Check className="w-4 h-4" /> Approve
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-1"
                    onClick={() => reject.mutate({ id: row.id, adminNote: notes[row.id] })}
                    disabled={reject.isPending}
                  >
                    <X className="w-4 h-4" /> Reject
                  </Button>
                </div>
              )}
              {row.adminNote && <p className="text-xs text-muted-foreground">Admin: {row.adminNote}</p>}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
