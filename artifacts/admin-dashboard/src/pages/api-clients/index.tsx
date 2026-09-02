import React, { useMemo, useState } from "react";
import {
  useListApiClients,
  useCreateApiClient,
  useUpdateApiClient,
  getListApiClientsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, MoreVertical, Edit, Trash2, KeyRound, Power, PowerOff, Search } from "lucide-react";
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
import { DeleteClientDialog } from "@/components/delete-client-dialog";

type ClientRow = {
  id: number;
  name: string;
  description?: string | null;
  email?: string | null;
  telegramUsername?: string | null;
  websiteUrl?: string | null;
  hasPortalLogin?: boolean;
  isActive?: boolean;
  isDemo?: boolean;
  creditBalance?: number | null;
  liveFeedActive?: boolean;
  liveFeedExpiresAt?: string | null;
  tokenCount?: number | null;
  totalRequests?: number | null;
  rateLimitPerMinute?: number | null;
  requestsPerVin?: number | null;
  monthlyGlobalLimit?: number | null;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string | null;
};

function formatClientWhen(iso?: string | null): string {
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

type SortKey = "newest" | "updated" | "tokens" | "credits" | "requests" | "name";
type StatusFilter = "all" | "active" | "disabled";
type AccountFilter = "all" | "demo" | "paid";
type LiveFilter = "all" | "on" | "off";

function sortClients(list: ClientRow[], sort: SortKey): ClientRow[] {
  const copy = [...list];
  copy.sort((a, b) => {
    switch (sort) {
      case "newest":
        return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
      case "updated":
        return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
      case "tokens":
        return (b.tokenCount ?? 0) - (a.tokenCount ?? 0);
      case "credits":
        return (b.creditBalance ?? 0) - (a.creditBalance ?? 0);
      case "requests":
        return (b.totalRequests ?? 0) - (a.totalRequests ?? 0);
      case "name":
        return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
      default:
        return 0;
    }
  });
  return copy;
}

function filterClients(
  list: ClientRow[],
  query: string,
  status: StatusFilter,
  account: AccountFilter,
  live: LiveFilter,
): ClientRow[] {
  const q = query.trim().toLowerCase();
  return list.filter((c) => {
    if (status === "active" && !c.isActive) return false;
    if (status === "disabled" && c.isActive) return false;
    if (account === "demo" && !c.isDemo) return false;
    if (account === "paid" && c.isDemo) return false;
    if (live === "on" && !c.liveFeedActive) return false;
    if (live === "off" && c.liveFeedActive) return false;
    if (!q) return true;
    const hay = [
      c.name,
      c.email,
      c.description,
      c.telegramUsername,
      c.websiteUrl,
      String(c.id),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export default function ApiClients() {
  const { data: clients, isLoading, isError, error, refetch } = useListApiClients();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("all");
  const [liveFilter, setLiveFilter] = useState<LiveFilter>("all");

  const filtered = useMemo(() => {
    const list = (clients ?? []) as ClientRow[];
    return sortClients(filterClients(list, query, statusFilter, accountFilter, liveFilter), sort);
  }, [clients, query, sort, statusFilter, accountFilter, liveFilter]);

  const total = clients?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">API Clients</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-0.5 line-clamp-2 sm:line-clamp-none">
            Portal accounts at <span className="font-mono">/account/</span>
            <Link href="/client-portal" className="text-primary hover:underline underline-offset-2 ml-1">
              Portal hub →
            </Link>
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} size="sm" className="gap-1.5 shrink-0 self-start">
          <Plus className="w-3.5 h-3.5" />
          Create
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card p-2.5 sm:p-3 space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, telegram…"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterSelect
            label="Sort"
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={[
              { value: "newest", label: "Newest" },
              { value: "updated", label: "Recently updated" },
              { value: "tokens", label: "Most tokens" },
              { value: "credits", label: "Highest credits" },
              { value: "requests", label: "Most requests" },
              { value: "name", label: "Name A–Z" },
            ]}
          />
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
            options={[
              { value: "all", label: "All status" },
              { value: "active", label: "Active" },
              { value: "disabled", label: "Disabled" },
            ]}
          />
          <FilterSelect
            label="Account"
            value={accountFilter}
            onChange={(v) => setAccountFilter(v as AccountFilter)}
            options={[
              { value: "all", label: "All accounts" },
              { value: "paid", label: "Paid (token)" },
              { value: "demo", label: "Demo only" },
            ]}
          />
          <FilterSelect
            label="Live"
            value={liveFilter}
            onChange={(v) => setLiveFilter(v as LiveFilter)}
            options={[
              { value: "all", label: "Live feed any" },
              { value: "on", label: "Live on" },
              { value: "off", label: "Live off" },
            ]}
          />
        </div>
        <p className="text-[10px] text-muted-foreground px-0.5">
          {filtered.length === total
            ? `${total} client${total === 1 ? "" : "s"}`
            : `${filtered.length} of ${total} clients`}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 px-3 animate-pulse bg-muted/20" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-destructive text-sm font-medium">Could not load API clients.</p>
            <p className="text-xs text-muted-foreground">{(error as Error)?.message || "Request failed"}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {total === 0 ? "No API clients configured." : "No clients match these filters."}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((client) => (
              <ClientRow key={client.id} client={client} />
            ))}
          </ul>
        )}
      </div>

      <ClientFormDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-1 rounded-md border border-input bg-background pl-2 pr-1 h-8 text-xs">
      <span className="text-muted-foreground shrink-0 hidden sm:inline">{label}</span>
      <select
        className="bg-transparent text-xs font-medium outline-none cursor-pointer max-w-[9.5rem] sm:max-w-none truncate py-1 pr-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ClientRow({ client }: { client: ClientRow }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const toggleMutation = useUpdateApiClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleToggle = () => {
    toggleMutation.mutate(
      { id: client.id, data: { isActive: !client.isActive } },
      {
        onSuccess: () => {
          toast({ title: `Client ${client.isActive ? "disabled" : "enabled"}` });
          queryClient.invalidateQueries({ queryKey: getListApiClientsQueryKey() });
        },
      },
    );
  };

  const subline = [
    client.email,
    client.telegramUsername ? `@${client.telegramUsername}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const created = formatClientWhen(client.createdAt);
  const lastLogin = formatClientWhen(client.lastLoginAt);

  return (
    <>
      <li
        className="group flex items-center gap-2 px-2.5 sm:px-3 py-2 sm:py-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={() => setLocation(`/api-clients/${client.id}`)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-sm truncate max-w-[12rem] sm:max-w-none">{client.name}</span>
            <StatusChip active={Boolean(client.isActive)} />
            {client.liveFeedActive ? <MiniChip tone="teal">Live</MiniChip> : null}
            {client.isDemo ? <MiniChip tone="muted">Demo</MiniChip> : <MiniChip tone="blue">Paid</MiniChip>}
          </div>
          {subline ? (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{subline}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-1 text-[10px] sm:text-[11px] font-mono text-muted-foreground">
            <span title="Credits">{client.creditBalance ?? 0} cr</span>
            <span title="Tokens">{client.tokenCount ?? 0} tok</span>
            <span title="Total requests">{(client.totalRequests ?? 0).toLocaleString()} req</span>
            <span className="hidden md:inline text-muted-foreground/80" title="Registered">
              · Reg {created}
            </span>
            <span className="hidden lg:inline text-muted-foreground/80" title="Last portal sign-in">
              · Login {lastLogin}
            </span>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 opacity-70 group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => setLocation(`/api-clients/${client.id}`)}>
              <Edit className="w-3.5 h-3.5 mr-2" /> Open details
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/api-tokens?clientId=${client.id}`} className="cursor-pointer">
                <KeyRound className="w-3.5 h-3.5 mr-2" /> Manage tokens
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleToggle}>
              {client.isActive ? <PowerOff className="w-3.5 h-3.5 mr-2" /> : <Power className="w-3.5 h-3.5 mr-2" />}
              {client.isActive ? "Disable" : "Enable"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setDeleteOpen(true);
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
      <DeleteClientDialog
        clientId={client.id}
        clientName={client.name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => {
          toast({ title: "Client deleted" });
          queryClient.invalidateQueries({ queryKey: getListApiClientsQueryKey() });
        }}
      />
    </>
  );
}

function StatusChip({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex px-1.5 py-0 rounded text-[9px] font-bold uppercase tracking-wide ${
        active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
      }`}
    >
      {active ? "On" : "Off"}
    </span>
  );
}

function MiniChip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "teal" | "blue" | "muted";
}) {
  const cls =
    tone === "teal"
      ? "bg-teal-100 text-teal-800"
      : tone === "blue"
        ? "bg-blue-100 text-blue-800"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex px-1.5 py-0 rounded text-[9px] font-semibold uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  );
}

function ClientFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
    createMutation.mutate(
      { data: payload as any },
      {
        onSuccess: (created: any) => {
          toast({ title: "Client created — issue a token to make it paid" });
          queryClient.invalidateQueries({ queryKey: getListApiClientsQueryKey() });
          onOpenChange(false);
          if (created?.id) setLocation(`/api-clients/${created.id}`);
        },
        onError: (err: any) => {
          toast({ title: "Create failed", description: err?.message || "Could not create client", variant: "destructive" });
        },
      },
    );
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
              <Input required value={formData.name} onChange={(e) => setFormData((s) => ({ ...s, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</label>
              <Input value={formData.description} onChange={(e) => setFormData((s) => ({ ...s, description: e.target.value }))} />
            </div>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
              Portal email + password are for <span className="font-mono text-foreground">/account/</span> only.
              The <span className="font-mono text-foreground">vdi_…</span> API token is separate (Bearer header) — not a login password.
              Admin console is <span className="font-mono text-foreground">/adminz/</span>.
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Portal email *</label>
              <Input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData((s) => ({ ...s, email: e.target.value }))}
                placeholder="client@company.com"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Portal password *</label>
              <Input
                type="password"
                required
                minLength={6}
                value={formData.password}
                onChange={(e) => setFormData((s) => ({ ...s, password: e.target.value }))}
                placeholder="Min 6 characters"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Credit balance</label>
              <Input
                type="number"
                min="0"
                value={formData.creditBalance}
                onChange={(e) => setFormData((s) => ({ ...s, creditBalance: parseInt(e.target.value) || 0 }))}
              />
              <p className="text-[11px] text-muted-foreground">VIN retrieve credits ($ / credit). Live feed never spends credits.</p>
            </div>

            <div className="rounded-md border border-border p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live feed</label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Default off. When on: unlimited live calls, no credit charge.</p>
                </div>
                <Switch checked={formData.liveFeedEnabled} onCheckedChange={(c) => setFormData((s) => ({ ...s, liveFeedEnabled: c }))} />
              </div>
              {formData.liveFeedEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Days open</label>
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
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Or expires at</label>
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
                <Input
                  type="number"
                  required
                  min="1"
                  value={formData.rateLimitPerMinute}
                  onChange={(e) => setFormData((s) => ({ ...s, rateLimitPerMinute: parseInt(e.target.value) || 60 }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Req / Day</label>
                <Input
                  type="number"
                  required
                  min="1"
                  value={formData.rateLimitPerDay}
                  onChange={(e) => setFormData((s) => ({ ...s, rateLimitPerDay: parseInt(e.target.value) || 10000 }))}
                />
              </div>
            </div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2 border-t border-border">
              Public VIN API Limits <span className="normal-case text-muted-foreground/60 font-normal">(blank = unlimited)</span>
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Req / VIN / Month</label>
                <Input
                  type="number"
                  min="1"
                  placeholder="Unlimited"
                  value={formData.requestsPerVin}
                  onChange={(e) => setFormData((s) => ({ ...s, requestsPerVin: e.target.value ? parseInt(e.target.value) : "" }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Req / Month</label>
                <Input
                  type="number"
                  min="1"
                  placeholder="Unlimited"
                  value={formData.monthlyGlobalLimit}
                  onChange={(e) => setFormData((s) => ({ ...s, monthlyGlobalLimit: e.target.value ? parseInt(e.target.value) : "" }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              Create Client
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
