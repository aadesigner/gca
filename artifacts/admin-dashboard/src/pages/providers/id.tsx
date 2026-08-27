import React, { useState } from "react";
import { useParams, Link } from "wouter";
import { useGetProvider, useCreateJob, getGetProviderQueryKey, getListJobsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  ArrowLeft, 
  Car, 
  Database, 
  Activity, 
  AlertCircle,
  TerminalSquare,
  Globe,
  Settings2,
  Clock,
  Play
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function ProviderDetail() {
  const { id } = useParams();
  const providerId = id ? parseInt(id, 10) : 0;
  const [isJobDialogOpen, setIsJobDialogOpen] = useState(false);
  
  const { data: provider, isLoading } = useGetProvider(providerId, {
    query: {
      enabled: !!providerId,
      queryKey: getGetProviderQueryKey(providerId)
    }
  });

  if (isLoading) {
    return <div className="p-8 text-center font-mono text-muted-foreground animate-pulse">LOADING_PROVIDER_DATA...</div>;
  }

  if (!provider) {
    return <div className="p-8 text-center text-red-500">Provider not found.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/providers"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{provider.name}</h1>
            <span className={`px-2 py-0.5 rounded text-xs font-bold tracking-wider ${provider.enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {provider.enabled ? 'ACTIVE' : 'DISABLED'}
            </span>
          </div>
          <p className="text-muted-foreground text-sm font-mono mt-1">{provider.internalName} • {provider.country}</p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => setIsJobDialogOpen(true)} className="gap-2">
          <Play className="w-4 h-4" />
          Create Collection Job
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total Listings" value={provider.stats.totalListings.toLocaleString()} icon={Database} />
        <StatCard title="Total VINs" value={provider.stats.totalVins.toLocaleString()} icon={Car} />
        <StatCard title="Active Jobs" value={provider.stats.activeJobs} icon={Activity} highlight={provider.stats.activeJobs > 0} />
        <StatCard title="Failed Jobs" value={provider.stats.failedJobs} icon={AlertCircle} alert={provider.stats.failedJobs > 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border bg-muted/20">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <TerminalSquare className="w-4 h-4" />
                Recent Collection Activity
              </h2>
            </div>
            <div className="p-8 text-center text-muted-foreground text-sm">
              Recent jobs table goes here (Requires custom query for jobs by provider).
              <div className="mt-4">
                <Button variant="outline" asChild>
                  <Link href={`/jobs?providerId=${provider.id}`}>View All Provider Jobs</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border bg-muted/20">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                Configuration
              </h2>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Base URL</div>
                <div className="flex items-center gap-2 font-mono">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  {provider.baseUrl || 'Not configured'}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rate Limit</div>
                <div className="font-mono">{provider.rateLimit} req/min</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Parser Version</div>
                <div className="font-mono">{provider.parserVersion || 'v1.0.0'}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Last Successful Run</div>
                <div className="flex items-center gap-2 font-mono">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  {provider.stats.lastSuccessfulCollection ? new Date(provider.stats.lastSuccessfulCollection).toLocaleString() : 'Never'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {provider && (
        <CollectionJobDialog
          open={isJobDialogOpen}
          onOpenChange={setIsJobDialogOpen}
          providerId={provider.id}
          providerName={provider.name}
          internalName={provider.internalName}
        />
      )}
    </div>
  );
}

function CollectionJobDialog({ open, onOpenChange, providerId, providerName, internalName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: number;
  providerName: string;
  internalName: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createMutation = useCreateJob();
  const isAutowini = internalName === "autowini";
  const isKb = internalName === "kbchachacha";
  const isSimpleMarketplace = isAutowini || isKb;
  const [showFilters, setShowFilters] = useState(false);
  const [form, setForm] = useState({
    jobType: "full_collection",
    targetUrl: "",
    brand: "", modelGroup: "", model: "", badgeGroup: "", yearFrom: "", yearTo: "",
    fuel: "", searchQuery: "", sort: isAutowini ? "recentDate" : isKb ? "" : "MobilePriceAsc",
    minMileage: "", maxMileage: "", location: "",
    maxPages: "0", maxListings: "0", delayMs: "500",
    concurrency: "5", retryCount: "3", skipRecentHours: "12",
  });
  const set = (k: string, v: string) => setForm(s => ({ ...s, [k]: v }));

  const inputClass = "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fp: Record<string, string|number> = {};
    if (form.brand) fp.brand = form.brand;
    if (form.modelGroup) fp.modelGroup = form.modelGroup;
    if (form.model) fp.model = form.model;
    if (form.badgeGroup) fp.badgeGroup = form.badgeGroup;
    if (form.yearFrom) fp.yearFrom = parseInt(form.yearFrom);
    if (form.yearTo) fp.yearTo = parseInt(form.yearTo);
    if (form.fuel) fp.fuel = form.fuel;
    if (form.searchQuery) fp.searchQuery = form.searchQuery;
    if (form.sort) fp.sort = form.sort;
    if (form.minMileage) fp.minMileage = parseInt(form.minMileage);
    if (form.maxMileage) fp.maxMileage = parseInt(form.maxMileage);
    if (form.location) fp.location = form.location;
    if (form.maxPages) fp.maxPages = parseInt(form.maxPages);
    if (form.maxListings) fp.maxListings = parseInt(form.maxListings);
    if (form.delayMs) fp.delayMs = parseInt(form.delayMs);
    if (form.concurrency) fp.concurrency = parseInt(form.concurrency);
    if (form.retryCount) fp.retryCount = parseInt(form.retryCount);
    if (form.skipRecentHours) fp.skipRecentHours = parseInt(form.skipRecentHours);

    createMutation.mutate({
      data: {
        providerId,
        jobType: form.jobType as any,
        targetUrl: form.jobType === "single_listing" ? form.targetUrl : undefined,
        filterParams: Object.keys(fp).length > 0 ? fp as any : undefined,
      }
    }, {
      onSuccess: () => {
        toast({ title: `Collection job queued for ${providerName}` });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        onOpenChange(false);
      },
      onError: (err: any) => {
        toast({ title: "Failed to create job", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Collection Job — {providerName}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Job Type</label>
                <select className={inputClass} value={form.jobType} onChange={e => set("jobType", e.target.value)}>
                  <option value="full_collection">Full Collection</option>
                  <option value="incremental">Incremental</option>
                  <option value="single_listing">Single Listing Test</option>
                </select>
              </div>
            </div>

            {form.jobType === "single_listing" && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Target URL</label>
                <input type="text" className={inputClass} placeholder={isKb ? "https://www.kbchachacha.com/public/car/detail.kbc?carSeq=28671404" : isAutowini ? "https://www.autowini.com/items/Used-2010-Hyundai-Tucson-IC5369374" : "https://fem.encar.com/cars/detail/42138102"} value={form.targetUrl} onChange={e => set("targetUrl", e.target.value)} />
              </div>
            )}

            <div className="border border-border rounded-lg overflow-hidden">
              <button type="button" className="w-full px-4 py-2.5 flex items-center justify-between text-sm font-medium bg-muted/30 hover:bg-muted/50" onClick={() => setShowFilters(!showFilters)}>
                <span>Collection Filters & Options</span>
                <span className="text-muted-foreground text-xs">{showFilters ? "▲" : "▼"}</span>
              </button>
              {showFilters && (
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-2.5">
                    {(isKb
                      ? [["brand","Make","Polestar, Hyundai..."],["yearFrom","Year From","2016"],["yearTo","Year To","2026"],["fuel","Fuel","Electric, Gasoline..."],["minMileage","Min Mileage","0"],["maxMileage","Max Mileage","190000"],["location","Location","Seoul, Gyeonggi..."]]
                      : isAutowini
                      ? [["brand","Make","Hyundai or C0680"],["model","Sub model","Tucson or C1280"],["yearFrom","Year From","2016"],["yearTo","Year To","2020"],["fuel","Fuel","Gasoline"],["sort","Sort","recentDate"],["minMileage","Min Mileage","0"],["maxMileage","Max Mileage","190000"]]
                      : [["brand","Brand","BMW, Hyundai..."],["modelGroup","Model Group","5 Series, Tucson..."],["model","Model","5 Series (F10), Sonata..."],["badgeGroup","Badge Group","Diesel 2WD..."],["yearFrom","Year From","2016"],["yearTo","Year To","2016"],["fuel","Fuel","diesel, gasoline..."],["sort","Sort","MobilePriceAsc"],["minMileage","Min Mileage","0"],["maxMileage","Max Mileage","190000"],["location","Location","Seoul, Busan..."]]
                    ).map(([key, label, ph]) => (
                      <div key={key} className={`space-y-1 ${key === "location" ? "col-span-2" : ""}`}>
                        <label className="text-xs text-muted-foreground">{label}</label>
                        <input type={["yearFrom","yearTo","minMileage","maxMileage"].includes(key) ? "number" : "text"} className={inputClass} placeholder={ph} value={(form as any)[key]} onChange={e => set(key, e.target.value)} />
                      </div>
                    ))}
                  </div>
                  {!isSimpleMarketplace && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Search Query (paste from mobile URL hash action)</label>
                    <textarea className={`${inputClass} min-h-[72px] resize-y`} placeholder="(And.Hidden.N._.MultiViewHidden.N._...)" value={form.searchQuery} onChange={e => set("searchQuery", e.target.value)} />
                  </div>
                  )}
                  <div className="border-t border-border pt-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Collection Settings</div>
                    <div className="grid grid-cols-3 gap-2.5">
                      {[["maxPages","Max Pages (0 = all)","0"],["maxListings","Max Listings (0 = all)","0"],["delayMs","Delay (ms)","500"],["concurrency","Parallel fetches","5"],["retryCount","Retry Count","3"],["skipRecentHours","Skip if seen (h)","12"]].map(([key, label, ph]) => (
                        <div key={key} className="space-y-1">
                          <label className="text-xs text-muted-foreground">{label}</label>
                          <input type="number" className={inputClass} placeholder={ph} value={(form as any)[key]} onChange={e => set(key, e.target.value)} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending}>
              <Play className="w-4 h-4 mr-2" />
              Queue Job
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ title, value, icon: Icon, highlight, alert }: any) {
  return (
    <div className={`p-5 rounded-xl border ${alert ? 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900/50' : highlight ? 'bg-primary/5 border-primary/20' : 'bg-card border-border'} shadow-sm`}>
      <div className="flex justify-between items-start mb-4">
        <Icon className={`w-5 h-5 ${alert ? 'text-red-500' : highlight ? 'text-primary' : 'text-muted-foreground'}`} />
      </div>
      <div>
        <h3 className={`text-2xl font-mono font-bold tracking-tight mb-1 ${alert ? 'text-red-600 dark:text-red-400' : highlight ? 'text-primary' : 'text-foreground'}`}>{value}</h3>
        <p className={`text-xs font-semibold uppercase tracking-wider ${alert ? 'text-red-500/80' : highlight ? 'text-primary/80' : 'text-muted-foreground'}`}>{title}</p>
      </div>
    </div>
  );
}
