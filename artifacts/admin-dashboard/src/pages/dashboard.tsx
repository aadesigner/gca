import React from "react";
import { Link } from "wouter";
import { useGetDashboardStats } from "@workspace/api-client-react";
import {
  Activity,
  ArrowRight,
  Camera,
  Car,
  Database,
  AlertCircle,
  CheckCircle2,
  Clock,
  Globe2,
  Radio,
  Search,
  TerminalSquare,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { PageEnter, PageHeader, StatTile, Surface } from "@/components/page";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const TYPE_COLORS: Record<string, string> = {
  auction: "hsl(217 91% 53%)",
  classifieds: "hsl(160 84% 39%)",
  dealer: "hsl(38 92% 50%)",
  marketplace: "hsl(258 90% 66%)",
  oem: "hsl(215 16% 47%)",
};

function countryMeta(code: string): { code: string; name: string; flag: string } {
  const raw = (code || "Unknown").trim();
  const upper = raw.toUpperCase();
  if (upper === "KR" || /korea/i.test(raw)) return { code: "KR", name: "South Korea", flag: "🇰🇷" };
  if (upper === "US" || /united states|usa/i.test(raw)) return { code: "US", name: "United States", flag: "🇺🇸" };
  if (upper === "CA" || /canada/i.test(raw)) return { code: "CA", name: "Canada", flag: "🇨🇦" };
  if (upper === "JP" || /japan/i.test(raw)) return { code: "JP", name: "Japan", flag: "🇯🇵" };
  if (upper === "DE" || /germany/i.test(raw)) return { code: "DE", name: "Germany", flag: "🇩🇪" };
  if (upper === "GB" || /united kingdom|uk/i.test(raw)) return { code: "GB", name: "United Kingdom", flag: "🇬🇧" };
  if (upper === "PL" || /poland|polska/i.test(raw)) return { code: "PL", name: "Poland", flag: "🇵🇱" };
  if (upper === "AE" || /united arab|uae/i.test(raw)) return { code: "AE", name: "United Arab Emirates", flag: "🇦🇪" };
  if (upper === "CZ" || /czech/i.test(raw)) return { code: "CZ", name: "Czechia", flag: "🇨🇿" };
  if (upper === "SK" || /slovakia/i.test(raw)) return { code: "SK", name: "Slovakia", flag: "🇸🇰" };
  if (upper === "EU" || /^europe$/i.test(raw)) return { code: "EU", name: "Europe", flag: "🇪🇺" };
  return { code: upper.slice(0, 8), name: raw, flag: "🌐" };
}

export default function Dashboard() {
  const { data: stats, isLoading } = useGetDashboardStats();

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-56 bg-muted rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-32 bg-muted rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const weekShare =
    stats.apiRequestsThisWeek > 0
      ? Math.min(100, Math.round((stats.apiRequestsToday / stats.apiRequestsThisWeek) * 100))
      : 0;

  const countries = stats.byCountry ?? [];
  const types = stats.byType ?? [];
  const providers = stats.byProvider ?? [];
  const obsDays = stats.observationsByDay ?? [];
  const maxCountryListings = Math.max(1, ...countries.map((c) => c.listings));
  const vinPct =
    stats.totalListings > 0
      ? Math.round(((stats.listingsWithVin ?? 0) / stats.totalListings) * 100)
      : 0;

  const obsRecent = obsDays.slice(-7).reduce((n, d) => n + (d.count || 0), 0);
  const obsPrior = obsDays.slice(0, Math.max(0, obsDays.length - 7)).reduce((n, d) => n + (d.count || 0), 0);
  const obsDeltaPct =
    obsPrior > 0 ? Math.round(((obsRecent - obsPrior) / obsPrior) * 100) : obsRecent > 0 ? 100 : 0;
  const obsDeltaLabel =
    obsPrior > 0 || obsRecent > 0
      ? `${obsDeltaPct > 0 ? "+" : ""}${obsDeltaPct}% vs prior 7d`
      : null;

  const dayAvgWeek =
    stats.recordsThisWeek > 0 ? Math.round(stats.recordsThisWeek / 7) : 0;
  const todayVsAvg =
    dayAvgWeek > 0
      ? Math.round(((stats.recordsToday - dayAvgWeek) / dayAvgWeek) * 100)
      : 0;
  const todayDeltaLabel =
    dayAvgWeek > 0 ? `${todayVsAvg > 0 ? "+" : ""}${todayVsAvg}% vs 7d avg` : null;

  const photoHosted = stats.photosSelfHostedCount ?? 0;
  const photoSource = stats.photosSourceUrlCount ?? stats.photosCount ?? 0;
  const photoHostPct =
    photoSource > 0 ? Math.round((photoHosted / photoSource) * 100) : 0;

  const apiDayShareLabel =
    stats.apiRequestsThisWeek > 0 ? `${weekShare}% of week` : null;

  const obsConfig = { count: { label: "Observations", color: "hsl(217 91% 53%)" } } satisfies ChartConfig;
  const countryConfig = { listings: { label: "Listings", color: "hsl(217 91% 53%)" } } satisfies ChartConfig;
  const typeConfig = Object.fromEntries(
    types.map((t) => [t.type, { label: t.type, color: TYPE_COLORS[t.type] ?? "hsl(215 16% 47%)" }]),
  ) as ChartConfig;

  const pieData = types.map((t) => ({
    name: t.type,
    value: t.listings,
    fill: TYPE_COLORS[t.type] ?? "hsl(215 16% 47%)",
  }));

  const countryChart = countries.map((row) => {
    const meta = countryMeta(row.country);
    return { ...row, label: meta.name, flag: meta.flag };
  });

  return (
    <PageEnter className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Overview"
        description="Inventory coverage, pipeline health, and API traffic — tuned for phone checks."
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
        <StatTile label="Vehicles" value={stats.totalVins.toLocaleString()} icon={Car} />
        <StatTile label="Listings" value={stats.totalListings.toLocaleString()} icon={Database} />
        <StatTile
          label="Observations (7d)"
          value={obsRecent.toLocaleString()}
          icon={Zap}
          delta={obsDeltaLabel}
          hint={`${stats.totalObservations.toLocaleString()} all-time`}
        />
        <StatTile
          label="Records today"
          value={stats.recordsToday.toLocaleString()}
          icon={Activity}
          delta={todayDeltaLabel}
          hint={`${stats.recordsThisWeek.toLocaleString()} this week`}
          accent
        />
        <StatTile
          label="Countries"
          value={stats.countriesCount ?? countries.length}
          icon={Globe2}
          hint={`${stats.activeProviders}/${stats.totalProviders} providers on`}
        />
        <StatTile
          label="VIN coverage"
          value={`${vinPct}%`}
          hint={`${(stats.listingsWithVin ?? 0).toLocaleString()} listings with VIN`}
        />
        <StatTile
          label="CDN photos"
          value={`${photoHostPct}%`}
          icon={Camera}
          hint={`${photoHosted.toLocaleString()} hosted / ${photoSource.toLocaleString()} source`}
        />
        <StatTile
          label="API today"
          value={stats.apiRequestsToday.toLocaleString()}
          icon={Radio}
          delta={apiDayShareLabel}
          hint={`${stats.apiRequestsThisWeek.toLocaleString()} this week`}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <JobStat label="Pending" value={stats.pendingJobs} icon={Clock} color="text-amber-500" />
        <JobStat label="Running" value={stats.activeJobs} icon={Activity} color="text-blue-500" />
        <JobStat label="Done today" value={stats.completedJobsToday} icon={CheckCircle2} color="text-emerald-500" />
        <JobStat label="Failed" value={stats.failedJobs} icon={AlertCircle} color="text-red-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4">
        <Surface className="lg:col-span-3">
          <div className="px-4 sm:px-5 py-3 border-b border-border/80">
            <h2 className="text-sm font-semibold">Listings by country</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Vehicle / listing origin (same basis as Vehicles filters)
            </p>
          </div>
          {countryChart.length > 0 ? (
            <div className="p-3 sm:p-5 space-y-4">
              <ChartContainer config={countryConfig} className="aspect-auto h-[160px] sm:h-[200px] w-full">
                <BarChart data={countryChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} width={42} tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="listings" fill="var(--color-listings)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ChartContainer>
              <div className="space-y-3">
                {countryChart.map((row) => (
                  <div key={row.country} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base leading-none">{row.flag}</span>
                        <span className="font-medium truncate">{row.label}</span>
                        <span className="text-[10px] font-mono uppercase text-muted-foreground">{row.country}</span>
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0">
                        {row.listings.toLocaleString()} listings · {row.vehicles.toLocaleString()} VINs · {row.providers} sources
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${Math.max(4, Math.round((row.listings / maxCountryListings) * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-8 text-sm text-muted-foreground">No country data yet.</div>
          )}
        </Surface>

        <Surface className="lg:col-span-2">
          <div className="px-4 sm:px-5 py-3 border-b border-border/80">
            <h2 className="text-sm font-semibold">Listings by source type</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Auction, classifieds, dealer, marketplace</p>
          </div>
          {pieData.some((d) => d.value > 0) ? (
            <div className="p-3 sm:p-4">
              <ChartContainer config={typeConfig} className="aspect-auto h-[160px] sm:h-[210px] w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={3}>
                    {pieData.map((d) => (
                      <Cell key={d.name} fill={d.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="space-y-2 px-1 pb-2">
                {types.map((t) => (
                  <div key={t.type} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: TYPE_COLORS[t.type] ?? "hsl(215 16% 47%)" }}
                      />
                      <span className="capitalize font-medium">{t.type}</span>
                      <span className="text-muted-foreground">{t.providers} providers</span>
                    </div>
                    <span className="font-mono tabular-nums">{t.listings.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-8 text-sm text-muted-foreground">No type breakdown yet.</div>
          )}
        </Surface>
      </div>

      <Surface>
        <div className="px-4 sm:px-5 py-3 border-b border-border/80">
          <h2 className="text-sm font-semibold">Observations last 14 days</h2>
          <p className="text-xs text-muted-foreground mt-0.5">New history snapshots written per day</p>
        </div>
        <div className="p-3 sm:p-5">
          <ChartContainer config={obsConfig} className="aspect-auto h-[180px] sm:h-[220px] w-full">
            <AreaChart data={obsDays} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => v.slice(5)}
                tick={{ fontSize: 11 }}
              />
              <YAxis tickLine={false} axisLine={false} width={42} tick={{ fontSize: 11 }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                type="monotone"
                dataKey="count"
                stroke="var(--color-count)"
                fill="var(--color-count)"
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </div>
      </Surface>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
        <Surface className="lg:col-span-3">
          <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-border/80 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Collection pipeline</h2>
            <Link href="/jobs" className="text-xs font-medium text-primary inline-flex items-center gap-1 hover:underline">
              Open jobs <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="p-5 sm:p-8 text-center">
            <div className="text-3xl sm:text-4xl font-semibold font-mono tracking-tight tabular-nums">
              {stats.recordsToday.toLocaleString()}
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mt-2">
              Records collected today
            </div>
            <div className="text-xs text-muted-foreground mt-1.5">
              {stats.recordsThisWeek.toLocaleString()} this week
              {todayDeltaLabel ? ` · ${todayDeltaLabel}` : ""}
            </div>
          </div>
        </Surface>

        <Surface className="lg:col-span-2">
          <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-border/80">
            <h2 className="text-sm font-semibold">API traffic</h2>
          </div>
          <div className="p-4 sm:p-6 space-y-6 sm:space-y-8">
            <div>
              <div className="flex justify-between items-end mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Today</span>
                <span className="text-xl sm:text-2xl font-mono font-semibold tabular-nums">{stats.apiRequestsToday.toLocaleString()}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="progress-fill h-full bg-primary rounded-full"
                  style={{ width: `${Math.max(8, weekShare)}%` }}
                />
              </div>
              {apiDayShareLabel ? (
                <p className="text-[11px] text-muted-foreground mt-1.5">{apiDayShareLabel}</p>
              ) : null}
            </div>
            <div>
              <div className="flex justify-between items-end mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">This week</span>
                <span className="text-xl sm:text-2xl font-mono font-semibold tabular-nums">{stats.apiRequestsThisWeek.toLocaleString()}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="progress-fill h-full bg-sky-500 rounded-full w-full" />
              </div>
            </div>
          </div>
        </Surface>
      </div>

      <Surface>
        <div className="px-5 py-4 border-b border-border/80 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Inventory by provider</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Top sources by listing count</p>
          </div>
          <Link href="/providers" className="text-xs font-medium text-primary inline-flex items-center gap-1 hover:underline">
            All providers <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/80">
                <th className="px-5 py-2.5 font-semibold">Provider</th>
                <th className="px-3 py-2.5 font-semibold">Country</th>
                <th className="px-3 py-2.5 font-semibold">Type</th>
                <th className="px-3 py-2.5 font-semibold text-right">Listings</th>
                <th className="px-5 py-2.5 font-semibold text-right">VINs</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => {
                const meta = countryMeta(p.country);
                return (
                  <tr key={p.id} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-2.5">
                      <Link href={`/providers/${p.id}`} className="font-medium hover:text-primary">
                        {p.name}
                      </Link>
                      {!p.enabled && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">off</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="mr-1">{meta.flag}</span>
                      {meta.name}
                    </td>
                    <td className="px-3 py-2.5 capitalize text-muted-foreground">{p.type}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{p.listings.toLocaleString()}</td>
                    <td className="px-5 py-2.5 text-right font-mono tabular-nums">{p.vehicles.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Surface>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <QuickLink href="/jobs" icon={TerminalSquare} title="Run a collection" subtitle="Queue a crawl with the right extractor" />
        <QuickLink href="/vehicles" icon={Search} title="Browse vehicles" subtitle="Filter by provider, brand, country" />
        <QuickLink href="/live-feeds" icon={Radio} title="Live feeds" subtitle="Inspect current marketplace inventory" />
      </div>
    </PageEnter>
  );
}

function JobStat({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card px-2 py-2.5 sm:px-3 sm:py-3 flex flex-col items-center justify-center text-center gap-1">
      <Icon className={cn("w-3.5 h-3.5 sm:w-4 sm:h-4", color)} />
      <div className="text-base sm:text-lg font-mono font-semibold tabular-nums leading-none">{value}</div>
      <div className="text-[9px] sm:text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.1em]">
        {label}
      </div>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  title,
  subtitle,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-border/80 bg-card px-4 py-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_12px_28px_-18px_rgba(37,99,235,0.45)]"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/8 text-primary">
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  );
}
