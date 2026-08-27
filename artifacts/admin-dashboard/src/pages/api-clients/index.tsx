import React, { useState } from "react";
import { 
  useListApiClients, 
  useCreateApiClient, 
  useUpdateApiClient, 
  useDeleteApiClient,
  getListApiClientsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, Plus, MoreVertical, Edit, Trash2, KeyRound, Power, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function ApiClients() {
  const { data: clients, isLoading, isError, error, refetch } = useListApiClients();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Clients</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage B2B API access. Open a client for usage graphs, tokens, and settings.
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Create Client
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          [1,2,3].map(i => <div key={i} className="h-[200px] bg-card border border-border rounded-xl animate-pulse"></div>)
        ) : isError ? (
          <div className="col-span-full p-12 text-center border border-dashed border-destructive/40 rounded-xl space-y-3">
            <p className="text-destructive font-medium">Could not load API clients.</p>
            <p className="text-sm text-muted-foreground">{(error as Error)?.message || "Request failed"}</p>
            <Button variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : !clients || clients.length === 0 ? (
          <div className="col-span-full p-12 text-center text-muted-foreground border border-dashed border-border rounded-xl">
            No API clients configured.
          </div>
        ) : (
          clients.map(client => (
            <ClientCard key={client.id} client={client} />
          ))
        )}
      </div>

      <ClientFormDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </div>
  );
}

function ClientCard({ client }: { client: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const toggleMutation = useUpdateApiClient();
  const deleteMutation = useDeleteApiClient();

  const handleToggle = () => {
    toggleMutation.mutate({ 
      id: client.id, 
      data: { isActive: !client.isActive } 
    }, {
      onSuccess: () => {
        toast({ title: `Client ${client.isActive ? 'disabled' : 'enabled'}` });
        queryClient.invalidateQueries({ queryKey: getListApiClientsQueryKey() });
      }
    });
  };

  const handleDelete = () => {
    if (!confirm("Delete this API client? All associated tokens will be permanently revoked.")) return;
    deleteMutation.mutate({ id: client.id }, {
      onSuccess: () => {
        toast({ title: "Client deleted" });
        queryClient.invalidateQueries({ queryKey: getListApiClientsQueryKey() });
      }
    });
  };

  return (
    <div
      className="bg-card border border-border rounded-xl shadow-sm flex flex-col cursor-pointer hover:border-primary/40 transition-colors"
      onClick={() => setLocation(`/api-clients/${client.id}`)}
    >
      <div className="p-5 border-b border-border flex items-start justify-between">
        <div>
          <h3 className="font-bold text-foreground text-lg mb-1">{client.name}</h3>
          <p className="text-xs text-muted-foreground line-clamp-2">{client.description || "No description provided"}</p>
          {client.email && (
            <p className="text-[11px] font-mono text-muted-foreground mt-1">{client.email}{client.hasPortalLogin ? " · portal on" : ""}</p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 -mt-2 h-8 w-8"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => setLocation(`/api-clients/${client.id}`)}>
              <Edit className="w-4 h-4 mr-2" /> Open details
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/api-tokens?clientId=${client.id}`} className="cursor-pointer">
                <KeyRound className="w-4 h-4 mr-2" /> Manage Tokens
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleToggle}>
              {client.isActive ? <PowerOff className="w-4 h-4 mr-2" /> : <Power className="w-4 h-4 mr-2" />}
              {client.isActive ? "Disable Client" : "Enable Client"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="w-4 h-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      <div className="p-5 grid grid-cols-2 gap-4 flex-1">
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Status</div>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${client.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {client.isActive ? 'ACTIVE' : 'DISABLED'}
          </span>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Credits</div>
          <div className="font-mono text-sm">{client.creditBalance ?? 0}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Live feed</div>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
              client.liveFeedActive
                ? "bg-teal-100 text-teal-800"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {client.liveFeedActive ? "ON" : "OFF"}
          </span>
          {client.liveFeedExpiresAt && (
            <div className="text-[10px] font-mono text-muted-foreground mt-1 truncate" title={client.liveFeedExpiresAt}>
              until {new Date(client.liveFeedExpiresAt).toLocaleDateString()}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Account</div>
          <div className="font-mono text-sm">
            {(client.tokenCount || 0) > 0 ? "Paid (has token)" : "Demo (no token)"}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Tokens</div>
          <div className="font-mono text-sm flex items-center gap-1.5">
            <KeyRound className="w-3 h-3 text-muted-foreground" />
            {client.tokenCount || 0}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Rate / Min</div>
          <div className="font-mono text-sm">{client.rateLimitPerMinute ?? '∞'}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Total Req</div>
          <div className="font-mono text-sm">{client.totalRequests?.toLocaleString() || 0}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">VIN / Month</div>
          <div className="font-mono text-sm">{client.requestsPerVin ?? <span className="text-muted-foreground/50">∞</span>}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Global / Month</div>
          <div className="font-mono text-sm">{client.monthlyGlobalLimit ?? <span className="text-muted-foreground/50">∞</span>}</div>
        </div>
      </div>
    </div>
  );
}

function ClientFormDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createMutation = useCreateApiClient();
  const [, setLocation] = useLocation();
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    email: "",
    password: "",
    rateLimitPerMinute: 60,
    rateLimitPerDay: 10000,
    requestsPerVin: "" as string | number,
    monthlyGlobalLimit: "" as string | number,
    creditBalance: 0,
    liveFeedEnabled: false,
    liveFeedDays: "" as string | number,
    liveFeedExpiresAt: "",
  });

  React.useEffect(() => {
    if (!open) return;
    setFormData({
      name: "",
      description: "",
      email: "",
      password: "",
      rateLimitPerMinute: 60,
      rateLimitPerDay: 10000,
      requestsPerVin: "",
      monthlyGlobalLimit: "",
      creditBalance: 0,
      liveFeedEnabled: false,
      liveFeedDays: "",
      liveFeedExpiresAt: "",
    });
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email.trim()) {
      toast({ title: "Portal email required", description: "Needed for /account/ sign-in", variant: "destructive" });
      return;
    }
    if (formData.password.length < 6) {
      toast({ title: "Portal password required", description: "Min 6 characters — not the API token", variant: "destructive" });
      return;
    }
    const payload: Record<string, unknown> = {
      name: formData.name,
      description: formData.description,
      email: formData.email,
      password: formData.password || undefined,
      rateLimitPerMinute: formData.rateLimitPerMinute,
      rateLimitPerDay: formData.rateLimitPerDay,
      requestsPerVin: formData.requestsPerVin === "" ? undefined : Number(formData.requestsPerVin),
      monthlyGlobalLimit: formData.monthlyGlobalLimit === "" ? undefined : Number(formData.monthlyGlobalLimit),
      creditBalance: Math.max(0, Number(formData.creditBalance) || 0),
      liveFeedEnabled: Boolean(formData.liveFeedEnabled),
    };
    if (formData.liveFeedDays !== "" && formData.liveFeedDays != null) {
      payload.liveFeedDays = Number(formData.liveFeedDays);
    } else if (formData.liveFeedExpiresAt) {
      payload.liveFeedExpiresAt = new Date(formData.liveFeedExpiresAt).toISOString();
    } else if (!formData.liveFeedEnabled) {
      payload.liveFeedExpiresAt = null;
    } else {
      payload.liveFeedExpiresAt = null;
    }
    createMutation.mutate({ 
      data: payload as any
    }, {
      onSuccess: (created: any) => {
        toast({ title: "Client created — issue a token to make it paid" });
        queryClient.invalidateQueries({ queryKey: getListApiClientsQueryKey() });
        onOpenChange(false);
        if (created?.id) setLocation(`/api-clients/${created.id}`);
      },
      onError: (err: any) => {
        toast({ title: "Create failed", description: err?.message || "Could not create client", variant: "destructive" });
      },
    });
  };

  const isPending = createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create API Client</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Company / App Name</label>
              <Input required value={formData.name} onChange={e => setFormData(s => ({ ...s, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</label>
              <Input value={formData.description} onChange={e => setFormData(s => ({ ...s, description: e.target.value }))} />
            </div>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
              Portal email + password are for <span className="font-mono text-foreground">/account/</span> only.
              The <span className="font-mono text-foreground">vdi_…</span> API token is separate (Bearer header) — not a login password.
              Admin console is <span className="font-mono text-foreground">/adminz/</span>.
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Portal email *</label>
              <Input type="email" required value={formData.email} onChange={e => setFormData(s => ({ ...s, email: e.target.value }))} placeholder="client@company.com" autoComplete="off" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Portal password *</label>
              <Input type="password" required minLength={6} value={formData.password} onChange={e => setFormData(s => ({ ...s, password: e.target.value }))} placeholder="Min 6 characters" autoComplete="new-password" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Credit balance</label>
              <Input
                type="number"
                min="0"
                value={formData.creditBalance}
                onChange={e => setFormData(s => ({ ...s, creditBalance: parseInt(e.target.value) || 0 }))}
              />
              <p className="text-[11px] text-muted-foreground">
                VIN retrieve credits ($ / credit). Live feed never spends credits.
              </p>
            </div>

            <div className="rounded-md border border-border p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live feed</label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Default off. When on: unlimited live calls, no credit charge.
                  </p>
                </div>
                <Switch
                  checked={formData.liveFeedEnabled}
                  onCheckedChange={(c) => setFormData((s) => ({ ...s, liveFeedEnabled: c }))}
                />
              </div>
              {formData.liveFeedEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Days open
                    </label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="Blank = keep / unlimited"
                      value={formData.liveFeedDays}
                      onChange={(e) =>
                        setFormData((s) => ({
                          ...s,
                          liveFeedDays: e.target.value ? parseInt(e.target.value) : "",
                        }))
                      }
                    />
                    <p className="text-[10px] text-muted-foreground">Set 30 → expires in 30 days. 0 = no expiry.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Or expires at
                    </label>
                    <Input
                      type="datetime-local"
                      value={formData.liveFeedExpiresAt}
                      onChange={(e) => setFormData((s) => ({ ...s, liveFeedExpiresAt: e.target.value, liveFeedDays: "" }))}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Req / Minute</label>
                <Input type="number" required min="1" value={formData.rateLimitPerMinute} onChange={e => setFormData(s => ({ ...s, rateLimitPerMinute: parseInt(e.target.value) || 60 }))} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Req / Day</label>
                <Input type="number" required min="1" value={formData.rateLimitPerDay} onChange={e => setFormData(s => ({ ...s, rateLimitPerDay: parseInt(e.target.value) || 10000 }))} />
              </div>
            </div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2 border-t border-border">Public VIN API Limits <span className="normal-case text-muted-foreground/60 font-normal">(blank = unlimited)</span></p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Req / VIN / Month</label>
                <Input type="number" min="1" placeholder="Unlimited" value={formData.requestsPerVin} onChange={e => setFormData(s => ({ ...s, requestsPerVin: e.target.value ? parseInt(e.target.value) : "" }))} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Req / Month</label>
                <Input type="number" min="1" placeholder="Unlimited" value={formData.monthlyGlobalLimit} onChange={e => setFormData(s => ({ ...s, monthlyGlobalLimit: e.target.value ? parseInt(e.target.value) : "" }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>Create Client</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
