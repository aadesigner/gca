import React, { useEffect, useState } from "react";
import { 
  useListApiTokens, 
  useCreateApiToken, 
  useRevokeApiToken,
  useListApiClients,
  getListApiTokensQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Ban, Copy, Check, Radio, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function ApiTokens() {
  const searchParams = new URLSearchParams(window.location.search);
  const initialClientId = searchParams.get("clientId");
  
  const [filterClientId, setFilterClientId] = useState<string>(initialClientId || "");
  const { data: clients, isError: clientsError, error: clientsLoadError } = useListApiClients();
  const {
    data: tokensList,
    isLoading,
    isError,
    error,
    refetch,
  } = useListApiTokens({
    clientId: filterClientId ? parseInt(filterClientId, 10) : undefined,
  });
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const revokeMutation = useRevokeApiToken();
  const [regenBusy, setRegenBusy] = useState<number | null>(null);
  const [deleteBusy, setDeleteBusy] = useState<number | null>(null);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeLegacyBusy, setPurgeLegacyBusy] = useState(false);

  const handleRevoke = (id: number) => {
    if (!confirm("Are you sure you want to permanently revoke this token? Any active services using it will immediately fail.")) return;
    revokeMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Token revoked" });
        queryClient.invalidateQueries({ queryKey: getListApiTokensQueryKey() });
      }
    });
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Permanently delete this revoked token from the list?")) return;
    setDeleteBusy(id);
    try {
      const res = await fetch(`/api/admin/api-tokens/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Delete failed");
      toast({ title: "Token removed" });
      queryClient.invalidateQueries({ queryKey: getListApiTokensQueryKey() });
    } catch (e: any) {
      toast({ title: e.message || "Delete failed", variant: "destructive" });
    } finally {
      setDeleteBusy(null);
    }
  };

  const handlePurgeRevoked = async () => {
    const scope = filterClientId ? "for this client" : "for all clients";
    if (!confirm(`Permanently delete all revoked / inactive tokens ${scope}?`)) return;
    setPurgeBusy(true);
    try {
      const res = await fetch("/api/admin/api-tokens/purge-revoked", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filterClientId ? { clientId: parseInt(filterClientId) } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Purge failed");
      toast({ title: `Removed ${body.deleted ?? 0} token(s)` });
      queryClient.invalidateQueries({ queryKey: getListApiTokensQueryKey() });
    } catch (e: any) {
      toast({ title: e.message || "Purge failed", variant: "destructive" });
    } finally {
      setPurgeBusy(false);
    }
  };

  const handleRegenerate = async (id: number) => {
    if (!confirm("Regenerate this token? The old secret stops working immediately.")) return;
    setRegenBusy(id);
    try {
      const res = await fetch(`/api/admin/api-tokens/${id}/regenerate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Regenerate failed");
      setNewTokenValue(body.tokenValue);
      toast({ title: "Token regenerated — copy the new secret" });
      queryClient.invalidateQueries({ queryKey: getListApiTokensQueryKey() });
    } catch (e: any) {
      toast({ title: e.message || "Regenerate failed", variant: "destructive" });
    } finally {
      setRegenBusy(null);
    }
  };

  const handlePurgeLegacyTest = async () => {
    if (!confirm("Permanently delete ALL legacy sandbox-only (test) API keys? Production keys are kept.")) return;
    setPurgeLegacyBusy(true);
    try {
      const res = await fetch("/api/admin/api-tokens/purge-legacy-test-keys", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Purge failed");
      const needing = body.clientsNeedingKey?.length ?? 0;
      toast({
        title: `Removed ${body.deleted ?? 0} legacy test key(s)`,
        description: needing
          ? `${needing} client(s) need a production key issued manually.`
          : undefined,
      });
      queryClient.invalidateQueries({ queryKey: getListApiTokensQueryKey() });
    } catch (e: any) {
      toast({ title: e.message || "Purge failed", variant: "destructive" });
    } finally {
      setPurgeLegacyBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Tokens</h1>
          <p className="text-muted-foreground text-sm mt-1">One production key per client. Generate, revoke, or regenerate from here.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handlePurgeLegacyTest} disabled={purgeLegacyBusy} className="gap-2">
            <Trash2 className="w-4 h-4" />
            {purgeLegacyBusy ? "Purging…" : "Remove legacy test keys"}
          </Button>
          <Button variant="outline" onClick={handlePurgeRevoked} disabled={purgeBusy} className="gap-2">
            <Trash2 className="w-4 h-4" />
            {purgeBusy ? "Cleaning…" : "Remove revoked"}
          </Button>
          <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Generate Token
          </Button>
        </div>
      </div>

      <MarketingDemoCard onIssued={(val) => setNewTokenValue(val)} />

      {(isError || clientsError) && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-destructive">
            {(error as Error)?.message || (clientsLoadError as Error)?.message || "Could not load tokens."}
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      <div className="flex items-center gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
        <select 
          className="flex h-10 w-full sm:w-[300px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={filterClientId}
          onChange={e => {
            setFilterClientId(e.target.value);
            const url = new URL(window.location.href);
            if (e.target.value) url.searchParams.set("clientId", e.target.value);
            else url.searchParams.delete("clientId");
            window.history.replaceState({}, '', url.toString());
          }}
        >
          <option value="">All Clients</option>
          {clients?.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
              <tr>
                <th className="px-6 py-4">Token Name</th>
                <th className="px-6 py-4">Client</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Last Used</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
                    Loading tokens…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    Token list failed to load.
                  </td>
                </tr>
              ) : !tokensList || tokensList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    No tokens found.
                  </td>
                </tr>
              ) : (
                tokensList.map(token => (
                  <tr key={token.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-muted-foreground" />
                        {token.name}
                        {(token as any).isTestOnly ? (
                          <span className="text-[10px] font-bold uppercase text-amber-700">Test</span>
                        ) : null}
                      </div>
                      <div className="text-xs font-mono text-muted-foreground mt-1">
                        {(token as any).tokenPrefix ? `${(token as any).tokenPrefix}…` : "Prefix hidden"}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-medium">
                      {token.clientName}
                    </td>
                    <td className="px-6 py-4">
                      {token.revokedAt ? (
                        <span className="px-2 py-1 rounded bg-muted text-muted-foreground text-xs font-bold">REVOKED</span>
                      ) : token.isActive ? (
                        <span className="px-2 py-1 rounded bg-green-100 text-green-700 text-xs font-bold">ACTIVE</span>
                      ) : (
                        <span className="px-2 py-1 rounded bg-amber-100 text-amber-700 text-xs font-bold">EXPIRED</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground font-mono text-xs">
                      {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-6 py-4 text-right space-x-1">
                      {token.isActive && !token.revokedAt ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8"
                            disabled={regenBusy === token.id}
                            onClick={() => handleRegenerate(token.id)}
                          >
                            Regenerate
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleRevoke(token.id)}
                          >
                            <Ban className="w-4 h-4 mr-2" /> Revoke
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          disabled={deleteBusy === token.id}
                          onClick={() => handleDelete(token.id)}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CreateTokenDialog 
        open={isCreateOpen} 
        onOpenChange={setIsCreateOpen} 
        onSuccess={(val: string) => setNewTokenValue(val)}
        defaultClientId={filterClientId}
        clients={clients || []}
      />
      
      <TokenRevealDialog 
        tokenValue={newTokenValue} 
        onClose={() => setNewTokenValue(null)} 
      />
    </div>
  );
}

function MarketingDemoCard({ onIssued }: { onIssued: (token: string) => void }) {
  const [state, setState] = useState<{ enabled: boolean; token: string | null; prefix: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  async function load() {
    const res = await fetch("/api/admin/marketing-demo", { credentials: "include" });
    if (res.ok) setState(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function issue() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/marketing-demo", { method: "POST", credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not issue demo key");
      setState({ enabled: true, token: body.token, prefix: body.prefix });
      onIssued(body.token);
      queryClient.invalidateQueries({ queryKey: getListApiTokensQueryKey() });
      toast({ title: "Marketing demo key published" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!confirm("Remove the public demo key from the marketing playground?")) return;
    setBusy(true);
    try {
      await fetch("/api/admin/marketing-demo", { method: "DELETE", credentials: "include" });
      await load();
      toast({ title: "Marketing demo disabled" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Radio className="h-4 w-4 text-primary" />
            Marketing live demo
          </div>
          <p className="mt-1 text-sm text-muted-foreground max-w-xl">
            Publishes a live-only <span className="font-mono">vdi_</span> key on the website playground. Visitors can mix
            Encar / Autowini / KB and apply a markup. History routes are blocked.
          </p>
          {state?.enabled && state.token && (
            <p className="mt-3 font-mono text-xs break-all text-foreground">{state.token}</p>
          )}
          {state && !state.enabled && (
            <p className="mt-3 text-xs text-muted-foreground">No public demo key yet.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button onClick={issue} disabled={busy} className="gap-2">
            {state?.enabled ? "Rotate demo key" : "Publish demo key"}
          </Button>
          {state?.enabled && (
            <Button variant="outline" onClick={disable} disabled={busy}>
              Disable
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateTokenDialog({ open, onOpenChange, onSuccess, defaultClientId, clients }: any) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createMutation = useCreateApiToken();
  
  const [formData, setFormData] = useState({
    clientId: defaultClientId || "",
    name: "",
  });

  React.useEffect(() => {
    if (open) {
      setFormData({ clientId: defaultClientId || "", name: "" });
    }
  }, [open, defaultClientId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.clientId) return;
    
    createMutation.mutate({ 
      data: {
        clientId: parseInt(formData.clientId),
        name: formData.name
      }
    }, {
      onSuccess: (res: any) => {
        toast({ title: "Token generated successfully" });
        queryClient.invalidateQueries({ queryKey: getListApiTokensQueryKey() });
        onSuccess(res.tokenValue);
        onOpenChange(false);
        setFormData({ clientId: defaultClientId || "", name: "" });
      },
      onError: (err: any) => {
        toast({ title: "Could not generate token", description: err?.message, variant: "destructive" });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Generate API Token</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Client</label>
              <select 
                required
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                value={formData.clientId} 
                onChange={e => setFormData(s => ({ ...s, clientId: e.target.value }))}
              >
                <option value="" disabled>Select a client...</option>
                {clients.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Token Label</label>
              <Input required placeholder="e.g. Production Backend" value={formData.name} onChange={e => setFormData(s => ({ ...s, name: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending || !formData.clientId}>Generate Token</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TokenRevealDialog({ tokenValue, onClose }: { tokenValue: string | null, onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!tokenValue) return;
    navigator.clipboard.writeText(tokenValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={!!tokenValue} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="text-green-600 flex items-center gap-2">
            <Check className="w-5 h-5" /> Token Generated
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-4">
            Please copy this token now. For security reasons, <strong className="text-foreground">it will never be shown again</strong>.
          </p>
          <div className="flex items-center gap-2">
            <Input readOnly value={tokenValue || ""} className="font-mono bg-muted text-foreground" />
            <Button type="button" variant="outline" size="icon" onClick={handleCopy}>
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>I have copied the token</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
