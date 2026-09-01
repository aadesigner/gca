import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type BanPreview = {
  ipCount: number;
  deviceCount: number;
  hasEmail: boolean;
  email: string | null;
};

async function adminApi(path: string, init?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export function DeleteClientDialog({
  clientId,
  clientName,
  open,
  onOpenChange,
  onDeleted,
}: {
  clientId: number;
  clientName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const { toast } = useToast();
  const [banIp, setBanIp] = React.useState(true);
  const [banDevice, setBanDevice] = React.useState(true);
  const [banEmail, setBanEmail] = React.useState(true);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ["ban-preview", clientId],
    queryFn: () => adminApi(`/admin/api-clients/${clientId}/ban-preview`) as Promise<BanPreview>,
    enabled: open && Number.isFinite(clientId) && clientId > 0,
  });

  React.useEffect(() => {
    if (!open) {
      setBanIp(true);
      setBanDevice(true);
      setBanEmail(true);
      setReason("");
      setBusy(false);
    }
  }, [open]);

  const deleteClient = async () => {
    setBusy(true);
    try {
      await adminApi(`/admin/api-clients/${clientId}`, {
        method: "DELETE",
        body: JSON.stringify({
          banIp: banIp && (preview?.ipCount ?? 0) > 0,
          banDevice: banDevice && (preview?.deviceCount ?? 0) > 0,
          banEmail: banEmail && preview?.hasEmail,
          reason: reason.trim() || undefined,
        }),
      });
      toast({ title: "Client deleted", description: banSummary() || undefined });
      onOpenChange(false);
      onDeleted?.();
    } catch (err) {
      toast({
        title: "Delete failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const banSummary = () => {
    const parts: string[] = [];
    if (banIp && (preview?.ipCount ?? 0) > 0) parts.push(`${preview!.ipCount} IP(s)`);
    if (banDevice && (preview?.deviceCount ?? 0) > 0) parts.push(`${preview!.deviceCount} device(s)`);
    if (banEmail && preview?.hasEmail) parts.push("email");
    if (!parts.length) return "";
    return `Blocked: ${parts.join(", ")}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete client</DialogTitle>
          <DialogDescription>
            Permanently remove <span className="font-medium text-foreground">{clientName}</span>, all tokens, and
            request logs. Optionally block re-registration from known IPs and devices.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {previewLoading ? (
            <p className="text-sm text-muted-foreground">Loading ban targets…</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Known from portal logins and API logs:{" "}
              <span className="font-mono">{preview?.ipCount ?? 0}</span> IP(s),{" "}
              <span className="font-mono">{preview?.deviceCount ?? 0}</span> device(s)
              {preview?.hasEmail ? (
                <>
                  , email <span className="font-mono">{preview?.email}</span>
                </>
              ) : (
                ", no portal email"
              )}
              .
            </p>
          )}

          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Block on delete</p>
            <div className="flex items-start gap-2">
              <Checkbox
                id="ban-ip"
                checked={banIp}
                disabled={!preview?.ipCount}
                onCheckedChange={(v) => setBanIp(Boolean(v))}
              />
              <Label htmlFor="ban-ip" className="text-sm leading-snug cursor-pointer">
                Ban IP address(es)
                {!preview?.ipCount && (
                  <span className="block text-xs text-muted-foreground font-normal">None recorded</span>
                )}
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="ban-device"
                checked={banDevice}
                disabled={!preview?.deviceCount}
                onCheckedChange={(v) => setBanDevice(Boolean(v))}
              />
              <Label htmlFor="ban-device" className="text-sm leading-snug cursor-pointer">
                Ban device ID(s)
                {!preview?.deviceCount && (
                  <span className="block text-xs text-muted-foreground font-normal">
                    None recorded (client must sign in once with a browser)
                  </span>
                )}
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="ban-email"
                checked={banEmail}
                disabled={!preview?.hasEmail}
                onCheckedChange={(v) => setBanEmail(Boolean(v))}
              />
              <Label htmlFor="ban-email" className="text-sm leading-snug cursor-pointer">
                Ban email from new registrations
              </Label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ban-reason" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Reason (optional)
            </Label>
            <Input
              id="ban-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Abuse, chargeback, duplicate account…"
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={deleteClient} disabled={busy || previewLoading}>
            {busy ? "Deleting…" : "Delete client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
