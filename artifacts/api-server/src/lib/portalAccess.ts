export const CLIENT_PORTAL_CONTACT_EMAIL = "info@getcarapi.com";

export function portalClosedMessage(kind: "login" | "register"): string {
  if (kind === "login") {
    return `Client portal sign-in is currently closed. To get an account, contact ${CLIENT_PORTAL_CONTACT_EMAIL}.`;
  }
  return `Self-registration is currently closed. Sign in if you already have an account, or contact ${CLIENT_PORTAL_CONTACT_EMAIL} for help.`;
}
