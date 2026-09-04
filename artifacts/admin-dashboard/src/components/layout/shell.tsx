import React from "react";
import { Link, useLocation } from "wouter";
import { useAdminGetMe, useAdminLogout, getAdminGetMeQueryKey } from "@workspace/api-client-react";
import {
  Activity,
  BarChart3,
  Car,
  CheckSquare,
  ChevronDown,
  Database,
  Key,
  LayoutDashboard,
  LifeBuoy,
  List,
  LogOut,
  Menu,
  Radio,
  Search,
  Settings,
  ShieldAlert,
  TerminalSquare,
  FlaskConical,
  Users,
  Wallet,
  Zap,
  Layers,
  UserCircle,
  Code2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { AdminNotificationBell } from "@/components/layout/admin-notification-bell";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type NavLeaf = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

type NavGroup = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavLeaf[];
};

type NavSection = {
  title: string;
  description?: string;
  items: NavLeaf[];
  /** Collapsible mini-groups (shown as one row until expanded). */
  groups?: NavGroup[];
};

/** Sidebar navigation — primary items + nested groups to keep mobile short. */
const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Client portal",
    description: "Matches /account/ tabs",
    items: [
      { href: "/client-portal", label: "Portal hub", icon: UserCircle },
      { href: "/api-clients", label: "Portal accounts", icon: Users },
      { href: "/support-tickets", label: "Support tickets", icon: LifeBuoy },
      { href: "/credit-purchases", label: "Credit purchases", icon: Wallet },
    ],
    groups: [
      {
        id: "apis",
        label: "APIs",
        icon: Code2,
        items: [
          { href: "/api-tokens", label: "API tokens", icon: Key },
          { href: "/api-usage", label: "API usage", icon: BarChart3 },
          { href: "/api-logs", label: "API logs", icon: Activity },
          { href: "/vin-api-test", label: "VIN API test", icon: FlaskConical },
        ],
      },
    ],
  },
  {
    title: "Data pipeline",
    items: [
      { href: "/providers", label: "Providers", icon: Database },
      { href: "/live-feeds", label: "Live feeds", icon: Radio },
    ],
    groups: [
      {
        id: "ops",
        label: "Collectors & jobs",
        icon: TerminalSquare,
        items: [
          { href: "/collectors", label: "Collectors", icon: Layers },
          { href: "/jobs", label: "Jobs", icon: TerminalSquare },
        ],
      },
    ],
  },
  {
    title: "Inventory",
    items: [
      { href: "/vehicles", label: "Vehicles", icon: Car },
      { href: "/listings", label: "Listings", icon: List },
      { href: "/vin-search", label: "VIN search", icon: Search },
    ],
  },
  {
    title: "System",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
    groups: [
      {
        id: "system-more",
        label: "Raw data & quality",
        icon: ShieldAlert,
        items: [
          { href: "/raw-data", label: "Raw data", icon: Database },
          { href: "/audit-logs", label: "Audit logs", icon: ShieldAlert },
          { href: "/observability", label: "Observability", icon: Zap },
          { href: "/normalization", label: "Data quality", icon: CheckSquare },
        ],
      },
    ],
  },
];

const ALL_NAV: NavLeaf[] = NAV_SECTIONS.flatMap((s) => [
  ...s.items,
  ...(s.groups?.flatMap((g) => g.items) ?? []),
]);

function pathActive(location: string, href: string) {
  return location === href || (href !== "/dashboard" && location.startsWith(href));
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const { data: user, error, isLoading } = useAdminGetMe({
    query: {
      retry: false,
      queryKey: getAdminGetMeQueryKey(),
    },
  });

  const logoutMutation = useAdminLogout();
  const currentPage = ALL_NAV.find((i) => pathActive(location, i.href))?.label ?? "Admin";

  React.useEffect(() => {
    if (error) setLocation("/login");
  }, [error, setLocation]);

  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [location]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-xl bg-primary/15 animate-pulse" />
          <div className="text-muted-foreground text-sm">Loading GetCarAPI…</div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => setLocation("/login"),
    });
  };

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      <aside className="hidden md:flex w-[16.5rem] shrink-0 flex-col border-r border-border/80 bg-sidebar min-h-0">
        <div className="h-16 flex items-center px-4 border-b border-border/80 shrink-0">
          <Logo textClassName="text-xl" />
        </div>
        <div className="flex-1 overflow-y-auto py-4 px-3">
          <SidebarNav location={location} />
        </div>
        <SidebarFooter user={user} onLogout={handleLogout} />
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[min(100vw-3rem,300px)] p-0 flex flex-col safe-top safe-bottom">
          <SheetHeader className="px-4 py-3.5 border-b border-border text-left">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Logo textClassName="text-xl" />
          </SheetHeader>
          <div className="flex-1 overflow-y-auto py-2.5 px-2">
            <SidebarNav location={location} onNavigate={() => setMobileNavOpen(false)} mobile />
          </div>
          <SidebarFooter user={user} onLogout={handleLogout} className="border-t border-border" />
        </SheetContent>
      </Sheet>

      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="shrink-0 z-10 border-b border-border/80 bg-card/70 backdrop-blur-md safe-top md:pt-0">
          <div className="h-12 sm:h-14 flex items-center justify-between gap-2 px-3 sm:px-4 md:px-8">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="md:hidden touch-target inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="md:hidden">
                <Logo textClassName="text-lg" />
              </div>
              <div className="hidden md:block">
                <h1 className="text-sm font-medium text-foreground">{currentPage}</h1>
              </div>
              <div className="md:hidden min-w-0">
                <h1 className="text-sm font-medium truncate">{currentPage}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <AdminNotificationBell />
              <div className="hidden md:flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-2.5 py-1">
                <span className="status-dot" />
                <span className="text-[11px] font-medium text-muted-foreground">Live</span>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="md:hidden touch-target inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                aria-label="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4 md:p-8">
          <div className="mx-auto max-w-[1440px] w-full">{children}</div>
        </div>
      </main>
    </div>
  );
}

function SidebarNav({
  location,
  onNavigate,
  mobile,
}: {
  location: string;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const initiallyOpen = React.useMemo(() => {
    const ids = new Set<string>();
    for (const section of NAV_SECTIONS) {
      for (const group of section.groups ?? []) {
        if (group.items.some((item) => pathActive(location, item.href))) {
          ids.add(group.id);
        }
      }
    }
    return ids;
  }, [location]);

  const [openGroups, setOpenGroups] = React.useState<Set<string>>(initiallyOpen);

  React.useEffect(() => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      for (const id of initiallyOpen) next.add(id);
      return next;
    });
  }, [initiallyOpen]);

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className={cn("mb-4", mobile && "mb-3.5")}>
          <div className="px-2.5 mb-1.5">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.16em]">
              {section.title}
            </div>
            {!mobile && section.description ? (
              <div className="text-[10px] text-muted-foreground/70 mt-0.5 leading-snug">{section.description}</div>
            ) : null}
          </div>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <NavItem
                key={item.href}
                {...item}
                active={pathActive(location, item.href)}
                onNavigate={onNavigate}
                mobile={mobile}
              />
            ))}
            {(section.groups ?? []).map((group) => {
              const isOpen = openGroups.has(group.id);
              const groupActive = group.items.some((item) => pathActive(location, item.href));
              const GroupIcon = group.icon;
              return (
                <div key={group.id} className="mt-0.5">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                      mobile ? "py-3 min-h-[44px]" : "py-2",
                      groupActive && !isOpen
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                    aria-expanded={isOpen}
                  >
                    <GroupIcon className="w-4 h-4 shrink-0" />
                    <span className="flex-1 text-left">{group.label}</span>
                    <span
                      className={cn(
                        "text-[10px] font-semibold tabular-nums rounded-md px-1.5 py-0.5",
                        groupActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {group.items.length}
                    </span>
                    <ChevronDown
                      className={cn(
                        "w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                        isOpen && "rotate-180",
                      )}
                    />
                  </button>
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-200 ease-out",
                      isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                    )}
                  >
                    <div className="overflow-hidden min-h-0">
                      <div className="mt-0.5 ml-2 pl-2 border-l border-border/70 flex flex-col gap-0.5">
                        {group.items.map((item) => (
                          <NavItem
                            key={item.href}
                            {...item}
                            active={pathActive(location, item.href)}
                            onNavigate={onNavigate}
                            mobile={mobile}
                            nested
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

function SidebarFooter({
  user,
  onLogout,
  className,
}: {
  user: { name: string; email: string };
  onLogout: () => void;
  className?: string;
}) {
  return (
    <div className={cn("p-4 border-t border-border/80 shrink-0", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col overflow-hidden min-w-0">
          <span className="text-sm font-medium truncate">{user.name}</span>
          <span className="text-xs text-muted-foreground truncate">{user.email}</span>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center justify-center p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors shrink-0"
          title="Logout"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
  mobile,
  nested,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onNavigate?: () => void;
  mobile?: boolean;
  nested?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-200",
        nested ? "px-2.5" : "px-2.5",
        mobile ? "py-3 min-h-[44px]" : nested ? "py-1.5" : "py-2",
        active
          ? "bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_rgba(37,99,235,0.9)]"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className={cn("shrink-0", nested ? "w-3.5 h-3.5" : "w-4 h-4")} />
      <span className={cn(nested && "text-[13px]")}>{label}</span>
    </Link>
  );
}
