import React from "react";
import { Link, useLocation } from "wouter";
import { useAdminGetMe, useAdminLogout, getAdminGetMeQueryKey } from "@workspace/api-client-react";
import {
  Car,
  CheckSquare,
  Database,
  Key,
  LayoutDashboard,
  List,
  LogOut,
  Menu,
  Radio,
  Search,
  Settings,
  ShieldAlert,
  TerminalSquare,
  Users,
  Zap,
  Activity,
  Wallet,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { AccessRequestBell } from "@/components/layout/access-request-bell";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const NAV_SECTIONS = [
  {
    title: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/jobs", label: "Jobs", icon: TerminalSquare },
      { href: "/vehicles", label: "Vehicles", icon: Car },
      { href: "/vin-search", label: "VIN Search", icon: Search },
      { href: "/listings", label: "Listings", icon: List },
    ],
  },
  {
    title: "Sources",
    items: [
      { href: "/providers", label: "Providers", icon: Database },
      { href: "/live-feeds", label: "Live Feeds", icon: Radio },
    ],
  },
  {
    title: "Quality",
    items: [
      { href: "/observability", label: "Observability", icon: Zap },
      { href: "/normalization", label: "Data Quality", icon: CheckSquare },
    ],
  },
  {
    title: "Platform",
    items: [
      { href: "/api-clients", label: "API Clients", icon: Users },
      { href: "/api-tokens", label: "API Tokens", icon: Key },
      { href: "/api-logs", label: "API Logs", icon: Activity },
      { href: "/credit-purchases", label: "Credit purchases", icon: Wallet },
      { href: "/access-requests", label: "Access requests", icon: Inbox },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/raw-data", label: "Raw Data", icon: Database },
      { href: "/audit-logs", label: "Audit Logs", icon: ShieldAlert },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
] as const;

const ALL_NAV = NAV_SECTIONS.flatMap((s) => s.items);

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
  const currentPage = ALL_NAV.find((i) => location.startsWith(i.href))?.label ?? "Admin";

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
        <SheetContent side="left" className="w-[min(100vw-3rem,320px)] p-0 flex flex-col safe-top safe-bottom">
          <SheetHeader className="px-4 py-4 border-b border-border text-left">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Logo textClassName="text-xl" />
          </SheetHeader>
          <div className="flex-1 overflow-y-auto py-3 px-2">
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
              <AccessRequestBell />
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
  return (
    <>
      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className="mb-5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.16em] mb-2 px-2.5">
            {section.title}
          </div>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <NavItem
                key={item.href}
                {...item}
                active={location.startsWith(item.href)}
                onNavigate={onNavigate}
                mobile={mobile}
              />
            ))}
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
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 px-2.5 rounded-xl text-sm font-medium transition-all duration-200",
        mobile ? "py-3 min-h-[44px]" : "py-2",
        active
          ? "bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_rgba(37,99,235,0.9)]"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </Link>
  );
}
