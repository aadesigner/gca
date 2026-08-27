/**
 * Augment the Express Request type with public API authentication context
 * attached by the requireApiToken middleware.
 */
import type { ApiClient, ApiToken } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      apiClient?: ApiClient;
      apiToken?: ApiToken;
      isPublicDemo?: boolean;
    }
  }
}

export {};
