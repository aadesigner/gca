import React from "react";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { Shell } from "@/components/layout/shell";

import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Providers from "@/pages/providers";
import ProviderDetail from "@/pages/providers/id";
import Collectors from "@/pages/collectors";
import Jobs from "@/pages/jobs";
import Vehicles from "@/pages/vehicles";
import VinSearch from "@/pages/vin-search";
import Listings from "@/pages/listings";
import ApiClients from "@/pages/api-clients";
import ApiClientDetail from "@/pages/api-clients/id";
import ApiTokens from "@/pages/api-tokens";
import ApiLogs from "@/pages/api-logs";
import ApiUsage from "@/pages/api-usage";
import CreditPurchases from "@/pages/credit-purchases";
import ClientPortalHub from "@/pages/client-portal";
import SupportTickets from "@/pages/support-tickets";
import RawData from "@/pages/raw-data";
import AuditLogs from "@/pages/audit-logs";
import Settings from "@/pages/settings";
import LiveFeeds from "@/pages/live-feeds";
import LiveFeedTestPage from "@/pages/live-feeds/test";
import LiveFeedVehiclePage from "@/pages/live-feeds/vehicle";
import Observability from "@/pages/observability";
import Normalization from "@/pages/normalization";

import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AuthenticatedApp() {
  const [location] = useLocation();
  const pathname = location.split("?")[0] ?? location;

  // Standalone live-feed sandbox (no admin sidebar)
  if (/^\/live-feeds\/(all|combined|\d+)\/test(\/[^/]+)?\/?$/.test(pathname)) {
    return (
      <Switch>
        <Route path="/live-feeds/:id/test/:listingId" component={LiveFeedVehiclePage} />
        <Route path="/live-feeds/:id/test" component={LiveFeedTestPage} />
      </Switch>
    );
  }

  return (
    <Shell>
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/providers" component={Providers} />
        <Route path="/providers/:id" component={ProviderDetail} />
        <Route path="/collectors" component={Collectors} />
        <Route path="/jobs" component={Jobs} />
        <Route path="/vehicles" component={Vehicles} />
        <Route path="/vin-search" component={VinSearch} />
        <Route path="/listings" component={Listings} />
        <Route path="/observability" component={Observability} />
        <Route path="/normalization" component={Normalization} />
        <Route path="/client-portal" component={ClientPortalHub} />
        <Route path="/api-clients/:id" component={ApiClientDetail} />
        <Route path="/api-clients" component={ApiClients} />
        <Route path="/api-tokens" component={ApiTokens} />
        <Route path="/api-usage" component={ApiUsage} />
        <Route path="/api-logs" component={ApiLogs} />
        <Route path="/credit-purchases" component={CreditPurchases} />
        <Route path="/support-tickets" component={SupportTickets} />
        <Route path="/live-feeds/all/test" component={LiveFeedTestPage} />
        <Route path="/live-feeds/combined/test" component={LiveFeedTestPage} />
        <Route path="/live-feeds" component={LiveFeeds} />
        <Route path="/raw-data" component={RawData} />
        <Route path="/audit-logs" component={AuditLogs} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function Router() {
  const [location] = useLocation();
  
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={() => {
          const [, setLocation] = useLocation();
          React.useEffect(() => { setLocation("/dashboard"); }, []);
          return null;
        }} />
        <Route path="/login" component={Login} />
        {/* All other routes require auth shell */}
        <Route path="/.*" component={AuthenticatedApp} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
