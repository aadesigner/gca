import React, { useState } from "react";
import { Link } from "wouter";
import { 
  useListProviders, 
  useCreateProvider, 
  useUpdateProvider, 
  useDeleteProvider,
  getListProvidersQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  Database, 
  Plus, 
  Search, 
  MoreVertical, 
  Edit, 
  Trash2, 
  Power, 
  PowerOff,
  ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { crawlProfileFor, extractionLabel } from "@/lib/crawl-profiles";
import { PageEnter, PageHeader, Surface, FilterBar } from "@/components/page";
import { DesktopTable, MobileCards } from "@/components/responsive";
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

export default function Providers() {
  const [search, setSearch] = useState("");
  const { data: providers, isLoading } = useListProviders();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<any>(null);

  const filtered = providers?.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.internalName.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <PageEnter>
      <PageHeader
        title="Providers"
        description="Upstream marketplaces and how each one is extracted."
        actions={
          <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Add provider
          </Button>
        }
      />

      <FilterBar>
        <div className="relative flex-1 w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search providers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-background rounded-xl"
          />
        </div>
      </FilterBar>

      <MobileCards>
        {isLoading ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
            LOADING_PROVIDERS...
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
            No providers found.
          </div>
        ) : (
          filtered.map((provider) => {
            const profile = crawlProfileFor(provider.internalName);
            return (
              <div key={provider.id} className="rounded-2xl border border-border/80 bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{provider.name}</div>
                    <div className="text-xs font-mono text-muted-foreground">{provider.internalName}</div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold shrink-0 ${
                    provider.enabled ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                  }`}>
                    {provider.enabled ? <Power className="w-3 h-3" /> : <PowerOff className="w-3 h-3" />}
                    {provider.enabled ? "ACTIVE" : "DISABLED"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-1 rounded bg-secondary text-secondary-foreground font-mono">{provider.type}</span>
                  <span className="px-2 py-1 rounded bg-muted">{provider.country}</span>
                  {profile && (
                    <span className="px-2 py-1 rounded bg-primary/10 text-primary font-medium">
                      {extractionLabel(profile.extraction)}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Link
                    href={`/providers/${provider.id}`}
                    className="inline-flex flex-1 items-center justify-center h-10 rounded-lg text-xs font-medium bg-primary/10 text-primary"
                  >
                    Open
                  </Link>
                  <ProviderMenu
                    provider={provider}
                    onEdit={() => setEditingProvider(provider)}
                  />
                </div>
              </div>
            );
          })
        )}
      </MobileCards>

      <DesktopTable>
      <Surface>
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm text-left">
            <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
              <tr>
                <th className="px-6 py-4">Name / ID</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Extraction</th>
                <th className="px-6 py-4">Country</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
                    LOADING_PROVIDERS...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                    No providers found.
                  </td>
                </tr>
              ) : (
                filtered.map(provider => (
                  <tr key={provider.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                          <Database className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-semibold text-foreground">{provider.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{provider.internalName}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 rounded bg-secondary text-secondary-foreground text-xs font-mono">
                        {provider.type}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        const profile = crawlProfileFor(provider.internalName);
                        if (!profile) {
                          return <span className="text-xs text-muted-foreground">No adapter</span>;
                        }
                        return (
                          <div>
                            <span className="px-2 py-1 rounded bg-primary/10 text-primary text-xs font-medium">
                              {extractionLabel(profile.extraction)}
                            </span>
                            <div className="text-[11px] text-muted-foreground mt-1 max-w-xs">{profile.summary}</div>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 font-medium">{provider.country}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold ${
                        provider.enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {provider.enabled ? <Power className="w-3 h-3" /> : <PowerOff className="w-3 h-3" />}
                        {provider.enabled ? 'ACTIVE' : 'DISABLED'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/providers/${provider.id}`} className="p-2 text-muted-foreground hover:text-primary transition-colors">
                          <ExternalLink className="w-4 h-4" />
                        </Link>
                        <ProviderMenu 
                          provider={provider} 
                          onEdit={() => setEditingProvider(provider)}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Surface>
      </DesktopTable>

      <ProviderFormDialog 
        open={isCreateOpen} 
        onOpenChange={setIsCreateOpen} 
      />
      
      {editingProvider && (
        <ProviderFormDialog 
          open={!!editingProvider} 
          onOpenChange={(o) => !o && setEditingProvider(null)} 
          provider={editingProvider}
        />
      )}
    </PageEnter>
  );
}

function ProviderMenu({ provider, onEdit }: { provider: any, onEdit: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteMutation = useDeleteProvider();
  const toggleMutation = useUpdateProvider();

  const handleDelete = () => {
    if (!confirm("Are you sure you want to delete this provider? This action is irreversible.")) return;
    deleteMutation.mutate({ id: provider.id }, {
      onSuccess: () => {
        toast({ title: "Provider deleted" });
        queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
      }
    });
  };

  const handleToggle = () => {
    toggleMutation.mutate({ 
      id: provider.id, 
      data: { enabled: !provider.enabled } 
    }, {
      onSuccess: () => {
        toast({ title: `Provider ${provider.enabled ? 'disabled' : 'enabled'}` });
        queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreVertical className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <Edit className="w-4 h-4 mr-2" /> Edit Details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleToggle}>
          {provider.enabled ? <PowerOff className="w-4 h-4 mr-2" /> : <Power className="w-4 h-4 mr-2" />}
          {provider.enabled ? "Disable Provider" : "Enable Provider"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="w-4 h-4 mr-2" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProviderFormDialog({ open, onOpenChange, provider }: { open: boolean, onOpenChange: (open: boolean) => void, provider?: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createMutation = useCreateProvider();
  const updateMutation = useUpdateProvider();
  
  const [formData, setFormData] = useState({
    name: provider?.name || "",
    internalName: provider?.internalName || "",
    type: provider?.type || "marketplace",
    country: provider?.country || "",
    baseUrl: provider?.baseUrl || "",
    rateLimit: provider?.rateLimit || 60,
  });

  // Update formData when provider prop changes (for editing)
  React.useEffect(() => {
    if (provider) {
      setFormData({
        name: provider.name || "",
        internalName: provider.internalName || "",
        type: provider.type || "marketplace",
        country: provider.country || "",
        baseUrl: provider.baseUrl || "",
        rateLimit: provider.rateLimit || 60,
      });
    } else {
      setFormData({
        name: "",
        internalName: "",
        type: "marketplace",
        country: "",
        baseUrl: "",
        rateLimit: 60,
      });
    }
  }, [provider, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (provider) {
      updateMutation.mutate({ 
        id: provider.id, 
        data: formData as any
      }, {
        onSuccess: () => {
          toast({ title: "Provider updated" });
          queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
          onOpenChange(false);
        }
      });
    } else {
      createMutation.mutate({ 
        data: formData as any
      }, {
        onSuccess: () => {
          toast({ title: "Provider created" });
          queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
          onOpenChange(false);
        }
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{provider ? 'Edit Provider' : 'Add New Provider'}</DialogTitle>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Display Name</label>
                <Input required value={formData.name} onChange={e => setFormData(s => ({ ...s, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Internal ID</label>
                <Input required className="font-mono text-sm" value={formData.internalName} onChange={e => setFormData(s => ({ ...s, internalName: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Type</label>
                <select 
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={formData.type} 
                  onChange={e => setFormData(s => ({ ...s, type: e.target.value as any }))}
                >
                  <option value="marketplace">Marketplace</option>
                  <option value="auction">Auction</option>
                  <option value="dealer">Dealer</option>
                  <option value="oem">OEM</option>
                  <option value="classifieds">Classifieds</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Country</label>
                <Input required value={formData.country} onChange={e => setFormData(s => ({ ...s, country: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Base URL</label>
              <Input type="url" value={formData.baseUrl} onChange={e => setFormData(s => ({ ...s, baseUrl: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rate Limit (req/min)</label>
              <Input type="number" required min="1" value={formData.rateLimit} onChange={e => setFormData(s => ({ ...s, rateLimit: parseInt(e.target.value) || 60 }))} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{provider ? 'Save Changes' : 'Create Provider'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
