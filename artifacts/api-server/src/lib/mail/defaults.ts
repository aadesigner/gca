export type EmailTemplateType =
  | "password_reset"
  | "support_staff_reply"
  | "support_new_ticket_admin"
  | "support_client_reply_admin"
  | "payment_approved";

export const EMAIL_TEMPLATE_TYPES: EmailTemplateType[] = [
  "password_reset",
  "support_staff_reply",
  "support_new_ticket_admin",
  "support_client_reply_admin",
  "payment_approved",
];

export const EMAIL_TEMPLATE_META: Record<
  EmailTemplateType,
  { label: string; description: string; placeholders: string[]; audience: "client" | "staff" }
> = {
  password_reset: {
    label: "Password reset",
    description: "Sent when a client requests a forgot-password link.",
    placeholders: ["clientName", "clientEmail", "resetUrl", "siteUrl", "expiresMinutes"],
    audience: "client",
  },
  support_staff_reply: {
    label: "Support — staff reply",
    description: "Sent to the client when staff replies on a ticket.",
    placeholders: [
      "clientName",
      "clientEmail",
      "ticketId",
      "ticketSubject",
      "ticketUrl",
      "replyPreview",
      "siteUrl",
    ],
    audience: "client",
  },
  support_new_ticket_admin: {
    label: "Support — new ticket (staff)",
    description: "Sent to the staff inbox when a client opens a ticket.",
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
    audience: "staff",
  },
  support_client_reply_admin: {
    label: "Support — client reply (staff)",
    description: "Sent to the staff inbox when a client replies.",
    placeholders: [
      "clientName",
      "clientEmail",
      "ticketId",
      "ticketSubject",
      "ticketUrl",
      "replyPreview",
      "siteUrl",
    ],
    audience: "staff",
  },
  payment_approved: {
    label: "Payment approved",
    description: "Sent to the client when a credit purchase is approved.",
    placeholders: [
      "clientName",
      "clientEmail",
      "credits",
      "amountUsd",
      "balanceAfter",
      "accountUrl",
      "siteUrl",
    ],
    audience: "client",
  },
};

export const DEFAULT_EMAIL_TEMPLATES: Record<EmailTemplateType, { subject: string; body: string }> = {
  password_reset: {
    subject: "Reset your GetCarAPI password",
    body: `Hi {{clientName}},

We received a request to reset your password.

Open this link to choose a new password (expires in {{expiresMinutes}} minutes):
{{resetUrl}}

If you did not request this, you can ignore this email.

— GetCarAPI
{{siteUrl}}`,
  },
  support_staff_reply: {
    subject: "Reply on your support ticket #{{ticketId}}",
    body: `Hi {{clientName}},

Support replied to your ticket #{{ticketId}}: {{ticketSubject}}

{{replyPreview}}

View and reply:
{{ticketUrl}}

— GetCarAPI
{{siteUrl}}`,
  },
  support_new_ticket_admin: {
    subject: "New support ticket #{{ticketId}} from {{clientName}}",
    body: `New ticket #{{ticketId}} ({{ticketCategory}})

From: {{clientName}} <{{clientEmail}}>
Subject: {{ticketSubject}}

{{messagePreview}}

Open in admin:
{{ticketUrl}}`,
  },
  support_client_reply_admin: {
    subject: "Client reply on ticket #{{ticketId}}",
    body: `{{clientName}} <{{clientEmail}}> replied on ticket #{{ticketId}}: {{ticketSubject}}

{{replyPreview}}

Open in admin:
{{ticketUrl}}`,
  },
  payment_approved: {
    subject: "Payment received — {{credits}} credits added",
    body: `Hi {{clientName}},

Your payment of {{amountUsd}} USD was confirmed. We added {{credits}} credits to your account.

New balance: {{balanceAfter}} credits

{{accountUrl}}

— GetCarAPI
{{siteUrl}}`,
  },
};

export type SettingsEmailRow = {
  smtpEnabled: boolean;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpFromName: string | null;
  smtpFromEmail: string | null;
  emailStaffInbox: string | null;
  liveFeedContactEmail: string | null;
  emailPublicBaseUrl: string | null;
  emailPasswordResetEnabled: boolean;
  emailSupportStaffReplyEnabled: boolean;
  emailSupportNewTicketAdminEnabled: boolean;
  emailSupportClientReplyAdminEnabled: boolean;
  emailPaymentApprovedEnabled: boolean;
  emailTplPasswordResetSubject: string | null;
  emailTplPasswordResetBody: string | null;
  emailTplSupportStaffReplySubject: string | null;
  emailTplSupportStaffReplyBody: string | null;
  emailTplSupportNewTicketAdminSubject: string | null;
  emailTplSupportNewTicketAdminBody: string | null;
  emailTplSupportClientReplyAdminSubject: string | null;
  emailTplSupportClientReplyAdminBody: string | null;
  emailTplPaymentApprovedSubject: string | null;
  emailTplPaymentApprovedBody: string | null;
};

export function templateColumns(type: EmailTemplateType): {
  subjectKey: keyof SettingsEmailRow;
  bodyKey: keyof SettingsEmailRow;
  enabledKey: keyof SettingsEmailRow;
} {
  switch (type) {
    case "password_reset":
      return {
        subjectKey: "emailTplPasswordResetSubject",
        bodyKey: "emailTplPasswordResetBody",
        enabledKey: "emailPasswordResetEnabled",
      };
    case "support_staff_reply":
      return {
        subjectKey: "emailTplSupportStaffReplySubject",
        bodyKey: "emailTplSupportStaffReplyBody",
        enabledKey: "emailSupportStaffReplyEnabled",
      };
    case "support_new_ticket_admin":
      return {
        subjectKey: "emailTplSupportNewTicketAdminSubject",
        bodyKey: "emailTplSupportNewTicketAdminBody",
        enabledKey: "emailSupportNewTicketAdminEnabled",
      };
    case "support_client_reply_admin":
      return {
        subjectKey: "emailTplSupportClientReplyAdminSubject",
        bodyKey: "emailTplSupportClientReplyAdminBody",
        enabledKey: "emailSupportClientReplyAdminEnabled",
      };
    case "payment_approved":
      return {
        subjectKey: "emailTplPaymentApprovedSubject",
        bodyKey: "emailTplPaymentApprovedBody",
        enabledKey: "emailPaymentApprovedEnabled",
      };
  }
}

export function resolveTemplate(
  settings: SettingsEmailRow,
  type: EmailTemplateType,
): { subject: string; body: string } {
  const cols = templateColumns(type);
  const defaults = DEFAULT_EMAIL_TEMPLATES[type];
  const subject = String(settings[cols.subjectKey] ?? "").trim() || defaults.subject;
  const body = String(settings[cols.bodyKey] ?? "").trim() || defaults.body;
  return { subject, body };
}

export function isTemplateEnabled(settings: SettingsEmailRow, type: EmailTemplateType): boolean {
  return Boolean(settings[templateColumns(type).enabledKey]);
}

export function publicBaseUrl(settings: SettingsEmailRow): string {
  const raw = (settings.emailPublicBaseUrl || "https://getcarapi.com").trim().replace(/\/+$/, "");
  return raw || "https://getcarapi.com";
}

export function staffInbox(settings: SettingsEmailRow): string | null {
  const inbox = (settings.emailStaffInbox || settings.liveFeedContactEmail || "").trim();
  return inbox || null;
}
