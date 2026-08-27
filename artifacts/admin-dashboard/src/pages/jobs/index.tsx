import React, { useEffect, useRef, useState } from "react";
import {
  useListJobs,
  useCreateJob,
  useCancelJob,
  useListProviders,
  useListJobLogs,
  getListJobsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  TerminalSquare,
  Plus,
  Play,
  SquareSquare,
  RefreshCw,
  Ban,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  Trash2,
  Pause,
  Pencil,
  Download,
} from "lucide-react";
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
import { purgeJob, purgeAllJobs, pauseJob, resumeJob, downloadCsv, downloadAdminFile } from "@/lib/admin-api";
import { crawlProfileFor, extractionLabel } from "@/lib/crawl-profiles";
import { PageEnter, PageHeader, FilterBar } from "@/components/page";
import { ChipScroll, DesktopTable, MobileCards } from "@/components/responsive";

function jobTypeLabel(jobType: string) {
  if (jobType === "listing_refresh") return "watch (new + sold)";
  if (jobType === "full_collection") return "full collection";
  if (jobType === "incremental") return "incremental";
  return jobType.replaceAll("_", " ");
}

export default function Jobs() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [countryFilter, setCountryFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const { data: jobsList, isLoading } = useListJobs(
    {
      limit: 100,
      status: statusFilter || undefined,
    },
    {
      query: {
        staleTime: 3_000,
        refetchInterval: (query) => {
          const items = (query.state.data as { items?: Array<{ status?: string }> } | undefined)?.items ?? [];
          const busy = items.some((j) => j.status === "running" || j.status === "pending" || j.status === "paused");
          return busy ? 5_000 : false;
        },
      },
    },
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [resumeJobRow, setResumeJobRow] = useState<any | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
  const [logJobId, setLogJobId] = useState<number | null>(null);
  const [exportingId, setExportingId] = useState<number | "all" | null>(null);
  const { data: providers } = useListProviders();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const cancelMutation = useCancelJob();

  const refreshJobs = () => queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });

  const handleCancel = (id: number) => {
    if (!confirm("Cancel this job?")) return;
    cancelMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Job cancelled" });
          refreshJobs();
        },
      },
    );
  };

  const handlePause = async (id: number) => {
    try {
      await pauseJob(id);
      toast({ title: "Job paused", description: "You can continue from this page later." });
      refreshJobs();
    } catch (e) {
      toast({ title: "Pause failed", description: String(e), variant: "destructive" });
    }
  };

  const handleContinue = async (id: number) => {
    try {
      await resumeJob(id);
      toast({ title: "Job queued", description: "Continuing from the last completed page." });
      refreshJobs();
    } catch (e) {
      toast({ title: "Continue failed", description: String(e), variant: "destructive" });
    }
  };

  const handlePurge = async (id: number) => {
    if (!confirm("Permanently delete this job record and its logs?")) return;
    try {
      await purgeJob(id);
      toast({ title: "Job removed" });
      queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
    } catch (e) {
      toast({ title: "Delete failed", description: String(e), variant: "destructive" });
    }
  };

  const handleExportJob = async (id: number) => {
    setExportingId(id);
    try {
      await downloadCsv(`/admin/jobs/${id}/export`);
      toast({ title: "Export started", description: "CSV download with VINs and listing fields." });
    } catch (e) {
      toast({ title: "Export failed", description: String(e), variant: "destructive" });
    } finally {
      setExportingId(null);
    }
  };

  const handleExportAll = async () => {
    setExportingId("all");
    try {
      await downloadCsv("/admin/listings/export?enabledOnly=1");
      toast({ title: "Export started", description: "All enabled sites, VINs and listing fields in one CSV." });
    } catch (e) {
      toast({ title: "Export failed", description: String(e), variant: "destructive" });
    } finally {
      setExportingId(null);
    }
  };

  const handlePurgeAll = async () => {
    const label = statusFilter ? `${statusFilter} jobs` : "all jobs";
    if (!confirm(`Permanently delete ${label}? Running jobs must be cancelled first.`)) return;
    try {
      const result = (await purgeAllJobs(statusFilter || undefined)) as { deleted: number };
      toast({ title: "Jobs purged", description: `${result.deleted} removed` });
      queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
    } catch (e) {
      toast({ title: "Purge failed", description: String(e), variant: "destructive" });
    }
  };

  const scheduledStart = (job: { status: string; jobConfig?: string | null }) => {
    if (job.status !== "pending" || !job.jobConfig) return null;
    try {
      const at = Date.parse((JSON.parse(job.jobConfig) as { nextRunAt?: string }).nextRunAt ?? "");
      if (!Number.isFinite(at) || at <= Date.now()) return null;
      const mins = Math.max(1, Math.round((at - Date.now()) / 60_000));
      return mins >= 60 ? `in ${Math.round(mins / 60)}h` : `in ${mins}m`;
    } catch {
      return null;
    }
  };

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case "completed": return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "failed": return <AlertCircle className="w-4 h-4 text-red-500" />;
      case "running": return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
      case "pending": return <Clock className="w-4 h-4 text-amber-500" />;
      case "scheduled": return <Clock className="w-4 h-4 text-sky-500" />;
      case "paused": return <Pause className="w-4 h-4 text-violet-500" />;
      case "cancelled": return <Ban className="w-4 h-4 text-muted-foreground" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case "completed": return "bg-green-100 text-green-700 border-green-200";
      case "failed": return "bg-red-100 text-red-700 border-red-200";
      case "running": return "bg-blue-100 text-blue-700 border-blue-200";
      case "pending": return "bg-amber-100 text-amber-700 border-amber-200";
      case "scheduled": return "bg-sky-100 text-sky-700 border-sky-200";
      case "paused": return "bg-violet-100 text-violet-700 border-violet-200";
      case "cancelled": return "bg-muted text-muted-foreground border-border";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  const filteredJobs = (jobsList?.items ?? []).filter((job) => {
    if (!countryFilter && !typeFilter) return true;
    const prov = providers?.find((p) => p.id === job.providerId) as any;
    if (countryFilter && prov?.country !== countryFilter) return false;
    if (typeFilter && prov?.type !== typeFilter) return false;
    return true;
  });

  return (
    <PageEnter>
      <PageHeader
        title="Jobs"
        description={`Crawl pipelines for each marketplace. ${jobsList ? `${jobsList.total} jobs on file.` : ""}`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => void handleExportAll()}
              disabled={exportingId !== null}
            >
              <Download className="w-4 h-4" />
              {exportingId === "all" ? "Exporting…" : "Export CSV"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={async () => {
                setExportingId("all");
                try {
                  await downloadAdminFile("/admin/vins/export?provider=all&format=json");
                  toast({ title: "Catalog exported", description: "JSON VIN catalog for all providers. Import it on Vehicles after you deploy." });
                } catch (e) {
                  toast({ title: "Export failed", description: String(e), variant: "destructive" });
                } finally {
                  setExportingId(null);
                }
              }}
              disabled={exportingId !== null}
            >
              <Download className="w-4 h-4" />
              Export VIN catalog
            </Button>
            <Button variant="outline" size="sm" className="gap-2 text-destructive" onClick={handlePurgeAll}>
              <Trash2 className="w-4 h-4" />
              Remove all
            </Button>
            <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
              <Play className="w-4 h-4" />
              Trigger job
            </Button>
          </>
        }
      />

      <FilterBar>
        <div className="flex flex-col gap-2.5 w-full min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">Status</span>
            <ChipScroll>
              {["", "pending", "running", "paused", "completed", "failed", "cancelled"].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`chip-btn ${
                    statusFilter === st
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {st || "All"}
                </button>
              ))}
            </ChipScroll>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">Country</span>
            <ChipScroll>
              {(() => {
                const countries = [...new Set(providers?.map((p) => (p as any).country).filter(Boolean) ?? [])].sort();
                return ["", ...countries].map((c) => (
                  <button
                    key={c || "all"}
                    onClick={() => setCountryFilter(c)}
                    className={`chip-btn ${
                      countryFilter === c
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {c || "All"}
                  </button>
                ));
              })()}
            </ChipScroll>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">Type</span>
            <ChipScroll>
              {(() => {
                const types = [...new Set(providers?.map((p) => (p as any).type).filter(Boolean) ?? [])].sort();
                return ["", ...types].map((t) => (
                  <button
                    key={t || "all"}
                    onClick={() => setTypeFilter(t)}
                    className={`chip-btn ${
                      typeFilter === t
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {t || "All"}
                  </button>
                ));
              })()}
            </ChipScroll>
          </div>
        </div>
      </FilterBar>

      <MobileCards>
        {isLoading ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
            LOADING_JOBS...
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
            No jobs found.
          </div>
        ) : (
          filteredJobs.map((job) => {
            const prov = providers?.find((p) => p.id === job.providerId) as any;
            const country = prov?.country;
            const flag = country === "KR" ? "🇰🇷" : country === "US" ? "🇺🇸" : country === "CA" ? "🇨🇦" : null;
            const profile = crawlProfileFor(prov?.internalName);
            const scheduled = scheduledStart(job);
            const label = scheduled ? "scheduled" : job.status;
            const expanded = expandedJobId === job.id;
            return (
              <div key={job.id} className="rounded-2xl border border-border/80 bg-card overflow-hidden">
                <button
                  type="button"
                  className="w-full text-left p-4"
                  onClick={() => setExpandedJobId(expanded ? null : job.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-semibold">
                        {flag ? <span>{flag}</span> : null}
                        <span className="truncate">{job.providerName || `Provider #${job.providerId}`}</span>
                      </div>
                      <div className="mt-0.5 text-xs font-mono text-muted-foreground">
                        #{job.id.toString().padStart(6, "0")} · {jobTypeLabel(job.jobType)}
                      </div>
                    </div>
                    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold border shrink-0 ${getStatusClass(label)}`}>
                      <StatusIcon status={label} />
                      {label.toUpperCase()}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-mono">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Fetched</div>
                      <div className="mt-0.5">{job.listingsFetched ?? 0}{job.itemsDiscovered ? ` / ${job.itemsDiscovered}` : ""}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">VINs</div>
                      <div className="mt-0.5">
                        <span className="text-primary font-semibold">{job.vinsFound ?? 0}</span>
                        {(job.vinsNew ?? 0) > 0 && <span className="text-green-600"> · {job.vinsNew} new</span>}
                      </div>
                    </div>
                  </div>
                  {(profile || prov?.type) && (
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {profile && extractionLabel(profile.extraction)}
                      {prov?.type ? ` · ${prov.type}` : ""}
                      {job.pagesProcessed ? ` · ${job.pagesProcessed} pages` : ""}
                    </div>
                  )}
                </button>
                <div
                  className="px-3 pb-3 flex flex-wrap gap-1 border-t border-border/60 pt-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button variant="ghost" size="sm" className="h-10 text-xs" onClick={() => void handleExportJob(job.id)} disabled={exportingId !== null}>
                    <Download className="w-3.5 h-3.5" /> CSV
                  </Button>
                  <Button variant="ghost" size="sm" className="h-10 text-xs" onClick={() => setLogJobId(logJobId === job.id ? null : job.id)}>
                    <FileText className="w-3.5 h-3.5" /> Logs
                  </Button>
                  {(job.status === "pending" || job.status === "running") && (
                    <Button variant="ghost" size="sm" className="h-10 text-xs" onClick={() => handlePause(job.id)}>
                      <Pause className="w-4 h-4" /> Pause
                    </Button>
                  )}
                  {(job.status === "failed" || job.status === "cancelled" || job.status === "paused") && (
                    <>
                      <Button variant="ghost" size="sm" className="h-10 text-xs text-sky-700" onClick={() => handleContinue(job.id)}>
                        <Play className="w-4 h-4" /> Continue
                      </Button>
                      <Button variant="ghost" size="sm" className="h-10 text-xs" onClick={() => { setResumeJobRow(job); setIsCreateOpen(true); }}>
                        <Pencil className="w-4 h-4" /> Edit
                      </Button>
                    </>
                  )}
                  {(job.status === "pending" || job.status === "running" || job.status === "paused") && (
                    <Button variant="ghost" size="sm" className="h-10 text-xs text-destructive" onClick={() => handleCancel(job.id)}>
                      <SquareSquare className="w-4 h-4" /> Cancel
                    </Button>
                  )}
                  {job.status !== "running" && (
                    <Button variant="ghost" size="sm" className="h-10 text-xs text-destructive" onClick={() => handlePurge(job.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-10 text-xs ml-auto" onClick={() => setExpandedJobId(expanded ? null : job.id)}>
                    {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </Button>
                </div>
                {expanded && (
                  <div className="px-4 pb-4 border-t border-border bg-muted/20">
                    <div className="pt-3">
                      <JobDetail job={job} />
                    </div>
                  </div>
                )}
                {logJobId === job.id && (
                  <div className="px-4 pb-4 border-t border-border bg-muted/10">
                    <div className="pt-3">
                      <JobLogViewer jobId={job.id} />
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </MobileCards>

      <DesktopTable>
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm text-left">
            <thead className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground border-b border-border tracking-wider">
              <tr>
                <th className="px-6 py-4">Job ID</th>
                <th className="px-6 py-4">Provider</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Progress</th>
                <th className="px-6 py-4 text-right">VINs</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground animate-pulse font-mono text-xs">
                    LOADING_JOBS...
                  </td>
                </tr>
              ) : !jobsList || jobsList.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                    No jobs found.
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job) => (
                  <React.Fragment key={job.id}>
                    <tr
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                    >
                      <td className="px-6 py-4 font-mono text-xs">#{job.id.toString().padStart(6, "0")}</td>
                      <td className="px-6 py-4 font-medium">
                        <div className="flex items-center gap-1.5">
                          {(() => {
                            const prov = providers?.find((p) => p.id === job.providerId) as any;
                            const country = prov?.country;
                            const flag = country === "KR" ? "🇰🇷" : country === "US" ? "🇺🇸" : country === "CA" ? "🇨🇦" : null;
                            return flag ? <span title={country}>{flag}</span> : null;
                          })()}
                          <span>{job.providerName || `Provider #${job.providerId}`}</span>
                        </div>
                        {(() => {
                          const prov = providers?.find((p) => p.id === job.providerId) as any;
                          const slug = prov?.internalName;
                          const profile = crawlProfileFor(slug);
                          const typeBadge = prov?.type;
                          return (
                            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                              {profile && <span>{extractionLabel(profile.extraction)}</span>}
                              {typeBadge && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                  typeBadge === "auction" ? "bg-amber-50 text-amber-700 border-amber-200" :
                                  typeBadge === "dealer" ? "bg-blue-50 text-blue-700 border-blue-200" :
                                  "bg-green-50 text-green-700 border-green-200"
                                }`}>{typeBadge}</span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-xs text-muted-foreground">
                          {jobTypeLabel(job.jobType)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const scheduled = scheduledStart(job);
                          const label = scheduled ? "scheduled" : job.status;
                          return (
                            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${getStatusClass(label)}`}>
                              <StatusIcon status={label} />
                              {label.toUpperCase()}
                              {scheduled ? <span className="font-normal opacity-80">{scheduled}</span> : null}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="font-mono text-xs">
                          {job.listingsFetched ?? 0} fetched
                          {job.itemsDiscovered ? ` / ${job.itemsDiscovered}` : ""}
                          {job.pagesProcessed != null && job.pagesProcessed > 0 && (
                            <div className="text-muted-foreground">{job.pagesProcessed} pages</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="font-mono text-xs">
                          <span className="text-primary font-semibold">{job.vinsFound ?? 0}</span>
                          {" found"}
                          {(job.vinsNew ?? 0) > 0 && <span className="text-green-600"> ({job.vinsNew} new)</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={(e) => { e.stopPropagation(); void handleExportJob(job.id); }}
                            disabled={exportingId !== null}
                            title="Export VINs and listing fields as CSV"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={(e) => { e.stopPropagation(); setLogJobId(logJobId === job.id ? null : job.id); }}
                            title="View job logs"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </Button>
                          {(job.status === "pending" || job.status === "running") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={(e) => { e.stopPropagation(); handlePause(job.id); }}
                              title="Pause — continue later from this page"
                            >
                              <Pause className="w-4 h-4 mr-1" /> Pause
                            </Button>
                          )}
                          {(job.status === "failed" || job.status === "cancelled" || job.status === "paused") && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs text-sky-700 hover:text-sky-800"
                                onClick={(e) => { e.stopPropagation(); handleContinue(job.id); }}
                                title="Continue from the last completed page"
                              >
                                <Play className="w-4 h-4 mr-1" /> Continue
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setResumeJobRow(job);
                                  setIsCreateOpen(true);
                                }}
                                title="Edit settings, then continue"
                              >
                                <Pencil className="w-4 h-4 mr-1" /> Edit
                              </Button>
                            </>
                          )}
                          {(job.status === "pending" || job.status === "running" || job.status === "paused") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={(e) => { e.stopPropagation(); handleCancel(job.id); }}
                            >
                              <SquareSquare className="w-4 h-4 mr-1" /> Cancel
                            </Button>
                          )}
                          {job.status !== "running" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={(e) => { e.stopPropagation(); handlePurge(job.id); }}
                              title="Remove job record"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {expandedJobId === job.id ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedJobId === job.id && (
                      <tr>
                        <td colSpan={7} className="bg-muted/20 px-6 py-4 border-b border-border">
                          <JobDetail job={job} />
                        </td>
                      </tr>
                    )}
                    {logJobId === job.id && (
                      <tr>
                        <td colSpan={7} className="bg-muted/10 px-6 py-4 border-b border-border">
                          <JobLogViewer jobId={job.id} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </DesktopTable>

      <CreateJobDialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open);
          if (!open) setResumeJobRow(null);
        }}
        resumeFrom={resumeJobRow}
      />
    </PageEnter>
  );
}

function JobLogViewer({ jobId }: { jobId: number }) {
  const [levelFilter, setLevelFilter] = useState("");
  const { data, isLoading } = useListJobLogs(
    jobId,
    { level: levelFilter || undefined, limit: 200 },
  );

  const LEVEL_COLORS: Record<string, string> = {
    info: "text-blue-600",
    warning: "text-amber-600",
    error: "text-red-600",
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <FileText className="w-3.5 h-3.5" /> Job Logs
          {data && <span className="font-mono text-foreground">({data.total} entries)</span>}
        </div>
        <div className="flex gap-1">
          {["", "info", "warning", "error"].map(l => (
            <button
              key={l || "all"}
              onClick={() => setLevelFilter(l)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase transition-colors ${
                levelFilter === l ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {l || "ALL"}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-background border border-border rounded-lg overflow-hidden max-h-96 overflow-y-auto font-mono text-xs">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground animate-pulse">Loading logs...</div>
        ) : !data?.items.length ? (
          <div className="p-4 text-center text-muted-foreground">
            No log entries found. Logs appear when the job runs.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.items.map(log => (
              <div key={log.id} className="px-3 py-2 hover:bg-muted/20 flex flex-col sm:flex-row sm:gap-3 gap-1">
                <span className="text-muted-foreground whitespace-nowrap shrink-0">
                  {new Date(log.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className={`uppercase font-bold shrink-0 w-12 ${LEVEL_COLORS[log.level] ?? "text-muted-foreground"}`}>
                  {log.level}
                </span>
                <span className="text-muted-foreground shrink-0 w-20 truncate" title={log.stage}>
                  [{log.stage}]
                </span>
                <span className="text-foreground flex-1">{log.message}</span>
                {log.details && (
                  <details className="shrink-0">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">details</summary>
                    <pre className="mt-1 text-[10px] text-muted-foreground whitespace-pre-wrap">
                      {(() => { try { return JSON.stringify(JSON.parse(log.details), null, 2); } catch { return log.details; } })()}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobDetail({ job }: { job: any }) {
  const counters = [
    { label: "Pages Processed", value: job.pagesProcessed },
    { label: "Listings Fetched", value: job.listingsFetched },
    { label: "VINs Found", value: job.vinsFound },
    { label: "New VINs", value: job.vinsNew },
    { label: "New Observations", value: job.newObservations },
    { label: "Skipped (recent + duplicate)", value: job.duplicatesSkipped },
    { label: "Failed", value: job.itemsFailed },
  ].filter((c) => c.value != null);

  let filterParams: Record<string, unknown> | null = null;
  if (job.jobConfig) {
    try { filterParams = JSON.parse(job.jobConfig); } catch {}
  }
  let crawlState: any | null = null;
  if (job.crawlState) {
    try { crawlState = JSON.parse(job.crawlState); } catch {}
  }
  const currentShard = crawlState?.shards?.find?.((sh: any) => sh.id === crawlState?.currentShardId) ?? null;
  const coolingShards = Array.isArray(crawlState?.shards)
    ? crawlState.shards.filter((sh: any) => sh.status === "cooldown")
    : [];
  const shardCounts = Array.isArray(crawlState?.shards)
    ? {
        total: crawlState.shards.length,
        completed: crawlState.shards.filter((sh: any) => sh.status === "completed").length,
        pending: crawlState.shards.filter((sh: any) => sh.status === "pending" || sh.status === "active").length,
      }
    : null;

  return (
    <div className="space-y-3">
      {counters.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {counters.map((c) => (
            <div key={c.label} className="text-center">
              <div className="text-lg font-mono font-bold text-foreground">{c.value}</div>
              <div className="text-xs text-muted-foreground">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {filterParams && Object.keys(filterParams).length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Filter Config</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(filterParams)
              .filter(([, v]) => v != null && v !== "")
              .map(([k, v]) => (
                <span key={k} className="bg-secondary text-secondary-foreground px-2 py-0.5 rounded text-xs font-mono">
                  {k}={String(v)}
                </span>
              ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            CSV export uses these crawl filters (make, year, mileage, price) against stored listings.
          </p>
        </div>
      )}

      {crawlState && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Crawl Health</div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs">
              <div><span className="text-muted-foreground">Strategy:</span> <span className="font-mono">{crawlState.strategy}</span></div>
              {crawlState.refreshPhase && (
                <div>
                  <span className="text-muted-foreground">Phase:</span>{" "}
                  <span className="font-mono">
                    {crawlState.refreshPhase === "discover" ? "new & updated" : "sold & stale"}
                  </span>
                </div>
              )}
              <div><span className="text-muted-foreground">Current shard:</span> <span className="font-mono">{currentShard?.label ?? "—"}</span></div>
              {shardCounts && (
                <div>
                  <span className="text-muted-foreground">Shards:</span>{" "}
                  <span className="font-mono">
                    {shardCounts.completed}/{shardCounts.total} done
                    {shardCounts.pending > 0 ? ` · ${shardCounts.pending} remaining` : ""}
                  </span>
                </div>
              )}
              <div><span className="text-muted-foreground">Cooling shards:</span> <span className="font-mono">{coolingShards.length}</span></div>
              {currentShard && (
                <div><span className="text-muted-foreground">Shard page:</span> <span className="font-mono">{currentShard.nextPage}</span></div>
              )}
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs">
              {crawlState.lastBlock ? (
                <>
                  <div><span className="text-muted-foreground">Last block:</span> <span className="font-mono">{crawlState.lastBlock.category}</span></div>
                  <div className="mt-1 text-muted-foreground">{crawlState.lastBlock.message}</div>
                </>
              ) : (
                <div className="text-muted-foreground">No recent block snapshot.</div>
              )}
            </div>
          </div>
          {Array.isArray(crawlState?.shards) && (crawlState.shards.length > 1 || crawlState.strategy === "listing_refresh") && (
            <div className="flex flex-wrap gap-2">
              {crawlState.shards.map((sh: any) => (
                <span
                  key={sh.id}
                  className={`px-2 py-0.5 rounded text-xs font-mono border ${
                    String(sh.lastError ?? "").startsWith("split")
                      ? "bg-slate-50 text-slate-600 border-slate-200"
                      : sh.status === "completed"
                      ? "bg-green-50 text-green-700 border-green-200"
                      : sh.status === "cooldown"
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : sh.status === "active"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-secondary text-secondary-foreground border-border"
                  }`}
                >
                  {String(sh.lastError ?? "").startsWith("split") ? `${sh.label}:split` : `${sh.label}:${sh.pagesProcessed}p`}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {job.errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 font-mono">
          {job.errorMessage}
        </div>
      )}

      <div className="text-xs text-muted-foreground font-mono space-y-0.5">
        {job.startedAt && <div>Started: {new Date(job.startedAt).toLocaleString()}</div>}
        {job.completedAt && (
          <div>
            {job.status === "paused" ? "Paused" : job.status === "cancelled" ? "Stopped" : "Completed"}: {new Date(job.completedAt).toLocaleString()}
          </div>
        )}
        <div>Created: {new Date(job.createdAt).toLocaleString()}</div>
      </div>
    </div>
  );
}

function CreateJobDialog({
  open,
  onOpenChange,
  resumeFrom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resumeFrom?: any | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createMutation = useCreateJob();
  const { data: providers } = useListProviders();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resetProgress, setResetProgress] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const extraFiltersRef = useRef<Record<string, unknown>>({});

  const emptyForm = {
    providerId: "",
    jobType: "full_collection",
    targetUrl: "",
    brand: "",
    model: "",
    yearFrom: "",
    yearTo: "",
    fuel: "",
    transmission: "",
    minPrice: "",
    maxPrice: "",
    minMileage: "",
    maxMileage: "",
    location: "",
    maxPages: "",
    maxListings: "",
    delayMs: "500",
    concurrency: "3",
    retryCount: "3",
    skipRecentHours: "12",
    detailLevel: "full",
  };

  const [formData, setFormData] = useState(emptyForm);

  const selectedProvider = providers?.find((p) => String(p.id) === formData.providerId);
  const selectedProfile = crawlProfileFor(selectedProvider?.internalName);

  const applyCrawlProfile = (providerId: string, jobType: string) => {
    const provider = providers?.find((p) => String(p.id) === providerId);
    const profile = crawlProfileFor(provider?.internalName);
    setFormData((s) => ({
      ...s,
      providerId,
      jobType,
      delayMs: String(profile?.delayMs ?? 500),
      concurrency: String(profile?.concurrency ?? 3),
      retryCount: String(profile?.retryCount ?? 3),
      skipRecentHours: String(profile?.skipRecentHours ?? 12),
      detailLevel: jobType === "listing_refresh" ? "standard" : (profile?.detailLevel ?? "full"),
    }));
  };

  useEffect(() => {
    if (!open) return;
    if (!resumeFrom) {
      extraFiltersRef.current = {};
      setResetProgress(false);
      setFormData(emptyForm);
      return;
    }
    let cfg: Record<string, unknown> = {};
    if (resumeFrom.jobConfig) {
      try { cfg = JSON.parse(resumeFrom.jobConfig); } catch { cfg = {}; }
    }
    extraFiltersRef.current = { ...cfg };
    setShowAdvanced(true);
    setResetProgress(false);
    setFormData({
      providerId: String(resumeFrom.providerId ?? ""),
      jobType: resumeFrom.jobType ?? "full_collection",
      targetUrl: resumeFrom.targetUrl ?? "",
      brand: String(cfg.brand ?? ""),
      model: String(cfg.model ?? ""),
      yearFrom: cfg.yearFrom != null ? String(cfg.yearFrom) : "",
      yearTo: cfg.yearTo != null ? String(cfg.yearTo) : "",
      fuel: String(cfg.fuel ?? ""),
      transmission: String(cfg.transmission ?? ""),
      minPrice: cfg.minPrice != null ? String(cfg.minPrice) : "",
      maxPrice: cfg.maxPrice != null ? String(cfg.maxPrice) : "",
      minMileage: cfg.minMileage != null ? String(cfg.minMileage) : "",
      maxMileage: cfg.maxMileage != null ? String(cfg.maxMileage) : "",
      location: String(cfg.location ?? ""),
      maxPages: cfg.maxPages != null ? String(cfg.maxPages) : "",
      maxListings: cfg.maxListings != null ? String(cfg.maxListings) : "",
      delayMs: cfg.delayMs != null ? String(cfg.delayMs) : "500",
      concurrency: cfg.concurrency != null ? String(cfg.concurrency) : "3",
      retryCount: cfg.retryCount != null ? String(cfg.retryCount) : "3",
      skipRecentHours: cfg.skipRecentHours != null ? String(cfg.skipRecentHours) : "12",
      detailLevel: cfg.detailLevel === "standard" ? "standard" : "full",
    });
  }, [open, resumeFrom]);

  const set = (key: string, value: string) => setFormData((s) => ({ ...s, [key]: value }));

  const buildFilterParams = () => {
    const filterParams: Record<string, unknown> = { ...extraFiltersRef.current };
    const assign = (key: string, value: string, numeric = false) => {
      if (!value) {
        delete filterParams[key];
        return;
      }
      filterParams[key] = numeric ? Number(value) : value;
    };
    assign("brand", formData.brand);
    assign("model", formData.model);
    assign("yearFrom", formData.yearFrom, true);
    assign("yearTo", formData.yearTo, true);
    assign("fuel", formData.fuel);
    assign("transmission", formData.transmission);
    assign("minPrice", formData.minPrice, true);
    assign("maxPrice", formData.maxPrice, true);
    assign("minMileage", formData.minMileage, true);
    assign("maxMileage", formData.maxMileage, true);
    assign("location", formData.location);
    assign("maxPages", formData.maxPages, true);
    assign("maxListings", formData.maxListings, true);
    assign("delayMs", formData.delayMs, true);
    assign("concurrency", formData.concurrency, true);
    assign("retryCount", formData.retryCount, true);
    assign("skipRecentHours", formData.skipRecentHours, true);
    if (formData.detailLevel === "standard" || formData.detailLevel === "full") {
      filterParams.detailLevel = formData.detailLevel;
    }
    return filterParams;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.providerId) return;
    const filterParams = buildFilterParams();

    if (resumeFrom) {
      setSubmitting(true);
      try {
        await resumeJob(resumeFrom.id, {
          filterParams,
          jobType: formData.jobType,
          targetUrl: formData.targetUrl || null,
          resetProgress,
        });
        toast({
          title: resetProgress ? "Job restarted" : "Job continuing",
          description: resetProgress
            ? "Queued from page 1 with the updated settings."
            : `Queued from page ${(resumeFrom.pagesProcessed ?? 0) + 1}.`,
        });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        onOpenChange(false);
      } catch (err) {
        toast({ title: "Failed to continue job", description: String(err), variant: "destructive" });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    createMutation.mutate(
      {
        data: {
          providerId: parseInt(formData.providerId),
          jobType: formData.jobType as any,
          targetUrl: formData.targetUrl || undefined,
          filterParams: Object.keys(filterParams).length > 0 ? (filterParams as any) : undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Job triggered successfully" });
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
          onOpenChange(false);
        },
        onError: (err: any) => {
          toast({ title: "Failed to create job", description: err.message, variant: "destructive" });
        },
      },
    );
  };

  const inputClass =
    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {resumeFrom ? `Continue job #${resumeFrom.id}` : "Trigger Collection Job"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {resumeFrom && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
                Last checkpoint: page {resumeFrom.pagesProcessed ?? 0}, {resumeFrom.listingsFetched ?? 0} listings fetched.
                {!resetProgress && (
                  <span className="block mt-0.5 font-medium">
                    Will resume at page {(resumeFrom.pagesProcessed ?? 0) + 1}.
                  </span>
                )}
                <label className="mt-2 flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resetProgress}
                    onChange={(e) => setResetProgress(e.target.checked)}
                  />
                  Restart from page 1 instead
                </label>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Provider *</label>
                <select
                  required
                  className={inputClass}
                  value={formData.providerId}
                  onChange={(e) => applyCrawlProfile(e.target.value, formData.jobType)}
                  disabled={Boolean(resumeFrom)}
                >
                  <option value="" disabled>Select provider...</option>
                  {(() => {
                    const groups = new Map<string, typeof providers>();
                    for (const p of providers ?? []) {
                      const c = (p as any).country ?? "Other";
                      if (!groups.has(c)) groups.set(c, []);
                      groups.get(c)!.push(p);
                    }
                    const countryLabel: Record<string, string> = { KR: "🇰🇷 Korea", US: "🇺🇸 United States", CA: "🇨🇦 Canada" };
                    return [...groups.entries()].map(([country, provs]) => (
                      <optgroup key={country} label={countryLabel[country] ?? country}>
                        {provs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </optgroup>
                    ));
                  })()}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Job Type</label>
                <select
                  className={inputClass}
                  value={formData.jobType}
                  onChange={(e) => {
                    const jobType = e.target.value;
                    setFormData((s) => ({
                      ...s,
                      jobType,
                      detailLevel:
                        jobType === "listing_refresh"
                          ? "standard"
                          : (selectedProfile?.detailLevel ?? "full"),
                    }));
                  }}
                >
                  <option value="full_collection">Full Collection — discover new listings</option>
                  <option value="incremental">Incremental — new/changed search results</option>
                  <option value="listing_refresh">Status refresh — new VINs + sold/price on known cars</option>
                  <option value="single_listing">Single Listing Test</option>
                </select>
                {formData.jobType === "listing_refresh" && (
                  <p className="text-xs text-muted-foreground">
                    Two passes, no full recrawl. First scans newest search results for newly published cars and still-listed price/mileage changes (new VINs get full history). Then re-fetches stale ads that dropped off search — those are usually sold or removed. When it finishes it queues itself again in 12 hours.
                  </p>
                )}
              </div>
            </div>

            {selectedProfile && (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                <div className="font-semibold text-foreground">{extractionLabel(selectedProfile.extraction)}</div>
                <p className="text-muted-foreground mt-0.5">{selectedProfile.summary}</p>
                <p className="text-muted-foreground mt-1 font-mono">
                  delay {selectedProfile.delayMs}ms · concurrency {selectedProfile.concurrency} · VIN-only persist
                </p>
              </div>
            )}

            {formData.jobType === "single_listing" && (
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Target URL</label>
                <input type="text" className={inputClass} placeholder="https://..." value={formData.targetUrl} onChange={(e) => set("targetUrl", e.target.value)} />
              </div>
            )}

            <div className="border border-border rounded-lg overflow-hidden">
              <button
                type="button"
                className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold bg-muted/30 hover:bg-muted/50 transition-colors"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <span>Collection Filters & Options</span>
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showAdvanced && (
                <div className="p-4 space-y-4">
                  <div>
                    {formData.jobType !== "listing_refresh" && (
                    <>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Vehicle Filters</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[
                        { key: "brand", label: "Brand", placeholder: "Hyundai, Kia..." },
                        { key: "model", label: "Model", placeholder: "Tucson, Sportage..." },
                      ].map(({ key, label, placeholder }) => (
                        <div key={key} className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">{label}</label>
                          <input type="text" className={inputClass} placeholder={placeholder} value={(formData as any)[key]} onChange={(e) => set(key, e.target.value)} />
                        </div>
                      ))}
                      {[
                        { key: "yearFrom", label: "Year From", placeholder: "2015" },
                        { key: "yearTo", label: "Year To", placeholder: "2024" },
                        { key: "minPrice", label: "Min Price", placeholder: "5000" },
                        { key: "maxPrice", label: "Max Price", placeholder: "30000" },
                        { key: "minMileage", label: "Min Mileage", placeholder: "0" },
                        { key: "maxMileage", label: "Max Mileage", placeholder: "150000" },
                      ].map(({ key, label, placeholder }) => (
                        <div key={key} className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">{label}</label>
                          <input type="number" className={inputClass} placeholder={placeholder} value={(formData as any)[key]} onChange={(e) => set(key, e.target.value)} />
                        </div>
                      ))}
                    </div>
                    </>
                    )}
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Collection Settings</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[
                        { key: "maxPages", label: "Max Pages", placeholder: "50" },
                        { key: "maxListings", label: "Max Listings", placeholder: "500" },
                        { key: "delayMs", label: "Delay (ms)", placeholder: String(selectedProfile?.delayMs ?? 500) },
                        { key: "concurrency", label: "Parallel fetches", placeholder: String(selectedProfile?.concurrency ?? 3) },
                        { key: "retryCount", label: "Retry Count", placeholder: "3" },
                        { key: "skipRecentHours", label: "Skip if seen (hours)", placeholder: "12" },
                      ].map(({ key, label, placeholder }) => (
                        <div key={key} className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">{label}</label>
                          <input type="number" className={inputClass} placeholder={placeholder} value={(formData as any)[key]} onChange={(e) => set(key, e.target.value)} />
                        </div>
                      ))}
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">History depth</label>
                        <select className={inputClass} value={formData.detailLevel} onChange={(e) => set("detailLevel", e.target.value)}>
                          <option value="full">Full (registry + inspection + diagnosis)</option>
                          <option value="standard">Standard (registry only)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending || submitting || !formData.providerId}>
              <Play className="w-4 h-4 mr-2" /> {resumeFrom ? "Save & continue" : "Start Pipeline"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
