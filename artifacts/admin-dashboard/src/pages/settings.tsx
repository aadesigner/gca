import React, { useState } from "react";
import {
  useGetSettings,
  useUpdateSettings,
  getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Save, Settings2, Database, Shield, KeyRound, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="p-4 border-b border-border bg-muted/20 flex items-center gap-2">
        <Icon className="w-5 h-5 text-muted-foreground" />
        <h2 className="font-semibold text-foreground">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const updateMutation = useUpdateSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<any>(null);
  const [tab, setTab] = useState("collection");

  React.useEffect(() => {
    if (settings && !formData) {
      setFormData({ ...settings });
    }
  }, [settings]);

  if (isLoading || !formData) {
    return (
      <div className="p-8 text-center font-mono text-muted-foreground animate-pulse">
        LOADING_CONFIGURATION...
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(
      {
        data: {
          defaultRateLimit: formData.defaultRateLimit,
          maxCollectionJobsParallel: formData.maxCollectionJobsParallel,
          vinExtractionEnabled: formData.vinExtractionEnabled,
          photoStorageEnabled: formData.photoStorageEnabled,
          rawDataRetentionDays: formData.rawDataRetentionDays,
          defaultMaxPages: formData.defaultMaxPages,
          defaultMaxListings: formData.defaultMaxListings,
          defaultDelayMs: formData.defaultDelayMs,
          creditPriceUsd: Number(formData.creditPriceUsd) || 2,
          minCryptoDepositUsd: Number(formData.minCryptoDepositUsd) || 40,
          cryptoPaymentInstructions: formData.cryptoPaymentInstructions || null,
          recaptchaEnabled: Boolean(formData.recaptchaEnabled),
          recaptchaSiteKey: formData.recaptchaSiteKey || null,
          recaptchaSecretKey: formData.recaptchaSecretKey || undefined,
          clearRecaptchaSecret: Boolean(formData.clearRecaptchaSecret),
          recaptchaMinScore: Number(formData.recaptchaMinScore) || 0.5,
          registrationEnabled: formData.registrationEnabled !== false,
          clientLoginEnabled: formData.clientLoginEnabled !== false,
          demoStartingCredits: Math.max(0, parseInt(String(formData.demoStartingCredits ?? 0), 10) || 0),
          apiVinRetrieveEnabled: formData.apiVinRetrieveEnabled !== false,
          apiVinCheckEnabled: formData.apiVinCheckEnabled !== false,
          apiLiveEnabled: formData.apiLiveEnabled !== false,
          liveFeedContactEmail: formData.liveFeedContactEmail?.trim() || "info@getcarapi.com",
        } as any,
      },
      {
        onSuccess: (data: any) => {
          toast({ title: "Global settings updated" });
          setFormData({ ...data, recaptchaSecretKey: "", clearRecaptchaSecret: false });
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
      },
    );
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">System Configuration</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Global parameters for collection, public API, billing, and security.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/40 p-1">
            <TabsTrigger value="collection" className="gap-1.5 px-3 py-2">
              <Settings2 className="w-3.5 h-3.5" />
              Collection
            </TabsTrigger>
            <TabsTrigger value="api" className="gap-1.5 px-3 py-2">
              <KeyRound className="w-3.5 h-3.5" />
              Public API
            </TabsTrigger>
            <TabsTrigger value="billing" className="gap-1.5 px-3 py-2">
              <CreditCard className="w-3.5 h-3.5" />
              Billing
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-1.5 px-3 py-2">
              <Shield className="w-3.5 h-3.5" />
              Security
            </TabsTrigger>
          </TabsList>

          <TabsContent value="collection" className="space-y-6 mt-0">
            <SectionCard icon={Settings2} title="Collection Engine">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Parallel Job Concurrency
                  </label>
                  <Input
                    type="number"
                    min="0"
                    value={formData.maxCollectionJobsParallel ?? 0}
                    onChange={(e) =>
                      setFormData({ ...formData, maxCollectionJobsParallel: parseInt(e.target.value) || 0 })
                    }
                    className="max-w-[200px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    Max concurrent collection jobs. Use 0 for unlimited (all active jobs run in parallel).
                  </p>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <label className="text-sm font-semibold text-foreground">VIN Extraction Engine</label>
                      <p className="text-xs text-muted-foreground">
                        Extract VINs during collection. Listings without a VIN are not saved to history.
                      </p>
                    </div>
                    <Switch
                      checked={formData.vinExtractionEnabled}
                      onCheckedChange={(c) => setFormData({ ...formData, vinExtractionEnabled: c })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <label className="text-sm font-semibold text-foreground">Cloudflare photo mirror</label>
                      <p className="text-xs text-muted-foreground">
                        When R2 is configured, new VIN photos auto-upload to imgsv. This toggle is reserved for future use.
                      </p>
                    </div>
                    <Switch
                      checked={formData.photoStorageEnabled}
                      onCheckedChange={(c) => setFormData({ ...formData, photoStorageEnabled: c })}
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard icon={Settings2} title="Collection Limits">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Max Pages per Job
                  </label>
                  <Input
                    type="number"
                    min="1"
                    max="2000"
                    value={formData.defaultMaxPages ?? 200}
                    onChange={(e) =>
                      setFormData({ ...formData, defaultMaxPages: parseInt(e.target.value) || 200 })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    How many search result pages to crawl per collection run. Each page ≈ 12–15 cars.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Max Listings per Job
                  </label>
                  <Input
                    type="number"
                    min="1"
                    max="50000"
                    value={formData.defaultMaxListings ?? 5000}
                    onChange={(e) =>
                      setFormData({ ...formData, defaultMaxListings: parseInt(e.target.value) || 5000 })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Hard cap on individual listings fetched and parsed per job.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Delay Between Requests (ms)
                  </label>
                  <Input
                    type="number"
                    min="500"
                    max="30000"
                    step="500"
                    value={formData.defaultDelayMs ?? 2000}
                    onChange={(e) =>
                      setFormData({ ...formData, defaultDelayMs: parseInt(e.target.value) || 2000 })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Pause between fetching each listing. Increase to avoid rate-limiting by Encar.
                  </p>
                </div>
              </div>
            </SectionCard>

            <SectionCard icon={Database} title="Storage Policy">
              <div className="space-y-2 max-w-[300px]">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Raw Data Retention (Days)
                </label>
                <Input
                  type="number"
                  min="1"
                  value={formData.rawDataRetentionDays || 30}
                  onChange={(e) =>
                    setFormData({ ...formData, rawDataRetentionDays: parseInt(e.target.value) || 30 })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Unstructured JSON payloads will be deleted after this period to save cost.
                </p>
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="api" className="space-y-6 mt-0">
            <SectionCard icon={KeyRound} title="Public API">
              <div className="space-y-5">
                <p className="text-xs text-muted-foreground">
                  Global switches for token clients. When off, requests get{" "}
                  <span className="font-mono">503 API_FEATURE_DISABLED</span> — no credits are charged.
                </p>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <label className="text-sm font-semibold text-foreground">VIN retrieve</label>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">GET /api/v1/vin/{"{vin}"}</span> — billed history. Off = error, zero
                      credits used.
                    </p>
                  </div>
                  <Switch
                    checked={formData.apiVinRetrieveEnabled !== false}
                    onCheckedChange={(c) => setFormData({ ...formData, apiVinRetrieveEnabled: c })}
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <label className="text-sm font-semibold text-foreground">VIN check</label>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">GET /api/v1/vin/check/{"{vin}"}</span> — Bearer required, free (no credit).
                    </p>
                  </div>
                  <Switch
                    checked={formData.apiVinCheckEnabled !== false}
                    onCheckedChange={(c) => setFormData({ ...formData, apiVinCheckEnabled: c })}
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <label className="text-sm font-semibold text-foreground">Live feeds</label>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">GET /api/v1/live/*</span> — Encar / Autowini / KB inventory.
                      Per-client live access is still required (API Clients).
                    </p>
                  </div>
                  <Switch
                    checked={formData.apiLiveEnabled !== false}
                    onCheckedChange={(c) => setFormData({ ...formData, apiLiveEnabled: c })}
                  />
                </div>
                <div className="space-y-2 pt-2 border-t border-border">
                  <label className="text-sm font-semibold text-foreground">Live feed contact email</label>
                  <p className="text-xs text-muted-foreground">
                    Shown to clients when live is disabled — pricing, providers, details.
                  </p>
                  <Input
                    type="email"
                    className="max-w-md"
                    value={formData.liveFeedContactEmail ?? "info@getcarapi.com"}
                    onChange={(e) => setFormData({ ...formData, liveFeedContactEmail: e.target.value })}
                    placeholder="info@getcarapi.com"
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard icon={Shield} title="API Gateway Defaults">
              <div className="space-y-2 max-w-[300px]">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Default Rate Limit (req/min)
                </label>
                <Input
                  type="number"
                  min="1"
                  value={formData.defaultRateLimit || 60}
                  onChange={(e) =>
                    setFormData({ ...formData, defaultRateLimit: parseInt(e.target.value) || 60 })
                  }
                />
                <p className="text-xs text-muted-foreground">Applied to new API clients unless overridden.</p>
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="billing" className="space-y-6 mt-0">
            <SectionCard icon={CreditCard} title="Billing & registration">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Credit price (USD)
                  </label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={formData.creditPriceUsd ?? 2}
                    onChange={(e) => setFormData({ ...formData, creditPriceUsd: e.target.value })}
                    className="max-w-[200px]"
                  />
                  <p className="text-xs text-muted-foreground">1 VIN retrieve = 1 credit. Shown in the client billing area.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Min crypto deposit (USD)
                  </label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={formData.minCryptoDepositUsd ?? 40}
                    onChange={(e) => setFormData({ ...formData, minCryptoDepositUsd: e.target.value })}
                    className="max-w-[200px]"
                  />
                  <p className="text-xs text-muted-foreground">Minimum USDT top-up amount in the client portal.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Demo starting credits
                  </label>
                  <Input
                    type="number"
                    min="0"
                    value={formData.demoStartingCredits ?? 0}
                    onChange={(e) =>
                      setFormData({ ...formData, demoStartingCredits: parseInt(e.target.value) || 0 })
                    }
                    className="max-w-[200px]"
                  />
                  <p className="text-xs text-muted-foreground">Granted on self-registration (usually 0).</p>
                </div>
                <div className="flex items-center justify-between md:col-span-2 gap-4">
                  <div>
                    <label className="text-sm font-semibold text-foreground">Allow client portal sign-in</label>
                    <p className="text-xs text-muted-foreground">
                      When off, /account/ shows a contact message instead of the login form. Existing sessions are
                      unaffected until they expire.
                    </p>
                  </div>
                  <Switch
                    checked={formData.clientLoginEnabled !== false}
                    onCheckedChange={(c) => setFormData({ ...formData, clientLoginEnabled: c })}
                  />
                </div>
                <div className="flex items-center justify-between md:col-span-2 gap-4">
                  <div>
                    <label className="text-sm font-semibold text-foreground">Allow self-registration</label>
                    <p className="text-xs text-muted-foreground">
                      When on, visitors can create accounts at /account/?register=1 with email, Telegram, website, and
                      password. When off, they see a contact email instead.
                    </p>
                  </div>
                  <Switch
                    checked={formData.registrationEnabled !== false}
                    onCheckedChange={(c) => setFormData({ ...formData, registrationEnabled: c })}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Crypto payment instructions
                  </label>
                  <textarea
                    className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={formData.cryptoPaymentInstructions ?? ""}
                    onChange={(e) => setFormData({ ...formData, cryptoPaymentInstructions: e.target.value })}
                    placeholder="USDT (TRC20) wallet: …&#10;Include your account email in the memo."
                  />
                  <p className="text-xs text-muted-foreground">
                    Shown in the client area when buying credits. You approve payments manually under Credit
                    purchases.
                  </p>
                </div>
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="security" className="space-y-6 mt-0">
            <SectionCard icon={Shield} title="reCAPTCHA v3">
              <div className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <label className="text-sm font-semibold text-foreground">Enable on client login / register</label>
                    <p className="text-xs text-muted-foreground">
                      Runs after form submit so mobile password autofill still works.
                    </p>
                  </div>
                  <Switch
                    checked={Boolean(formData.recaptchaEnabled)}
                    onCheckedChange={(c) => setFormData({ ...formData, recaptchaEnabled: c })}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Site key
                    </label>
                    <Input
                      value={formData.recaptchaSiteKey ?? ""}
                      onChange={(e) => setFormData({ ...formData, recaptchaSiteKey: e.target.value })}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Secret key {formData.recaptchaSecretConfigured ? "(configured — leave blank to keep)" : ""}
                    </label>
                    <Input
                      type="password"
                      value={formData.recaptchaSecretKey ?? ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          recaptchaSecretKey: e.target.value,
                          clearRecaptchaSecret: false,
                        })
                      }
                      autoComplete="new-password"
                      placeholder={formData.recaptchaSecretConfigured ? "••••••••" : ""}
                    />
                    {formData.recaptchaSecretConfigured && (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={Boolean(formData.clearRecaptchaSecret)}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              clearRecaptchaSecret: e.target.checked,
                              recaptchaSecretKey: "",
                            })
                          }
                        />
                        Clear stored secret
                      </label>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Minimum score (0–1)
                    </label>
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={formData.recaptchaMinScore ?? 0.5}
                      onChange={(e) => setFormData({ ...formData, recaptchaMinScore: e.target.value })}
                      className="max-w-[160px]"
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end sticky bottom-4 z-10">
          <Button
            type="submit"
            size="lg"
            disabled={updateMutation.isPending}
            className="font-semibold tracking-wide px-8 shadow-lg"
          >
            <Save className="w-4 h-4 mr-2" />
            SAVE CONFIGURATION
          </Button>
        </div>
      </form>
    </div>
  );
}
