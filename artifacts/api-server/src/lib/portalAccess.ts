export const CLIENT_PORTAL_CONTACT_EMAIL = "info@getcarapi.com";

export function portalClosedMessage(kind: "login" | "register"): string {
  if (kind === "login") {
    return `Client portal sign-in is currently closed. To get an account, contact ${CLIENT_PORTAL_CONTACT_EMAIL}.`;
  }
  return `Self-registration is currently closed. Contact ${CLIENT_PORTAL_CONTACT_EMAIL} for API access, pricing, and your API token.`;
}
