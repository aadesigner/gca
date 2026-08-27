import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAdminLogin } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { getAdminRecaptchaToken } from "@/lib/recaptcha";

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaSiteKey, setCaptchaSiteKey] = useState<string | null>(null);
  const { toast } = useToast();

  const loginMutation = useAdminLogin();

  useEffect(() => {
    fetch("/api/admin/auth/captcha-config", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => {
        if (cfg?.enabled && cfg.siteKey) setCaptchaSiteKey(cfg.siteKey);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void (async () => {
      try {
        const recaptchaToken = await getAdminRecaptchaToken(captchaSiteKey);
        loginMutation.mutate(
          {
            data: { email, password, recaptchaToken } as { email: string; password: string },
          },
          {
            onSuccess: () => {
              setLocation("/dashboard");
            },
            onError: (error) => {
              toast({
                title: "Login Failed",
                description: error.message || "Invalid credentials",
                variant: "destructive",
              });
            },
          },
        );
      } catch (err) {
        toast({
          title: "Login Failed",
          description: err instanceof Error ? err.message : "reCAPTCHA verification failed",
          variant: "destructive",
        });
      }
    })();
  };

  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-background flex">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,hsl(225_100%_45%/0.12),transparent_50%),radial-gradient(ellipse_at_bottom_right,hsl(210_100%_50%/0.08),transparent_45%)]" />
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl animate-pulse" />

      <div className="relative hidden lg:flex w-[46%] flex-col justify-between p-10 xl:p-14 text-primary-foreground overflow-hidden bg-primary">
        <Logo variant="inverse" textClassName="text-[1.65rem]" />
        <div className="max-w-md animate-in fade-in slide-in-from-left-4 duration-700">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70 mb-3">Operator console</p>
          <h1 className="text-4xl font-semibold tracking-tight leading-tight">Korean live stock. Auction history. One key.</h1>
          <p className="mt-4 text-white/80 text-sm leading-relaxed">
            Issue a <span className="font-mono">vdi_</span> token. Clients pull Encar, Autowini and KB inventory with their
            own markup, and retrieve VIN auction history from Korea, the US and Canada.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/85">
            <li className="rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm">GET /api/v1/live/vehicles — live Korea</li>
            <li className="rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm">GET /api/v1/vin/{"{vin}"} — 1 credit on 200</li>
            <li className="rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm">Marketing demo key — live playground only</li>
          </ul>
        </div>
        <p className="text-xs text-white/55">GetCarAPI · internal</p>
      </div>

      <div className="relative flex flex-1 items-center justify-center p-4 sm:p-8 safe-top safe-bottom safe-x">
        <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-3 duration-500">
          <div className="flex flex-col items-center mb-8 lg:items-start">
            <div className="lg:hidden mb-4">
              <Logo textClassName="text-[1.2rem]" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground mt-1">Operator email and password</p>
          </div>

          <div className="bg-card/90 backdrop-blur-sm border border-border/80 rounded-2xl shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] overflow-hidden">
            <div className="p-5 sm:p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</label>
                  <Input
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="text-base sm:text-sm h-12 sm:h-10"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Password</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="text-base sm:text-sm h-12 sm:h-10"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full h-12 sm:h-10 font-semibold tracking-wide text-base sm:text-sm"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Sign in
                </Button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
