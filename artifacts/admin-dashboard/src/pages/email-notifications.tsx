import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Save, Send, Eye, Server, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

type TemplateType =
  | "password_reset"
  | "support_staff_reply"
  | "support_new_ticket_admin"
  | "support_client_reply_admin"
  | "payment_approved";

const EVENTS: {
  type: TemplateType;
  enabledKey: string;
  subjectKey: string;
  bodyKey: string;
  label: string;
  description: string;
  placeholders: string[];
}[] = [
  {
    type: "password_reset",
    enabledKey: "emailPasswordResetEnabled",
    subjectKey: "emailTplPasswordResetSubject",
    bodyKey: "emailTplPasswordResetBody",
    label: "Password reset",
    description: "Client forgot-password link",
    placeholders: ["clientName", "clientEmail", "resetUrl", "siteUrl", "expiresMinutes"],
  },
  {
    type: "support_staff_reply",
    enabledKey: "emailSupportStaffReplyEnabled",
    subjectKey: "emailTplSupportStaffReplySubject",
    bodyKey: "emailTplSupportStaffReplyBody",
    label: "Support — staff reply",
    description: "Email client when staff replies",
    placeholders: [
      "clientName",
      "clientEmail",
      "ticketId",
      "ticketSubject",
      "ticketUrl",
      "replyPreview",
      "siteUrl",
    ],
  },
  {
    type: "support_new_ticket_admin",
    enabledKey: "emailSupportNewTicketAdminEnabled",
    subjectKey: "emailTplSupportNewTicketAdminSubject",
    bodyKey: "emailTplSupportNewTicketAdminBody",
    label: "Support — new ticket (staff)",
    description: "Email staff inbox when a client opens a ticket",
    placeholders: [
      "clientName",
      "clientEmail",
      "ticketId",
      "ticketSubject",
      "ticketCategory",
      "ticketUrl",
      "messagePreview",
      "siteUrl",
    ],
  },
  {
    type: "support_client_reply_admin",
    enabledKey: "emailSupportClientReplyAdminEnabled",
    subjectKey: "emailTplSupportClientReplyAdminSubject",
    bodyKey: "emailTplSupportClientReplyAdminBody",
    label: "Support — client reply (staff)",
    description: "Email staff inbox when a client replies",
    placeholders: [
      "clientName",
      "clientEmail",
      "ticketId",
      "ticketSubject",
      "ticketUrl",
      "replyPreview",
      "siteUrl",
    ],
  },
  {
    type: "payment_approved",
    enabledKey: "emailPaymentApprovedEnabled",
    subjectKey: "emailTplPaymentApprovedSubject",
    bodyKey: "emailTplPaymentApprovedBody",
    label: "Payment approved",
    description: "Email client when a credit purchase is approved",
    placeholders: [
      "clientName",
      "clientEmail",
      "credits",
      "amountUsd",
      "balanceAfter",
      "accountUrl",
      "siteUrl",
    ],
  },
];

type FormState = Record<string, unknown>;

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
      <div className="p-5 sm:p-6 space-y-4">{children}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
      {children}
    </label>
  );
}

export default function EmailNotifications() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [activeEvent, setActiveEvent] = useState<TemplateType>("password_reset");
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(
    null,
  );
  const [testTo, setTestTo] = useState("");
  const [clearSmtpPassword, setClearSmtpPassword] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["email-settings"],
    queryFn: () => api("/admin/email-settings"),
  });

  useEffect(() => {
    if (data && !form) {
      setForm({
        ...data,
        smtpPassword: "",
      });
      if (data.emailStaffInbox) setTestTo(String(data.emailStaffInbox));
      else if (data.smtpFromEmail) setTestTo(String(data.smtpFromEmail));
    }
  }, [data, form]);

  const eventMeta = useMemo(
    () => EVENTS.find((e) => e.type === activeEvent)!,
    [activeEvent],
  );

  const setField = (key: string, value: unknown) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api("/admin/email-settings", { method: "PUT", body: JSON.stringify(payload) }),
    onSuccess: (body) => {
      toast({ title: "Email settings saved" });
      setForm({ ...body, smtpPassword: "" });
      setClearSmtpPassword(false);
      qc.setQueryData(["email-settings"], body);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      api("/admin/email/preview", {
        method: "POST",
        body: JSON.stringify({
          type: activeEvent,
          subject: form?.[eventMeta.subjectKey],
          body: form?.[eventMeta.bodyKey],
        }),
      }),
    onSuccess: (body) => {
      setPreview({ subject: body.subject, html: body.html, text: body.text });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: (payload: { to: string; type: string }) =>
      api("/admin/email/test", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => toast({ title: "Test email sent" }),
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const payload: Record<string, unknown> = {
      smtpEnabled: Boolean(form.smtpEnabled),
      smtpHost: String(form.smtpHost || "").trim() || null,
      smtpPort: Number(form.smtpPort) || 587,
      smtpSecure: Boolean(form.smtpSecure),
      smtpUser: String(form.smtpUser || "").trim() || null,
      smtpFromName: String(form.smtpFromName || "").trim() || null,
      smtpFromEmail: String(form.smtpFromEmail || "").trim() || null,
      emailStaffInbox: String(form.emailStaffInbox || "").trim() || null,
      emailPublicBaseUrl: String(form.emailPublicBaseUrl || "").trim() || null,
      clearSmtpPassword,
      emailPasswordResetEnabled: Boolean(form.emailPasswordResetEnabled),
      emailSupportStaffReplyEnabled: Boolean(form.emailSupportStaffReplyEnabled),
      emailSupportNewTicketAdminEnabled: Boolean(form.emailSupportNewTicketAdminEnabled),
      emailSupportClientReplyAdminEnabled: Boolean(form.emailSupportClientReplyAdminEnabled),
      emailPaymentApprovedEnabled: Boolean(form.emailPaymentApprovedEnabled),
    };
    const pwd = String(form.smtpPassword || "");
    if (pwd) payload.smtpPassword = pwd;

    for (const ev of EVENTS) {
      payload[ev.subjectKey] = String(form[ev.subjectKey] ?? "");
      payload[ev.bodyKey] = String(form[ev.bodyKey] ?? "");
    }

    saveMutation.mutate(payload);
  };

  if (isLoading || !form) {
    return (
      <div className="p-8 text-center text-muted-foreground animate-pulse text-sm">
        Loading email settings…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm text-destructive">{(error as Error)?.message || "Failed to load"}</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-5 max-w-5xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email / Notifications</h1>
          <p className="text-muted-foreground text-sm mt-1">
            SMTP delivery, per-event templates, preview, and test send.
          </p>
        </div>
        <Button type="submit" disabled={saveMutation.isPending}>
          <Save className="w-4 h-4 mr-1.5" />
          {saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      <SectionCard icon={Server} title="SMTP">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Enable SMTP</p>
            <p className="text-xs text-muted-foreground">
              Master switch — no emails send while this is off.
              {form.smtpReady ? " · Ready" : " · Incomplete"}
            </p>
          </div>
          <Switch
            checked={Boolean(form.smtpEnabled)}
            onCheckedChange={(v) => setField("smtpEnabled", v)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FieldLabel>Host</FieldLabel>
            <Input
              value={String(form.smtpHost || "")}
              onChange={(e) => setField("smtpHost", e.target.value)}
              placeholder="smtp.example.com"
            />
          </div>
          <div>
            <FieldLabel>Port</FieldLabel>
            <Input
              type="number"
              value={Number(form.smtpPort || 587)}
              onChange={(e) => setField("smtpPort", Number(e.target.value))}
            />
          </div>
          <div className="flex items-end gap-3 pb-1">
            <label className="inline-flex items-center gap-2 text-sm">
              <Switch
                checked={Boolean(form.smtpSecure)}
                onCheckedChange={(v) => setField("smtpSecure", v)}
              />
              Secure / SSL (port 465 only — leave off for 587)
            </label>
          </div>
          <div>
            <FieldLabel>Username</FieldLabel>
            <Input
              value={String(form.smtpUser || "")}
              onChange={(e) => setField("smtpUser", e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <FieldLabel>Password</FieldLabel>
            <Input
              type="password"
              value={String(form.smtpPassword || "")}
              onChange={(e) => {
                setClearSmtpPassword(false);
                setField("smtpPassword", e.target.value);
              }}
              placeholder={form.smtpPasswordConfigured ? "•••••••• (leave blank to keep)" : ""}
              autoComplete="new-password"
            />
            {form.smtpPasswordConfigured ? (
              <label className="mt-1.5 inline-flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={clearSmtpPassword}
                  onChange={(e) => setClearSmtpPassword(e.target.checked)}
                />
                Clear saved password
              </label>
            ) : null}
          </div>
          <div>
            <FieldLabel>From name</FieldLabel>
            <Input
              value={String(form.smtpFromName || "")}
              onChange={(e) => setField("smtpFromName", e.target.value)}
              placeholder="GetCarAPI"
            />
          </div>
          <div>
            <FieldLabel>From email</FieldLabel>
            <Input
              type="email"
              value={String(form.smtpFromEmail || "")}
              onChange={(e) => setField("smtpFromEmail", e.target.value)}
              placeholder="noreply@getcarapi.com"
            />
          </div>
          <div>
            <FieldLabel>Staff inbox</FieldLabel>
            <Input
              type="email"
              value={String(form.emailStaffInbox || "")}
              onChange={(e) => setField("emailStaffInbox", e.target.value)}
              placeholder="support@getcarapi.com"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Receives new-ticket and client-reply alerts.
            </p>
          </div>
          <div>
            <FieldLabel>Public base URL</FieldLabel>
            <Input
              value={String(form.emailPublicBaseUrl || "")}
              onChange={(e) => setField("emailPublicBaseUrl", e.target.value)}
              placeholder="https://getcarapi.com"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Used for reset and ticket links in emails.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <div className="min-w-[14rem] flex-1">
            <FieldLabel>Test recipient</FieldLabel>
            <Input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@company.com"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={testMutation.isPending || !testTo.trim()}
            onClick={() => testMutation.mutate({ to: testTo.trim(), type: "smtp_ping" })}
          >
            <Send className="w-3.5 h-3.5 mr-1.5" />
            Send SMTP test
          </Button>
        </div>
      </SectionCard>

      <SectionCard icon={Bell} title="Notifications">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,240px)_1fr]">
          <div className="space-y-1">
            {EVENTS.map((ev) => (
              <button
                key={ev.type}
                type="button"
                onClick={() => {
                  setActiveEvent(ev.type);
                  setPreview(null);
                }}
                className={cn(
                  "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                  activeEvent === ev.type
                    ? "border-border bg-muted/60"
                    : "border-transparent hover:bg-muted/40",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">{ev.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                      {ev.description}
                    </p>
                  </div>
                  <Switch
                    checked={Boolean(form[ev.enabledKey])}
                    onCheckedChange={(v) => setField(ev.enabledKey, v)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </button>
            ))}
          </div>

          <div className="space-y-3 rounded-xl border border-border p-4">
            <div>
              <p className="text-sm font-semibold">{eventMeta.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{eventMeta.description}</p>
            </div>
            <div>
              <FieldLabel>Subject</FieldLabel>
              <Input
                value={String(form[eventMeta.subjectKey] || "")}
                onChange={(e) => setField(eventMeta.subjectKey, e.target.value)}
              />
            </div>
            <div>
              <FieldLabel>Body</FieldLabel>
              <Textarea
                rows={12}
                className="font-mono text-xs leading-relaxed"
                value={String(form[eventMeta.bodyKey] || "")}
                onChange={(e) => setField(eventMeta.bodyKey, e.target.value)}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Placeholders:{" "}
              {eventMeta.placeholders.map((p) => (
                <code key={p} className="mr-1.5 rounded bg-muted px-1 py-0.5">
                  {`{{${p}}}`}
                </code>
              ))}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={previewMutation.isPending}
                onClick={() => previewMutation.mutate()}
              >
                <Eye className="w-3.5 h-3.5 mr-1.5" />
                Preview
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const d = data?.defaults?.[activeEvent];
                  if (!d) return;
                  setField(eventMeta.subjectKey, d.subject);
                  setField(eventMeta.bodyKey, d.body);
                  setPreview(null);
                  toast({ title: "Restored default copy for this event" });
                }}
              >
                Restore default
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testMutation.isPending || !testTo.trim()}
                onClick={() =>
                  testMutation.mutate({ to: testTo.trim(), type: activeEvent })
                }
              >
                <Mail className="w-3.5 h-3.5 mr-1.5" />
                Send template test
              </Button>
            </div>

            {preview ? (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Preview
                </p>
                <p className="text-sm font-medium">{preview.subject}</p>
                <iframe
                  title="Email preview"
                  sandbox=""
                  className="w-full min-h-[320px] rounded-lg border border-border bg-[#eef2f7]"
                  srcDoc={preview.html}
                />
              </div>
            ) : null}
          </div>
        </div>
      </SectionCard>
    </form>
  );
}
